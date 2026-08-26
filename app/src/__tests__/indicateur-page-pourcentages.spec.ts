import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Les montures routées lisent le VRAI payload committé : sous charge
// parallèle, le premier monture dépasse parfois le timeout par défaut — la
// même famille de flake que #185. Plafond relevé au niveau du fichier,
// verrous inchangés.
vi.setConfig({ testTimeout: 30_000 })

import IndicateurView from '../views/IndicateurView.vue'
import { chargerFichier } from '../payload/loader'
import type { ChargerOptions, Fichier, ReponseFetch } from '../payload/loader'
import type { Territoire } from '../payload/types'
import { routes } from '../router'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'
import { GEOMETRIE_CHARGER_KEY } from '../geo/useGeometrie'

/**
 * Les unités % des Pages d'indicateur (#466) — les tests ROUTÉS contre le
 * VRAI payload committé (public/data/, lu par le chargeur réel et ses
 * validateurs) qui verrouillent le rendu ×100 : les faits publiés portent
 * des fractions (0–1) sous unité « % » ; aucune surface de Repères ne doit
 * plus afficher « 0,13 % » là où la vérité est « 13 % ». Trois pages
 * verrouillées : un scalaire % (chômage), la facette résumée d'une
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

async function monter(url: string) {
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
    // Le payload committé porte des fractions sous « % » : la médiane
    // communale vaut 0,0799… — le visiteur doit lire « 8 % », jamais « 0,08 % ».
    const wrapper = await monter('/indicateurs/economie/chomage?territoire=22001')
    const mediane = wrapper.find('.median strong').text()
    expect(mediane).toBe('8 %')
    // Le tableau : la ligne communale 22001 (0,0712…) se lit « 7 % ».
    const ligne = ligneDuTableau(wrapper, '22001')
    expect(ligne.findAll('td')[1]!.text()).toBe('7 %')
    // Les extrêmes : Tréogan (max 26 %) / Guiler-sur-Goyen (min 2 %).
    const extremes = wrapper.findAll('.extremes article')
    expect(extremes[0]!.find('a').text()).toContain('· 26 %')
    expect(extremes[1]!.find('a').text()).toContain('· 2 %')
    // Le marqueur de densité décrit la valeur corrigée (« : 7 %, »).
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
    const attendus = { A: '1 %', B: '3 %', C: '46 %', D: '28 %', E: '9 %', F: '6 %', G: '8 %' }
    for (const [detail, libelle] of Object.entries(attendus)) {
      const barre = wrapper.find(`[data-detail="${detail}"] .signature-valeur`)
      expect(barre.exists(), `étiquette ${detail}`).toBe(true)
      expect(barre.text()).toBe(libelle)
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
