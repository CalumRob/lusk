import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GEOMETRIE_CHARGER_KEY } from '../geo/useGeometrie'
import { indicateursHabitatFixture, indicateursMilieuxFixture, territoiresFixture } from '../payload/fixtures'
import { INDICATOR_READ_MODEL_MANIFEST_CHARGER_KEY } from '../payload/indicatorReadModel'
import { PAYLOAD_CHARGER_KEY, type ChargerFichier } from '../payload/usePayload'
import { routes } from '../router'
import IndicateurView from '../views/IndicateurView.vue'
import { validerThemeMetadata } from '../payload/validate'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

const rawMetadataMilieux = JSON.parse(readFileSync(join(process.cwd(), '..', 'pipeline', 'inst', 'extdata', 'theme-metadata', 'theme_milieux.json'), 'utf8'))
const metadataMilieux = validerThemeMetadata(rawMetadataMilieux, 'theme_milieux.json')
const rawMetadataHabitat = JSON.parse(readFileSync(join(process.cwd(), '..', 'pipeline', 'inst', 'extdata', 'theme-metadata', 'theme_habitat.json'), 'utf8'))
const metadataHabitat = validerThemeMetadata(rawMetadataHabitat, 'theme_habitat.json')

describe("Page d'indicateur — lecture ordonnée dans le contrat existant", () => {
  it('mounts prix_m2 through the shared default-off owned-series reader gate', async () => {
    vi.stubEnv('VITE_OWNED_SERIES_API', '1')
    const loader: ChargerFichier = async (file) => {
      if (file === 'territoires') return territoiresFixture
      if (file === 'indicateurs_habitat') return indicateursHabitatFixture
      if (file === 'theme_habitat') return metadataHabitat
      throw new Error(`unexpected static read: ${file}`)
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      dataset_id: 'dvf_prix_m2', indicator_id: 'prix_m2', axis_kind: 'year', unit: '€/m²',
      territory: { id: '22001', type: 'commune', name: 'Commune A1' },
      points: [{ axis: '2024', observation_period: '2024', value: null, status: 'missing', provenance: [] },
        { axis: '2025', observation_period: '2025', value: 525, status: 'measured', provenance: [] }],
      scope_series: [{ territory: { id: '22001', type: 'commune', name: 'Commune A1' }, points: [
        { axis: '2024', observation_period: '2024', value: null, status: 'missing', provenance: [] },
        { axis: '2025', observation_period: '2025', value: 525, status: 'measured', provenance: [] },
      ] }], comparison: { point: '2025', value: 525, median: 525, rank: 1, ties: 1, comparable_count: 1,
        direction: 'low', scope: { kind: 'level', territory_type: 'commune', department_id: '22' } },
    }), { status: 200 }))
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs/habitat/prix_m2?territoire=22001&niveau=commune&departement=22')
    await router.isReady()
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: loader,
      [INDICATOR_READ_MODEL_MANIFEST_CHARGER_KEY]: async () => ({ schemaVersion: '1' as const, routes: { habitat: [] } }),
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
    try {
      await flushPromises()
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/series-datasets/dvf_prix_m2/territories/commune/22001/prix_m2?scope_level=commune&department_id=22')
      expect(wrapper.text()).toContain('525')
      expect(wrapper.text()).toContain('Prix')
    } finally { wrapper.unmount() }
  })
  it('waits for delayed metadata before choosing a series route when both API gates are enabled', async () => {
    vi.stubEnv('VITE_OCSGE_STATE_SERIES_API', '1')
    vi.stubEnv('VITE_CONSO_ENAF_SERIES_API', '1')
    let publishMetadata!: (metadata: typeof metadataMilieux) => void
    const metadata = new Promise<typeof metadataMilieux>((resolve) => { publishMetadata = resolve })
    const loader: ChargerFichier = async (file) => {
      if (file === 'territoires') return territoiresFixture
      if (file === 'indicateurs_milieux') return indicateursMilieuxFixture
      if (file === 'theme_milieux') return metadata
      throw new Error(`unexpected static read: ${file}`)
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      dataset_id: 'ocsge_artif_etats', indicator_id: 'artif_par_habitant', points: [], scope_series: [],
      territory: { id: '22001', type: 'commune', name: 'Commune A1' },
    }), { status: 200 }))
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs/milieux/artif_par_habitant?territoire=22001&niveau=commune&departement=22')
    await router.isReady()
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: loader,
      [INDICATOR_READ_MODEL_MANIFEST_CHARGER_KEY]: async () => ({ schemaVersion: '1' as const, routes: { milieux: [] } }),
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
    try {
      await flushPromises()
      expect(fetchMock).not.toHaveBeenCalled()
      publishMetadata(metadataMilieux)
      await flushPromises()
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/series-datasets/ocsge_artif_etats/territories/commune/22001/artif_par_habitant?scope_level=commune&department_id=22')
      expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    } finally { wrapper.unmount() }
  })

  it('preserves validated dataset bindings and rejects invalid publication identities', () => {
    expect(metadataMilieux.indicator_pages?.artif_par_habitant.series_dataset_id).toBe('ocsge_artif_etats')
    expect(metadataMilieux.indicator_pages?.artif_par_habitant.series_publication).toBe('owned')
    for (const patch of [{ series_dataset_id: '../invalid' }, { series_publication: 'unknown' }, { series_dataset_id: undefined, series_publication: 'owned' }]) {
      const metadata = structuredClone(rawMetadataMilieux)
      Object.assign(metadata.indicator_pages.artif_par_habitant, patch)
      expect(() => validerThemeMetadata(metadata, 'theme_milieux.json')).toThrow()
    }
  })
  it('completes a pending owned read when URL normalization repeats the same scope', async () => {
    vi.stubEnv('VITE_OCSGE_STATE_SERIES_API', '1')
    localStorage.removeItem('lusk:niveau-indicateur')
    const loader: ChargerFichier = async (file) => {
      if (file === 'territoires') return territoiresFixture
      if (file === 'indicateurs_milieux') return indicateursMilieuxFixture
      if (file === 'theme_milieux') return metadataMilieux
      throw new Error(`unexpected static read: ${file}`)
    }
    let complete!: (response: Response) => void
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>((resolve) => { complete = resolve }))
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs/milieux/artif_par_habitant?territoire=22001&niveau=commune&departement=22')
    await router.isReady()
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: loader,
      [INDICATOR_READ_MODEL_MANIFEST_CHARGER_KEY]: async () => ({ schemaVersion: '1' as const, routes: { milieux: [] } }),
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
    await flushPromises()
    expect(wrapper.text()).toContain('Chargement des données actualisées')
    await router.replace({ query: { ...router.currentRoute.value.query, detail: '2025' } })
    await flushPromises()
    const point = { axis: '2025', state_role: 'M3', observation_period: '2021-2025', value: 42, status: 'measured', provenance: [] }
    complete(new Response(JSON.stringify({ dataset_id: 'ocsge_artif_etats', indicator_id: 'artif_par_habitant',
      axis_kind: 'declared_detail', unit: 'm²/hab', comparison_point: '2025',
      territory: { id: '22001', type: 'commune', name: 'Commune A1' }, points: [point],
      scope_series: [{ territory: { id: '22001', type: 'commune', name: 'Commune A1' }, points: [point] }],
    }), { status: 200 }))
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).not.toContain('Chargement des données actualisées')
    expect(wrapper.text()).toContain('42')
    wrapper.unmount()
  })

  it('uses the separately gated, dataset-qualified M2/M3 reader and does not reuse ENAF state', async () => {
    vi.stubEnv('VITE_OCSGE_STATE_SERIES_API', '1')
    vi.stubEnv('VITE_CONSO_ENAF_SERIES_API', '')
    const loader: ChargerFichier = async (file) => {
      if (file === 'territoires') return territoiresFixture
      if (file === 'indicateurs_milieux') return indicateursMilieuxFixture
      if (file === 'theme_milieux') return metadataMilieux
      throw new Error(`unexpected static read: ${file}`)
    }
    let apiAvailable=false
    const fetchMock = vi.spyOn(globalThis,'fetch').mockImplementation(async () => {
      if(!apiAvailable) throw new Error('owned API unavailable')
      return new Response(JSON.stringify({
      dataset_id:'ocsge_artif_etats',indicator_id:'artif_par_habitant',axis_kind:'declared_detail',unit:'m²/hab',
      territory:{id:'22001',type:'commune',name:'Commune A1'},comparison_point:'2025',
      comparison:{point:'2025',direction:'low',scope:{kind:'level',territory_type:'commune',
        department_id:'22',rank_field:'rang_dep'},rank:1,ties:1,median:61,comparable_count:2},
      points:[{axis:'2021',state_role:'M2',observation_period:'2021-2025',value:0,status:'measured',provenance:[]},
        {axis:'2025',state_role:'M3',observation_period:'2021-2025',value:42,status:'measured',provenance:[]}],
      scope_series:[{territory:{id:'22001',type:'commune',name:'Commune A1'},points:[
        {axis:'2021',state_role:'M2',observation_period:'2021-2025',value:0,status:'measured',provenance:[]},
        {axis:'2025',state_role:'M3',observation_period:'2021-2025',value:42,status:'measured',comparison_rank:1,comparison_ties:1,comparison_count:2,provenance:[]}]},
      {territory:{id:'22002',type:'commune',name:'Commune A2'},points:[
        {axis:'2021',state_role:'M2',observation_period:'2021-2025',value:2,status:'measured',provenance:[]},
        {axis:'2025',state_role:'M3',observation_period:'2021-2025',value:80,status:'measured',comparison_rank:2,comparison_ties:1,comparison_count:2,provenance:[]}]}],
      }),{status:200,headers:{'Content-Type':'application/json'}})
    })
    const router=createRouter({history:createMemoryHistory(),routes})
    await router.push('/indicateurs/milieux/artif_par_habitant?territoire=22001&niveau=commune&departement=22&detail=2021')
    await router.isReady()
    const empty={type:'FeatureCollection' as const,features:[]}
    const wrapper=mount(IndicateurView,{global:{plugins:[router],provide:{
      [PAYLOAD_CHARGER_KEY]:loader,
      [INDICATOR_READ_MODEL_MANIFEST_CHARGER_KEY]:async()=>({schemaVersion:'1' as const,routes:{milieux:[]}}),
      [GEOMETRIE_CHARGER_KEY]:async()=>({communes:empty,epcis:empty,departements:empty}),
    }}})
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledWith('/api/series-datasets/ocsge_artif_etats/territories/commune/22001/artif_par_habitant?scope_level=commune&department_id=22')
    expect(wrapper.text()).toContain('momentanément indisponibles')
    apiAvailable=true
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('momentanément indisponibles')
    expect(wrapper.text()).toContain('42')
  })

  it('preserves the page grammar and comparison scope, adapts API facts, and never falls back to static series on failure', async () => {
    vi.stubEnv('VITE_CONSO_ENAF_SERIES_API', '1')
    const calls: string[] = []
    const loader: ChargerFichier = async (file) => {
      calls.push(file)
      if (file === 'territoires') return territoiresFixture
      if (file === 'indicateurs_milieux') return indicateursMilieuxFixture
      if (file === 'theme_milieux') return metadataMilieux
      throw new Error(`unexpected static read: ${file}`)
    }
    const fixtureFacts = indicateursMilieuxFixture.filter((fact) => fact.key === 'conso_enaf_annuel' && fact.type === 'commune')
    const axis: string[] = rawMetadataMilieux.indicator_pages.conso_enaf_annuel.comparison.details
    const scopeSeries = [...new Set(fixtureFacts.map((fact) => fact.territoire))].map((id) => {
      const territory = territoiresFixture.find((item) => item.territoire === id)!
      return { territory: { id, type: territory.type, name: territory.nom }, points: fixtureFacts
        .filter((fact) => fact.territoire === id).map((fact) => ({ axis: fact.detail!, observation_period: fact.detail,
          value: fact.value, status: fact.value === null ? 'missing' : 'measured', source_id: 'consoenaf',
          vintage_id: 'v2025', source_version: '2025', source_reference_date: '2025-01-01', source_publication_date: '2026-07-24' })) }
    })
    const apiRead = {
      indicator_id: 'conso_enaf_annuel', dataset_id: 'conso_enaf_annuel', axis_kind: 'year', unit: 'ha',
      territory: { id: '22001', type: 'commune', name: 'Commune A1' }, points: axis.map((year) => ({ axis: year,
        observation_period: year, value: fixtureFacts.find((fact) => fact.territoire === '22001' && fact.detail === year)?.value ?? null,
        status: fixtureFacts.some((fact) => fact.territoire === '22001' && fact.detail === year)
          ? (fixtureFacts.find((fact) => fact.territoire === '22001' && fact.detail === year)?.value === null ? 'missing' : 'measured') : 'missing',
        source_id: 'consoenaf', vintage_id: 'v2025' })), scope_series: scopeSeries,
      comparison: { point: '2024', value: null, median: null, rank: null, ties: null, comparable_count: 0,
        scope: { kind: 'level', territory_type: 'commune', department_id: '22', epci_id: null } },
    }
    let apiCalls = 0
    let retryEnabled = false
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (!String(input).startsWith('/api/')) return new Response('{}', { status: 404 })
      apiCalls++
      if (!retryEnabled) throw new Error('offline')
      return new Response(JSON.stringify(apiRead), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs/milieux/conso_enaf_annuel?territoire=22001&niveau=commune&departement=22')
    await router.isReady()
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: loader,
      [INDICATOR_READ_MODEL_MANIFEST_CHARGER_KEY]: async () => ({ schemaVersion: '1' as const, routes: { milieux: [] } }),
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
    await flushPromises()
    expect(wrapper.text()).toContain('momentanément indisponibles')
    expect(wrapper.find('.vues').exists()).toBe(true)
    expect(wrapper.text()).toContain('L’indicateur')
    expect(wrapper.text()).not.toContain(String(fixtureFacts.find((fact) => fact.territoire === '22001' && fact.detail === '2011')?.value))
    const beforeRetry = apiCalls
    retryEnabled = true
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(apiCalls).toBeGreaterThan(beforeRetry)
    // Le canon épinglé déclare la série ENAF comme publication possédée
    // (6cb3a08a — routes de niveau fiche possédées) : le lecteur privilégié
    // par VITE_CONSO_ENAF_SERIES_API est donc la route dataset possédée.
    expect(fetchMock).toHaveBeenLastCalledWith('/api/series-datasets/conso_enaf_annuel/territories/commune/22001/conso_enaf_annuel?scope_level=commune&department_id=22')
    expect(wrapper.find('.vues').exists()).toBe(true)
    expect(wrapper.find('.controls').exists()).toBe(true)
    expect(wrapper.text()).toContain('Consommation')
    expect(wrapper.text()).toContain('4,32')
    expect(wrapper.text()).toContain('Département 22')
    expect(wrapper.text()).not.toContain('Territoire de la série')
    await wrapper.findAll('.vues button')[2].trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Précautions')
    expect(calls).toContain('theme_milieux')
  })

  it('keeps the legacy indicator facts and does not call the API when the build gate is off by default', async () => {
    vi.stubEnv('VITE_CONSO_ENAF_SERIES_API', '')
    const loader: ChargerFichier = async (file) => {
      if (file === 'territoires') return territoiresFixture
      if (file === 'indicateurs_milieux') return indicateursMilieuxFixture
      if (file === 'theme_milieux') return metadataMilieux
      throw new Error(`unexpected static read: ${file}`)
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs/milieux/conso_enaf_annuel?territoire=22001&niveau=commune&departement=22')
    await router.isReady()
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: loader,
      [INDICATOR_READ_MODEL_MANIFEST_CHARGER_KEY]: async () => ({ schemaVersion: '1' as const, routes: { milieux: [] } }),
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
    await flushPromises()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('momentanément indisponibles')
    expect(wrapper.text()).toContain('12 ha')
    expect(wrapper.find('.vues').exists()).toBe(true)
  })
})
