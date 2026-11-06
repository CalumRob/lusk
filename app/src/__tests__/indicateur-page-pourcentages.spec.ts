import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The reference files and theme metadata are retained inputs; numerical page
// observations come from the marked synthetic native-API fixture. Under
// parallel load the first routed mount can exceed Vitest's default timeout.
vi.setConfig({ testTimeout: 30_000 })

import IndicateurView from '../views/IndicateurView.vue'
import { chargerFichier } from '../payload/loader'
import type { ChargerOptions, Fichier, ReponseFetch } from '../payload/loader'
import type { Territoire } from '../payload/types'
import { routes } from '../router'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'
import { GEOMETRIE_CHARGER_KEY } from '../geo/useGeometrie'
import { formaterValeur } from '../payload/selectors'
import { NATIVE_API_FIXTURE_NOTICE, NATIVE_API_SCENARIOS } from './fixtures/nativeApiScenarios'
import { createNativeSemanticApiTransport, type NativeBatchObserver } from './helpers/nativeSemanticApiTransport'

/**
 * Les unités % des Pages d'indicateur (#466) — les tests routés vérifient le
 * rendu ×100 des fractions synthétiques sous l'unité producteur « % » : le
 * scénario ciblé, le profil et les ressources viennent du contrat API et de
 * ses métadonnées; aucune valeur n'est revendiquée comme publiée. Trois pages
 * restent couvertes : un scalaire % (chômage), la facette résumée d'une
 * distribution (distribution_dpe pilotée par part_passoires — signature
 * comprise, ×100 UNE fois), et une composition (mix_logements).
 */

const dataDir = join(process.cwd(), '..', 'public', 'data')

