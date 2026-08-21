import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it, beforeEach } from 'vitest'
import IndicateurView from '../views/IndicateurView.vue'
import { chargerAvec, indicateursDemographieFixture, metadonneesThemesFixtures, territoiresFixture, histoiresDemographieFixture, apercuAvecNAFixture, runReportFraisFixture, vintagesFixture } from '../payload/fixtures'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'
import type { Payload } from '../payload/types'
import { routes } from '../router'
import { GEOMETRIE_CHARGER_KEY } from '../geo/useGeometrie'
import type { Fichier } from '../payload/loader'

const payload: Payload = { territoires: [...territoiresFixture, { territoire: 'e', type: 'epci', nom: 'EPCI test', departement: null, epci: null }], indicateurs: indicateursDemographieFixture, histoires: histoiresDemographieFixture, apercu: apercuAvecNAFixture, runReport: runReportFraisFixture, vintages: vintagesFixture, programmes: null, themeMetadata: { demographie: metadonneesThemesFixtures.demographie } }
async function monter(url: string, appels: string[] = []) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(url)
  await router.isReady()
  const empty = { type: 'FeatureCollection' as const, features: [] }
  const wrapper = mount(IndicateurView, {
    global: {
      plugins: [router],
      provide: {
        [PAYLOAD_CHARGER_KEY]: async (fichier: Fichier) => { appels.push(fichier); return chargerAvec(payload)(fichier) },
        [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
      },
      stubs: {
        MapExplorer: {
          props: ['payload', 'activeIds', 'niveau', 'territoireCible', 'couche'],
          template: '<div data-testid="map" :data-level="niveau" :data-selected="territoireCible?.territoire" :data-values="activeIds.join(\',\')" />',
        },
      },
    },
  })
  await flushPromises()
  return { wrapper, router }
}
beforeEach(() => localStorage.clear())

