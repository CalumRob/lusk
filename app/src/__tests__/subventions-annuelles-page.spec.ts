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
import SourcesView from '../views/SourcesView.vue'
import { chargerFichier } from '../payload/loader'
import type { ChargerOptions, Fichier, ReponseFetch } from '../payload/loader'
import type { Territoire } from '../payload/types'
import { routes } from '../router'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'
import { GEOMETRIE_CHARGER_KEY } from '../geo/useGeometrie'
import { createNativeSemanticApiTransport } from './helpers/nativeSemanticApiTransport'

/**
 * La Page d'indicateur subventions_annuelles contre le VRAI payload committé
 * (#467) — le verrou routé de la page réparée. Le défaut : le descripteur
 * épinglé déclarait le scalaire `comparison.dimension: "2025"` SANS sa liste
 * fermée `dimensions` ; la réécriture canonique de l'URL (le repli résolu est
 * écrit dans l'URL, contrat Page d'indicateur) produisait alors un paramètre
 * présent que resolveQuery jugeait invalide (liste absente = axe non déclaré)
 * et la page s'invalidaient ELLE-MÊME un tick après le premier rendu —
 * « La facette de cette famille de Repères est invalide. », page vide.
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

async function monter(url: string, composant?: typeof IndicateurView, transport = createNativeSemanticApiTransport()) {
  vi.stubGlobal('fetch', transport)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(url)
  await router.isReady()
  const empty = { type: 'FeatureCollection' as const, features: [] }
  const wrapper = mount(composant ?? IndicateurView, {
    global: {
      plugins: [router],
      provide: {
        [PAYLOAD_CHARGER_KEY]: chargerCommis,
        [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
      },
      stubs: {
        MapExplorer: {
          props: ['payload', 'activeIds', 'niveau', 'territoireCible', 'couche'],
          template: '<div data-testid="map" :data-n="payload.indicateurs.length" :data-active="activeIds.length" />',
        },
      },
    },
  })
  await flushPromises()
  await flushPromises()
  return { wrapper, router }
}

function ligneDuTableau(wrapper: ReturnType<typeof mount>, territoire: string) {
  const ligne = wrapper.findAll('tbody tr').find((tr) => tr.find(`a[href*="territoire/commune/${territoire}"]`).exists())
  expect(ligne, `ligne ${territoire}`).toBeDefined()
  return ligne!
}

beforeEach(() => localStorage.clear())

describe('Page d’indicateur subventions_annuelles — page complète contre le payload committé (#467)', () => {
  it('Repères peuplés : médiane, extrêmes réels et tableau communal — la facette épinglée survit à sa propre réécriture canonique', async () => {
    // L'arrivée SANS paramètre dimension : le repli résolu (« 2025 ») est écrit
    // dans l'URL par la canonicalisation — le second passage doit rester VALIDE.
    const { wrapper, router } = await monter('/indicateurs/programmes/subventions_annuelles?territoire=22001')
    expect(router.currentRoute.value.query.dimension).toBe('2025')
    expect(wrapper.find('[role="alert"]').exists(), 'aucune facette invalide').toBe(false)
    // La médiane communale réelle (725 communes comparées).
    expect(wrapper.find('.median strong').text().replace(/\s+/g, ' ')).toContain('55 867,84')
    // Les extrêmes réels : Rennes au plus haut, Broons au plus bas.
    const extremes = wrapper.findAll('.extremes article')
    expect(extremes[0]!.text()).toContain('Rennes')
    expect(extremes[0]!.text()).toContain('71 395 030,98')
    expect(extremes[1]!.text()).toContain('Broons')
    expect(extremes[1]!.text()).toContain('50 €')
    // Le tableau porte la ligne communale demandée avec SA valeur publiée.
    const ligne = ligneDuTableau(wrapper, '22001')
    expect(ligne!.findAll('td')[1]!.text().replace(/\s+/g, ' ')).toBe('1 600 €')
    expect(ligne!.findAll('td')[2]!.text()).toContain('/ 725')
    // Le changement de niveau reste peuplé : les 61 EPCIs bretons comparés.
    await router.replace({ query: { ...router.currentRoute.value.query, niveau: 'epci' } })
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists(), 'facette valide au niveau EPCI').toBe(false)
    expect(wrapper.findAll('tbody tr')).toHaveLength(61)
  })

  it('la Carte reçoit le scalaire du niveau actif', async () => {
    const { wrapper } = await monter('/indicateurs/programmes/subventions_annuelles?vue=carte')
    expect(wrapper.find('[role="alert"]').exists(), 'aucune facette invalide').toBe(false)
    const map = wrapper.find('[data-testid="map"]')
    expect(map.exists(), 'la couche explorateur est montée').toBe(true)
    expect(Number(map.attributes('data-n'))).toBeGreaterThan(0)
    expect(map.attributes('data-n')).toBe(String(Number(map.attributes('data-active'))))
  })

  it('L’indicateur rend sa source SCDL', async () => {
    const { wrapper } = await monter('/indicateurs/programmes/subventions_annuelles?vue=indicateur')
    expect(wrapper.find('[role="alert"]').exists(), 'aucune facette invalide').toBe(false)
    const cartes = wrapper.findAll('.source-card')
    expect(cartes.length).toBeGreaterThan(0)
    expect(cartes[0]!.find('h3').text()).toContain('subventions attribuées (SCDL)')
    // Le lien « Voir la fiche source » vise l'ancre du jeu sur /sources —
    // les DEUX bouts de la référence sont verrouillés (le test suivant).
    expect(cartes[0]!.find('a[href="/sources#source-subventions-scdl"]').exists()).toBe(true)
  })

  it('la page Sources publie le jeu SCDL à l’ancre visée, avec ses consommateurs', async () => {
    // L'autre bout de la référence : la fiche de source existe, à SON ancre,
    // et renvoie vers LA page d'indicateur réparée (#467).
    const { wrapper } = await monter('/sources', SourcesView)
    const fiche = wrapper.find('#source-subventions-scdl')
    expect(fiche.exists(), 'la fiche source SCDL est publiée').toBe(true)
    expect(fiche.find('a[href="/indicateurs/programmes/subventions_annuelles"]').exists()).toBe(true)
  })

  it('une identité source API SANS fiche source reste une carte native sans lien Sources (#732)', async () => {
    // La carte vient de la réponse native ; le lien « Voir la fiche source »
    // est du contenu app JOINT par identité exacte. Une identité inconnue de
    // /sources ne produit PAS de lien (jamais une ancre inventée), et la carte
    // garde ses faits natifs — jamais un repli historique.
    const saine = createNativeSemanticApiTransport()
    const renomme = (valeur: unknown): unknown => {
      if (Array.isArray(valeur)) return valeur.map(renomme)
      if (valeur && typeof valeur === 'object') {
        return Object.fromEntries(Object.entries(valeur as Record<string, unknown>).map(([cle, v]) =>
          cle === 'source_id' && typeof v === 'string' ? [cle, `inconnu_${v}`]
            : cle === 'source_name' && typeof v === 'string' ? [cle, `Source native inconnue (${v})`]
              : cle === 'sourceId' && typeof v === 'string' ? [cle, `inconnu_${v}`]
                : cle === 'name' && typeof v === 'string' ? [cle, `Source native inconnue (${v})`]
                  : [cle, renomme(v)]))
      }
      return valeur
    }
    const transport = async (input: RequestInfo | URL, init?: RequestInit) => {
      const reponse = await saine(input, init)
      if (String(input) === '/api/resources/read-batch' && reponse.status === 200) {
        return new Response(JSON.stringify(renomme(await reponse.json())), { status: 200,
          headers: { 'content-type': 'application/json' } })
      }
      return reponse
    }
    const { wrapper } = await monter('/indicateurs/programmes/subventions_annuelles?vue=indicateur', undefined, transport)
    expect(wrapper.find('[role="alert"]').exists(), 'aucune facette invalide').toBe(false)
    const cartes = wrapper.findAll('.source-card')
    expect(cartes.length).toBeGreaterThan(0)
    expect(cartes[0]!.find('h3').text()).toContain('Source native inconnue')
    expect(cartes[0]!.find('a[href^="/sources#"]').exists(), 'aucun lien Sources sans identité exacte').toBe(false)
    // Les millésimes affichés restent les faits natifs de la réponse.
    expect(cartes[0]!.text()).toContain('fixture-revision')
  })

  it('la carte source native couvre le hash de révision exposé par l’API (#732)', async () => {
    const { wrapper } = await monter('/indicateurs/programmes/subventions_annuelles?vue=indicateur')
    expect(wrapper.find('[role="alert"]').exists(), 'aucune facette invalide').toBe(false)
    const cartes = wrapper.findAll('.source-card')
    expect(cartes.length).toBeGreaterThan(0)
    expect(cartes[0]!.text()).toContain('Révision :')
    expect(cartes[0]!.text()).toContain('fixture-revision-hash')
  })
})
