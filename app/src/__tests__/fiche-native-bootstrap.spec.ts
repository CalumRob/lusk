import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import TerritoireView from '../views/TerritoireView.vue'
import { chargerMetadonneesTheme, THEME_METADATA_CHARGER_KEY } from '../payload/themeCatalogue'
import { routes } from '../router'
import {
  nativeBatchResponse,
  nativeCatalogueResponse,
  nativeReadFixture,
  nativeResources,
} from './helpers/semanticApiFixtures'

/**
 * #868 — mounted native-bootstrap regression (work order item 1).
 *
 * The fiche bootstraps from the compact generated territory reference
 * (`/data/territoires.json`) and reads ALL numerics from the native semantic
 * API. The old per-territory read model (`/data/modeles-lecture/...`) and the
 * static per-theme numeric tables (`/data/indicateurs_*`, `/data/histoires_*`)
 * must NEVER be requested. The fetch stub below fails closed on any other
 * URL, so the assertions on the request log are real guards, not decorations.
 */

const SENTINEL_EUROS = 8_765_432

function lireDonnee(relatif: string): string {
  return readFileSync(resolve(process.cwd(), '..', 'public', 'data', relatif), 'utf8')
}

interface RequeteEnregistree {
  url: string
  items?: Array<Record<string, any>>
}

function monterAvecFetchRestreint() {
  const requetes: RequeteEnregistree[] = []
  const programmeResources = nativeResources('programmes')
  const annual = programmeResources.find((resource) => resource.resource_id === 'subventions_annuelles')!
  const fetchRestreint = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    requetes.push({ url, ...(init?.body ? { items: (JSON.parse(String(init.body)) as { items: Array<Record<string, any>> }).items } : {}) })
    if (url === '/data/territoires.json') {
      return new Response(lireDonnee('territoires.json'), { status: 200 })
    }
    if (url.startsWith('/data/theme_') && url.endsWith('.json')) {
      return new Response(lireDonnee(url.slice('/data/'.length)), { status: 200 })
    }
    if (url === '/api/resources') return nativeCatalogueResponse()
    if (url === '/api/resources/read-batch') {
      const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
      return nativeBatchResponse(items, (item, resource) => {
        const data = nativeReadFixture(item, resource, { syntheticProfileComparisons: true })
        if (item.intent.kind !== 'facts') return data
        if (resource.resource_id === annual.resource_id && Array.isArray(data.points)) {
          return { ...data, points: data.points.map((point: Record<string, any>) => ({ ...point, value: SENTINEL_EUROS })) }
        }
        return data
      })
    }
    throw new Error(`Requête interdite pendant le bootstrap natif : ${url}`)
  })
  return { requetes, fetchRestreint }
}

async function monterFiche(chemin: string, fetchRestreint: ReturnType<typeof monterAvecFetchRestreint>['fetchRestreint']) {
  vi.stubGlobal('fetch', fetchRestreint)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(chemin)
  await router.isReady()
  const wrapper = mount(TerritoireView, {
    global: {
      plugins: [router],
      provide: { [THEME_METADATA_CHARGER_KEY]: chargerMetadonneesTheme },
    },
  })
  await flushPromises()
  return { router, wrapper }
}

const requetesStatiques = (requetes: RequeteEnregistree[]) => requetes.filter(({ url }) =>
  url.startsWith('/data/modeles-lecture/') || url.startsWith('/data/indicateurs_') || url.startsWith('/data/histoires_'))

const lecturesFaits = (requetes: RequeteEnregistree[], resource: string) =>
  requetes.flatMap((requete) => requete.items ?? [])
    .filter((item) => item.resource === resource && item.intent.kind === 'facts')

describe('fiche — bootstrap natif lean depuis la référence territoire (#868)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('identifie le territoire depuis la référence, rend un sentinel API natif, et ne touche aucun modèle/numérique statique', async () => {
    const { requetes, fetchRestreint } = monterAvecFetchRestreint()
    const { wrapper } = await monterFiche('/territoire/commune/22001', fetchRestreint)
    try {
      await flushPromises()

      // Identité validée depuis la référence compacte générée.
      expect(wrapper.find('h1').text()).toBe('Allineuc')
      expect(requetes.some(({ url }) => url === '/data/territoires.json')).toBe(true)

      // Lecture native réelle du thème actif (Programmes par défaut).
      const annual = nativeResources('programmes').find((resource) => resource.resource_id === 'subventions_annuelles')!
      expect(lecturesFaits(requetes, annual.resource_id).length).toBeGreaterThan(0)
      expect(requetes.some(({ url, items }) => url === '/api/resources/read-batch' && (items ?? []).length > 0)).toBe(true)

      // Sentinel rendu depuis la réponse API native.
      expect(wrapper.find('.subvention-total').text()).toContain('8,77 M€')

      // AUCUNE requête vers l'ancien modèle par territoire ni les tables numériques statiques.
      expect(requetesStatiques(requetes)).toEqual([])
    } finally {
      wrapper.unmount()
    }
  }, 20000)

  it('acquiert une comparaison typée au changement de portée puis navigue vers un autre territoire sans repli statique', async () => {
    const { requetes, fetchRestreint } = monterAvecFetchRestreint()
    const { router, wrapper } = await monterFiche('/territoire/commune/22001', fetchRestreint)
    try {
      await flushPromises()
      expect(wrapper.find('h1').text()).toBe('Allineuc')
      const annual = nativeResources('programmes').find((resource) => resource.resource_id === 'subventions_annuelles')!
      const faitsAvant = lecturesFaits(requetes, annual.resource_id).length
      expect(faitsAvant).toBeGreaterThan(0)

      // Cas de comparaison réel : la portée EPCI déclenche une lecture selected_comparison.
      await router.push('/territoire/commune/22001?theme=programmes&comparaison=epci')
      await flushPromises()
      const selections = requetes.flatMap((requete) => requete.items ?? [])
        .filter((item) => item.intent.kind === 'selected_comparison')
      expect(selections.length).toBeGreaterThan(0)
      expect(selections[0]!.intent.members).toEqual([{ type: 'epci', id: '200067460' }])

      // Navigation réelle : l'autre commune rend SON identité depuis la référence
      // et relit ses faits natifs — toujours aucun accès statique.
      await router.push('/territoire/commune/22002?theme=programmes')
      await flushPromises()
      expect(wrapper.find('h1').text()).toBe('Andel')
      const lectures22002 = requetes.flatMap((requete) => requete.items ?? [])
        .filter((item) => item.intent.kind === 'facts' && item.target?.kind === 'territory'
          && item.target?.type === 'commune' && item.target?.id === '22002')
      expect(lectures22002.length).toBeGreaterThan(0)
      expect(wrapper.find('.subvention-total').text()).toContain('8,77 M€')
      expect(requetesStatiques(requetes)).toEqual([])
    } finally {
      wrapper.unmount()
    }
  }, 20000)
})
