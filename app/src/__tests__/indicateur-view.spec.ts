import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it, beforeEach } from 'vitest'
import IndicateurView from '../views/IndicateurView.vue'
import { chargerAvec, indicateursDemographieFixture, metadonneesThemesFixtures, territoiresFixture, histoiresDemographieFixture, apercuAvecNAFixture, runReportFraisFixture, vintagesFixture } from '../payload/fixtures'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'
import type { Payload } from '../payload/types'
import { routes } from '../router'
import { GEOMETRIE_CHARGER_KEY } from '../geo/useGeometrie'

const payload: Payload = { territoires: [...territoiresFixture, { territoire: 'e', type: 'epci', nom: 'EPCI test', departement: null, epci: null }], indicateurs: indicateursDemographieFixture, histoires: histoiresDemographieFixture, apercu: apercuAvecNAFixture, runReport: runReportFraisFixture, vintages: vintagesFixture, programmes: null, themeMetadata: { demographie: metadonneesThemesFixtures.demographie } }
async function monter(url: string) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(url)
  await router.isReady()
  const empty = { type: 'FeatureCollection' as const, features: [] }
  const wrapper = mount(IndicateurView, {
    global: {
      plugins: [router],
      provide: {
        [PAYLOAD_CHARGER_KEY]: chargerAvec(payload),
        [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
      },
      stubs: {
        MapExplorer: {
          props: ['payload', 'niveau', 'territoireCible', 'couche'],
          template: '<div data-testid="map" :data-level="niveau" :data-selected="territoireCible?.territoire" :data-values="payload.indicateurs.filter(i => i.key === \'densite\' && i.value !== null).map(i => i.territoire).join(\',\')" />',
        },
      },
    },
  })
  await flushPromises()
  return { wrapper, router }
}
beforeEach(() => localStorage.clear())

describe('IndicateurView — routed URL seam', () => {
  it('defaults to Repères and switches real URL-backed views; invalid vue is cleared by selecting Repères', async () => { const { wrapper, router } = await monter('/indicateurs/demographie/densite?vue=wat'); expect(wrapper.find('main').exists()).toBe(true); await wrapper.findAll('.vues button')[0].trigger('click'); await flushPromises(); expect(router.currentRoute.value.query.vue).toBeUndefined(); await router.push({ query: { vue: 'carte' } }); await flushPromises(); expect(router.currentRoute.value.query.vue).toBe('carte'); await router.push({ query: { vue: 'indicateur' } }); await flushPromises(); expect(router.currentRoute.value.query.vue).toBe('indicateur') })
  it('renders unknown indicator honestly', async () => { const { wrapper } = await monter('/indicateurs/demographie/not-published'); expect(wrapper.text()).toContain('Indicateur introuvable') })
  it('renders an unknown theme as a finite honest error state', async () => { const { wrapper } = await monter('/indicateurs/inconnu/densite'); expect(wrapper.text()).toContain('Indicateur introuvable'); expect(wrapper.text()).not.toContain('Chargement de l’indicateur') })
  it('writes fallback level, lets explicit URL win, filters, preserves fiche theme and scopes', async () => { localStorage.setItem('lusk:niveau-indicateur', 'commune'); const { wrapper, router } = await monter('/indicateurs/demographie/densite'); expect(router.currentRoute.value.query.niveau).toBe('commune'); await wrapper.find('input').setValue('Commune A'); expect(wrapper.text()).toContain('Commune A'); expect(wrapper.find('a[href*="theme=demographie"]').exists()).toBe(true); await wrapper.find('select').setValue('epci'); await flushPromises(); expect(router.currentRoute.value.query.departement).toBeUndefined(); expect(router.currentRoute.value.query.epci).toBeUndefined() })
  it('renders unit and reusable complete source records', async () => { const { wrapper, router } = await monter('/indicateurs/demographie/densite?vue=indicateur'); expect(wrapper.text()).toContain('hab./km²'); expect(wrapper.text()).toContain('Publication annuelle'); expect(router.currentRoute.value.query.vue).toBe('indicateur') })
  it('mounts map integration with active level and selected territory', async () => { const { wrapper, router } = await monter('/indicateurs/demographie/densite?vue=carte&territoire=29002'); expect(wrapper.find('[data-testid="map"]').exists()).toBe(true); expect(wrapper.find('[data-testid="map"]').attributes('data-level')).toBe('communes'); expect(wrapper.find('[data-testid="map"]').attributes('data-selected')).toBe('29002'); expect(router.currentRoute.value.query.vue).toBe('carte') })
  it('persists a level selected through the routed control', async () => { const { wrapper } = await monter('/indicateurs/demographie/densite'); await wrapper.find('select').setValue('epci'); await flushPromises(); expect(localStorage.getItem('lusk:niveau-indicateur')).toBe('epci') })
  it('renders real EPCI rows after switching the routed level', async () => { const { wrapper } = await monter('/indicateurs/demographie/densite'); await wrapper.find('select').setValue('epci'); await flushPromises(); expect(wrapper.find('tbody').text()).toContain('EPCI X'); expect(wrapper.find('tbody').text()).toContain('EPCI Y') })
  it('passes only the active scoped indicator rows to the map', async () => { const { wrapper } = await monter('/indicateurs/demographie/densite?vue=carte&niveau=commune&departement=22'); expect(wrapper.find('[data-testid="map"]').attributes('data-values')).toBe('22001,22002') })
  it('clicking a table row persists the selected territory and uses a non-fixed density marker', async () => { const { wrapper, router } = await monter('/indicateurs/demographie/densite'); await wrapper.findAll('tbody button')[0].trigger('click'); await flushPromises(); expect(router.currentRoute.value.query.territoire).toBe('22001'); const marker = wrapper.find('.point-highlight'); expect(marker.exists()).toBe(true); expect(marker.attributes('cx')).not.toBe('300') })
  it('renders unique extremes as named fiche links', async () => { const { wrapper } = await monter('/indicateurs/demographie/densite'); expect(wrapper.find('a[href*="territoire/commune/22001"]').exists()).toBe(true); })
  it('renders tied extremes as counts without pretending one territory wins', async () => { const tiedPayload = structuredClone(payload); tiedPayload.indicateurs = tiedPayload.indicateurs.map((fact) => fact.key === 'densite' && fact.type === 'commune' ? { ...fact, value: 10 } : fact); const original = payload.indicateurs; payload.indicateurs = tiedPayload.indicateurs; const { wrapper } = await monter('/indicateurs/demographie/densite'); expect(wrapper.text()).toContain('4 territoires à égalité'); expect(wrapper.find('.extremes a').exists()).toBe(false); payload.indicateurs = original })
})
