import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it } from 'vitest'

import IndicateurView from '../views/IndicateurView.vue'
import { chargerFichier } from '../payload/loader'
import type { ChargerOptions, Fichier, ReponseFetch } from '../payload/loader'
import type { Territoire } from '../payload/types'
import { routes } from '../router'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'
import { GEOMETRIE_CHARGER_KEY } from '../geo/useGeometrie'

/**
 * La note de contexte permanente + la contextualisation des compositions
 * (#472) — les tests ROUTÉS contre le VRAI payload committé (public/data/,
 * lu par le chargeur réel et ses validateurs). Deux verrous :
 *  1. la note de contexte — UNE ligne discrète sur chaque Page d'indicateur,
 *     dérivée de l'état résolu de l'URL (?territoire/?niveau/?departement),
 *     vivante aux changements d'état sur DEUX familles (scalaire chômage,
 *     composition mix_logements) ;
 *  2. la contextualisation des compositions — mix_logements rend la
 *     composition du territoire mis en avant face à la médiane du périmètre
 *     comparé, avec une provenance évidente (« votre territoire ») et les
 *     états honnêtes (silence / absent).
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
  return { wrapper, router }
}

function noteDe(wrapper: ReturnType<typeof mount>) {
  const note = wrapper.find('[data-testid="note-contexte"]')
  expect(note.exists(), 'la note de contexte est rendue').toBe(true)
  return note!
}

beforeEach(() => localStorage.clear())

describe('Pages d’indicateur — note de contexte permanente (#472)', () => {
  it('famille scalaire (chômage) : la note suit ?territoire, ?niveau et ?departement en direct', async () => {
    const { wrapper, router } = await monter('/indicateurs/economie/chomage')
    // État résolu par défaut : aucune mise en avant, niveau le plus fin
    // (commune), univers Bretagne.
    expect(noteDe(wrapper).text()).toContain('Aucun territoire mis en avant')
    expect(noteDe(wrapper).text()).toContain('comparaison sur les communes de Bretagne')
    // Une mise en avant : le nom RÉEL de la référence (22001 → Allineuc).
    await router.push({ query: { territoire: '22001' } })
    await flushPromises()
    expect(noteDe(wrapper).text()).toContain('Votre territoire : Allineuc')
    // Le niveau en effet change : l'univers suit (EPCIs de Bretagne).
    await router.push({ query: { niveau: 'epci' } })
    await flushPromises()
    expect(noteDe(wrapper).text()).toContain('comparaison sur les EPCI de Bretagne')
    // Le périmètre resserré est nommé (le département 22 → Côtes-d’Armor).
    await router.push({ query: { niveau: 'commune', departement: '22' } })
    await flushPromises()
    expect(noteDe(wrapper).text()).toContain('comparaison sur les communes du département Côtes-d’Armor')
  })

  it('famille composition (mix_logements) : la note vit aussi ici, et dit le hors-périmètre', async () => {
    const { wrapper, router } = await monter('/indicateurs/habitat/mix_logements?territoire=22001')
    expect(noteDe(wrapper).text()).toContain('Votre territoire : Allineuc')
    expect(noteDe(wrapper).text()).not.toContain('hors périmètre')
    // La commune 22001 (Côtes-d’Armor) demandée dans un périmètre Finistère…
    await router.push({ query: { territoire: '22001', departement: '29' } })
    await flushPromises()
    // … reste nommée, mais son appartenance au périmètre est dite honnêtement.
    expect(noteDe(wrapper).text()).toContain('Votre territoire : Allineuc (hors périmètre comparé)')
    // Sans mise en avant, la note ne promet rien.
    await router.push({ query: {} })
    await flushPromises()
    expect(noteDe(wrapper).text()).toContain('Aucun territoire mis en avant')
  })
})

describe('Pages d’indicateur — contextualisation des compositions (#472)', () => {
  it('mix_logements?territoire=22001 : provenance évidente, parts du territoire face à la médiane du périmètre', async () => {
    const { wrapper } = await monter('/indicateurs/habitat/mix_logements?territoire=22001')
    // La provenance du highlight est explicite : c'est LE territoire mis en
    // avant par l'URL, jamais un premier venu silencieux.
    expect(wrapper.find('[data-testid="composition-provenance"]').text()).toBe('Votre territoire : Allineuc')
    // Les parts DU territoire (×100 via le formatage partagé #466).
    const valeurs = wrapper.findAll('.composition-legend li strong').map((el) => el.text())
    expect(valeurs).toEqual(['72%', '12%', '16%'])
    // Face à la référence du périmètre : la médiane des communes comparées
    // par segment (Bretagne : principales ≈ 0,8363 → « 84 % », secondaires
    // ≈ 0,0766 → « 8 % », vacants ≈ 0,0706 → « 7 % »).
    const references = wrapper.findAll('.composition-legend li small').map((el) => el.text())
    expect(references).toEqual(['médiane : 84%', 'médiane : 8%', 'médiane : 7%'])
    // La légende nomme l'univers comparé dont la médiane est la référence.
    expect(wrapper.find('figcaption').text()).toContain('les communes de Bretagne')
  })

  it('sans mise en avant : rien n’affirme — l’invite parle, pas de barres mystère', async () => {
    const { wrapper } = await monter('/indicateurs/habitat/mix_logements')
    expect(wrapper.find('.composition-bar').exists()).toBe(false)
    expect(wrapper.find('[data-testid="composition-contextualisee"]').text()).toContain('Sélectionnez un territoire')
  })

  it('territoire hors du niveau comparé : l’absence est dite, jamais habillée', async () => {
    // Un code EPCI demandé sur une page comparant les communes : absent.
    const { wrapper } = await monter('/indicateurs/habitat/mix_logements?territoire=200027027')
    const statut = wrapper.find('[data-testid="composition-contextualisee"] [role="status"]')
    expect(statut.exists(), 'le message d’absence est rendu').toBe(true)
    expect(statut.text()).toContain('absent')
    expect(wrapper.find('.composition-bar').exists()).toBe(false)
  })
})