/** Le fetch du chargeur lit le payload COMMITTÉ sur disque — zéro stub de valeur. */
const fetchReel = async (url: string): Promise<ReponseFetch> => {
  try {
    const corps = readFileSync(join(dataDir, url.replace(/^\/data\//, '')), 'utf8')
    return { ok: true, status: 200, json: async () => JSON.parse(corps) }
  } catch {
    return { ok: false, status: 404, json: async () => null }
  }
}

const chargerElargi = chargerFichier as unknown as (
  nom: Fichier,
  territoiresOuOptions?: Territoire[] | ChargerOptions,
  options?: ChargerOptions,
) => Promise<unknown>

const SANS_REFERENCE = (fichier: Fichier) =>
  fichier === 'territoires' || fichier === 'run-report' || fichier === 'vintages' || fichier.startsWith('theme_')

/** Le chargeur PAR FICHIER réel (le même chemin que usePayload en production),
 *  mémoïsé par fichier : les validateurs passent une fois, chaque monture
 *  reçoit les mêmes sections validées. */
const cache = new Map<Fichier, Promise<unknown>>()
let territoiresValides: Territoire[] | null = null
function chargerCommis(fichier: Fichier): Promise<unknown> {
  const options = { fetchImpl: fetchReel }
  if (!cache.has(fichier)) {
    const promesse = (
      SANS_REFERENCE(fichier)
        ? chargerElargi(fichier, options)
        : (async () => {
            territoiresValides ??= (await chargerElargi('territoires', options)) as Territoire[]
            return chargerElargi(fichier, territoiresValides, options)
          })()
    ).catch((cause: unknown) => {
      cache.delete(fichier)
      throw cause
    })
    cache.set(fichier, promesse)
  }
  return cache.get(fichier)!
}

async function monter(url: string, observer?: NativeBatchObserver) {
  vi.stubGlobal('fetch', createNativeSemanticApiTransport(observer))
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(url)
  await router.isReady()
  const empty = { type: 'FeatureCollection' as const, features: [] }
  const wrapper = mount(IndicateurView, {
    global: {
      plugins: [router],
      provide: {
        [PAYLOAD_CHARGER_KEY]: chargerCommis,
        [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
      },
      stubs: {
        MapExplorer: {
          props: ['payload', 'activeIds', 'niveau', 'territoireCible', 'couche'],
          template: '<div data-testid="map" />',
        },
      },
    },
  })
  await flushPromises()
  return wrapper
}

function ligneDuTableau(wrapper: ReturnType<typeof mount>, territoire: string) {
  const ligne = wrapper.findAll('tbody tr').find((tr) => tr.find(`a[href*="territoire/commune/${territoire}"]`).exists())
  expect(ligne, `ligne communale ${territoire}`).toBeDefined()
  return ligne!
}

beforeEach(() => localStorage.clear())

describe('Pages d’indicateur — unités % rendues ×100 (#466)', () => {
  it('page scalaire % (chômage) : médiane, tableau, extrêmes et marqueur lisent la part en pourcentage', async () => {
    const reads: Array<{ item: Record<string, any>; data: Record<string, any> }> = []
    const observer: NativeBatchObserver = (items, response) => items.forEach((item, index) => {
      if (item.resource === 'chomage') reads.push({ item, data: response.results[index].data })
    })
    const wrapper = await monter('/indicateurs/economie/chomage?territoire=22001', observer)
    const comparison = reads.find(({ item }) => item.intent.kind !== 'facts')?.data.result
    const cohort = reads.find(({ item }) => item.intent.kind === 'facts' && item.target.kind === 'territory_cohort')?.data
    expect(comparison?.synthetic_fixture ?? reads.find(({ item }) => item.intent.kind !== 'facts')?.data.synthetic_fixture)
      .toMatchObject(NATIVE_API_FIXTURE_NOTICE)
    expect(typeof comparison?.median).toBe('number')
    const display = (value: number) => `${formaterValeur({ value, unit: '%' })} %`
    const mediane = wrapper.find('.median strong').text()
    expect(mediane.replace(/\s+/g, ' ').trim()).toBe(display(comparison.median))
    // The displayed comparison and highlighted fact are tied to the explicitly
    // marked synthetic API observations, not retired published numbers.
    const ligne = ligneDuTableau(wrapper, '22001')
    const focal = cohort!.observations.find((observation: any) => observation.territory.id === '22001')
    expect(focal.value).toBe(NATIVE_API_SCENARIOS.percentagePages.unemployment)
    expect(ligne.findAll('td')[1]!.text()).toBe(display(focal.value))
    const measured = cohort!.observations.filter((observation: any) => observation.status === 'measured')
    const high = measured.reduce((best: any, candidate: any) => candidate.value > best.value ? candidate : best)
    const low = measured.reduce((best: any, candidate: any) => candidate.value < best.value ? candidate : best)
    const extremes = wrapper.findAll('.extremes article')
    const highTies = measured.filter((observation: any) => observation.value === high.value).length
    const lowTies = measured.filter((observation: any) => observation.value === low.value).length
    expect(extremes[0]!.text()).toContain(`${highTies} territoires à égalité`)
    expect(extremes[1]!.text()).toContain(`${lowTies} territoires à égalité`)
    // Synthetic observations deliberately create ties; the UI correctly names
    // their count instead of picking a fabricated single extreme territory.
    expect(extremes[0]!.findAll('a')).toHaveLength(0)
    expect(extremes[1]!.findAll('a')).toHaveLength(0)
    expect(wrapper.find('svg desc').text()).toContain(': 7 %,')
  })

  it('distribution_dpe : la facette résumée pilote des repères ×100 et la signature se rend ×100 UNE fois', async () => {
    // La facette résumée (part_passoires, %) pilote extrêmes et tableau (#474 :
    // le héros médian scalaire a quitté la page catégorielle) ; la signature
    // A→G du territoire sélectionné porte SES parts, chacune ×100 exactement
    // UNE fois — jamais l'échelle brute ni une double échelle.
    const wrapper = await monter('/indicateurs/habitat/distribution_dpe?territoire=22001')
    expect(wrapper.find('.median').exists()).toBe(false)
    const ligne = ligneDuTableau(wrapper, '22001')
    expect(ligne.findAll('td')[1]!.text()).toBe('13 %')
    // Signature 22001 : A 0,0111→« 1 », C 0,4556→« 46 » (et non « 0,46 » ni « 4600 »).
    expect(NATIVE_API_FIXTURE_NOTICE.publication_parity).toBe(false)
    for (const [detail, value] of Object.entries(NATIVE_API_SCENARIOS.percentagePages.dpe)) {
      const barre = wrapper.find(`[data-detail="${detail}"] .signature-valeur`)
      expect(barre.exists(), `étiquette ${detail}`).toBe(true)
      expect(barre.text()).toBe(`${formaterValeur({ value, unit: '%' })} %`)
    }
  })

  it('composition (mix_logements) : segments et légende portent la part ×100 via le formatage partagé', async () => {
    // Les trois parts fractionnaires de 22001 se lisent en pourcentages entiers,
    // à l'identique dans la légende ET dans l'aria-label du segment — une seule
    // échelle, jamais « 0,72 » ni « 7200 % ».
    const wrapper = await monter('/indicateurs/habitat/mix_logements?territoire=22001')
    const legendes = wrapper.findAll('.composition-legend li strong').map((el) => el.text())
    expect(legendes).toEqual(['72%', '12%', '16%'])
    const aria = wrapper.find('.composition-bar').attributes('aria-label') ?? ''
    expect(aria).toContain('Résidences principales 72%')
    expect(aria).toContain('Logements vacants 16%')
    expect(aria).not.toContain('0,72')
  })
})