describe('IndicateurView — routed URL seam', () => {
  it('canonicalizes and changes a trajectory endpoint across Repères and Carte', async () => {
    const originalMetadata = payload.themeMetadata!.demographie!
    const originalFacts = payload.indicateurs
    const meta = structuredClone(originalMetadata)
    payload.themeMetadata!.demographie = meta
    meta.indicator_keys = [...meta.indicator_keys, 'serie_test']
    meta.sources.serie_test = 'serie_historique'
    meta.indicator_labels.serie_test = 'Série test'
    meta.detail_labels.serie_test = { '2022': '2022', '2024': '2024' }
    meta.indicator_pages = { serie_test: { indicator: 'serie_test', label: 'Série test', definition: 'Une trajectoire.', unit: 'u', calculation: '—', direction: 'high', caveats: '—', levels: ['commune'], sources: ['serie_historique'], family: 'trajectory', default_detail: '2024', endpoint_labels: { '2022': '2022', '2024': '2024' } } }
    payload.indicateurs = [...originalFacts, ...(['22001', '22002'].flatMap((territoire, i) => ['2022', '2024'].map((detail) => ({ ...originalFacts[0], territoire, key: 'serie_test', detail, value: i + Number(detail) / 10000 }))))]
    try {
      const { wrapper, router } = await monter('/indicateurs/demographie/serie_test')
      expect(router.currentRoute.value.query.detail).toBe('2024')
      expect(wrapper.text()).toContain('Endpoint actif')
      await router.push({ query: { vue: 'carte', detail: '2022' } }); await flushPromises()
      expect(router.currentRoute.value.query.detail).toBe('2022')
      expect(wrapper.find('[data-testid="map"]').exists()).toBe(true)
    } finally { payload.themeMetadata!.demographie = originalMetadata; payload.indicateurs = originalFacts }
  })
  it('defaults to Repères and switches real URL-backed views; invalid vue is cleared by selecting Repères', async () => { const { wrapper, router } = await monter('/indicateurs/demographie/densite?vue=wat'); expect(wrapper.find('main').exists()).toBe(true); await wrapper.findAll('.vues button')[0].trigger('click'); await flushPromises(); expect(router.currentRoute.value.query.vue).toBeUndefined(); await router.push({ query: { vue: 'carte' } }); await flushPromises(); expect(router.currentRoute.value.query.vue).toBe('carte'); await router.push({ query: { vue: 'indicateur' } }); await flushPromises(); expect(router.currentRoute.value.query.vue).toBe('indicateur') })
  it('renders unknown indicator honestly', async () => { const { wrapper } = await monter('/indicateurs/demographie/not-published'); expect(wrapper.text()).toContain('Indicateur introuvable') })
  it('renders an unknown theme as a finite honest error state', async () => { const { wrapper } = await monter('/indicateurs/inconnu/densite'); expect(wrapper.text()).toContain('Indicateur introuvable'); expect(wrapper.text()).not.toContain('Chargement de l’indicateur') })
  it('reacts when the router reuses the view for a new indicator parameter', async () => { const { wrapper, router } = await monter('/indicateurs/demographie/densite'); expect(wrapper.text()).toContain('Densité de population'); await router.push('/indicateurs/demographie/not-published'); await flushPromises(); expect(wrapper.text()).toContain('Indicateur introuvable'); expect(wrapper.text()).not.toContain('Densité de population') })
  it('remounts the selected theme page with its hermetic wait-set', async () => { const appels: string[] = []; const { wrapper, router } = await monter('/indicateurs/demographie/densite', appels); expect(appels).toEqual(expect.arrayContaining(['territoires', 'indicateurs_demographie', 'theme_demographie'])); await router.push('/indicateurs/habitat/not-published'); await flushPromises(); expect(wrapper.text()).toContain('Indicateur introuvable'); expect(wrapper.text()).not.toContain('Densité de population') })
  it('writes fallback level, lets explicit URL win, filters, preserves fiche theme and scopes', async () => { localStorage.setItem('lusk:niveau-indicateur', 'commune'); const { wrapper, router } = await monter('/indicateurs/demographie/densite'); expect(router.currentRoute.value.query.niveau).toBe('commune'); await wrapper.find('input').setValue('Commune A'); expect(wrapper.text()).toContain('Commune A'); expect(wrapper.find('a[href*="theme=demographie"]').exists()).toBe(true); await wrapper.find('select').setValue('epci'); await flushPromises(); expect(router.currentRoute.value.query.departement).toBeUndefined(); expect(router.currentRoute.value.query.epci).toBeUndefined() })
  it('renders unit and reusable complete source records', async () => { const { wrapper, router } = await monter('/indicateurs/demographie/densite?vue=indicateur'); expect(wrapper.text()).toContain('hab./km²'); expect(wrapper.text()).toContain('Publication annuelle'); expect(router.currentRoute.value.query.vue).toBe('indicateur') })
  it('mounts map integration with active level and selected territory', async () => { const { wrapper, router } = await monter('/indicateurs/demographie/densite?vue=carte&territoire=29002'); expect(wrapper.find('[data-testid="map"]').exists()).toBe(true); expect(wrapper.find('[data-testid="map"]').attributes('data-level')).toBe('communes'); expect(wrapper.find('[data-testid="map"]').attributes('data-selected')).toBe('29002'); expect(router.currentRoute.value.query.vue).toBe('carte') })
  it('persists a level selected through the routed control', async () => { const { wrapper } = await monter('/indicateurs/demographie/densite'); await wrapper.find('select').setValue('epci'); await flushPromises(); expect(localStorage.getItem('lusk:niveau-indicateur')).toBe('epci') })
  it('renders real EPCI rows after switching the routed level', async () => { const { wrapper } = await monter('/indicateurs/demographie/densite'); await wrapper.find('select').setValue('epci'); await flushPromises(); expect(wrapper.find('tbody').text()).toContain('EPCI X'); expect(wrapper.find('tbody').text()).toContain('EPCI Y') })
  it('normalizes explicit non-commune scopes and invalid scope identifiers on first load', async () => { const { router } = await monter('/indicateurs/demographie/densite?niveau=epci&departement=22&epci=missing'); expect(router.currentRoute.value.query.departement).toBeUndefined(); expect(router.currentRoute.value.query.epci).toBeUndefined(); const second = await monter('/indicateurs/demographie/densite?niveau=commune&departement=missing&epci=missing'); expect(second.router.currentRoute.value.query.departement).toBeUndefined(); expect(second.router.currentRoute.value.query.epci).toBeUndefined() })
  it('sorts by explicit URL-backed name, value and direction-aware rank controls', async () => { const { wrapper, router } = await monter('/indicateurs/demographie/densite?tri=nom&ordre=asc'); expect(wrapper.findAll('tbody tr')[0].text()).toContain('Commune A1'); await wrapper.findAll('thead button')[1].trigger('click'); await flushPromises(); expect(router.currentRoute.value.query.tri).toBe('valeur'); expect(router.currentRoute.value.query.ordre).toBe('asc'); expect(wrapper.findAll('tbody tr')[0].text()).toContain('Commune D') })
  it('clicking a table row persists the selected territory and uses a non-fixed density marker', async () => { const { wrapper, router } = await monter('/indicateurs/demographie/densite'); await wrapper.findAll('tbody button')[0].trigger('click'); await flushPromises(); expect(router.currentRoute.value.query.territoire).toBe('22001'); const marker = wrapper.find('.point-highlight'); expect(marker.exists()).toBe(true); expect(marker.attributes('cx')).not.toBe('300') })
  it('gives the selected density marker an accessible formatted description', async () => { const { wrapper } = await monter('/indicateurs/demographie/densite?territoire=22001'); expect(wrapper.find('svg desc').text()).toContain('Commune A1'); expect(wrapper.find('svg desc').text()).toContain('200'); expect(wrapper.find('svg desc').text()).toContain('positionné sur l’axe') })
  it('renders unique extremes as named fiche links', async () => { const { wrapper } = await monter('/indicateurs/demographie/densite'); expect(wrapper.find('a[href*="territoire/commune/22001"]').exists()).toBe(true); })
  it('renders tied extremes as counts without pretending one territory wins', async () => { const tiedPayload = structuredClone(payload); tiedPayload.indicateurs = tiedPayload.indicateurs.map((fact) => fact.key === 'densite' && fact.type === 'commune' ? { ...fact, value: 10 } : fact); const original = payload.indicateurs; payload.indicateurs = tiedPayload.indicateurs; const { wrapper } = await monter('/indicateurs/demographie/densite'); expect(wrapper.text()).toContain('4 territoires à égalité'); expect(wrapper.find('.extremes a').exists()).toBe(false); payload.indicateurs = original })
})
