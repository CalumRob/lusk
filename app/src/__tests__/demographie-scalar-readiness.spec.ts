import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { routes } from '../router'
import TerritoireView from '../views/TerritoireView.vue'
import { chargerModeleTerritoire, TERRITORY_READ_MODEL_CHARGER_KEY } from '../payload/territoryReadModel'
import { formaterValeur } from '../payload/selectors'

const dataPath = (file: string) => resolve(process.cwd(), `../public/data/${file}`)
const readData = (file: string) => JSON.parse(readFileSync(dataPath(file), 'utf8'))
const targetId = '35236'

describe('Démographie scalar readiness on the territory fiche', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('removes stale embedded registrations when the canonical catalogue omits scalar_contracts', async () => {
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '0')
    const model = readData(`modeles-lecture/territoires/commune/${targetId}.json`)
    model.themes.demographie.theme_metadata.scalar_contracts = readData('theme_demographie.json').scalar_contracts
    const calls: string[] = []
    vi.stubEnv('VITE_SCALAR_COHORT_API', '1')
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.startsWith('/data/')) {
        const file = url.slice('/data/'.length)
        const payload = readData(file)
        if (file === 'theme_demographie.json') delete payload.scalar_contracts
        if (file === `modeles-lecture/territoires/commune/${targetId}.json`) return new Response(JSON.stringify(model), { status: 200 })
        return new Response(JSON.stringify(payload), { status: 200 })
      }
      throw new Error(`A scalar API request should not be made: ${url}`)
    }))

    const loadedModel = await chargerModeleTerritoire('commune', targetId)
    expect(loadedModel.themes.demographie?.metadata).not.toHaveProperty('scalar_contracts')

    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push(`/territoire/commune/${targetId}?theme=demographie`)
    await router.isReady()
    const wrapper = mount(TerritoireView, { global: { plugins: [router], provide: {
      [TERRITORY_READ_MODEL_CHARGER_KEY]: async () => loadedModel,
    } } })
    await flushPromises()

    expect(calls.some((url) => url.includes('/indicator-cohorts/'))).toBe(false)
    const density = model.themes.demographie.indicateurs.find((row: any) => row.key === 'densite' && row.territoire === targetId)
    const staticFigure = wrapper.find('[data-clef="densite"]')
    expect(staticFigure.exists()).toBe(true)
    expect(staticFigure.find('.valeur-numerique').text()).toBe(formaterValeur(density))
    wrapper.unmount()
  })

  it('reconciles the published indicator-page contract before acquiring registered scalars', async () => {
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '0')
    const model = readData(`modeles-lecture/territoires/commune/${targetId}.json`)
    const territory = model.territory
    const catalogue = readData('theme_demographie.json')
    const sourceMetadata = JSON.parse(readFileSync(resolve(process.cwd(),
      '../pipeline/inst/extdata/theme-metadata/theme_demographie.json'), 'utf8'))
    const staticRows = model.themes.demographie.indicateurs
    const requested: string[] = []
    vi.stubEnv('VITE_SCALAR_COHORT_API', '1')
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/data/')) {
        const file = url.slice('/data/'.length)
        return new Response(JSON.stringify(readData(file)), { status: 200 })
      }
      const match = url.match(/^\/api\/territories\/commune\/([^/]+)\/indicator-cohorts\/([^?]+)\?scope_level=commune$/)
      if (!match) throw new Error(`Unexpected request ${url}`)
      const [, focalId, indicator] = match
      requested.push(indicator!)
      const page = catalogue.indicator_pages[indicator!]
      const staticRow = staticRows.find((row: any) => row.key === indicator && row.territoire === focalId)
      if (!page || !staticRow) throw new Error(`Missing published fixture for ${indicator}`)
      return new Response(JSON.stringify({
        indicator_id: indicator,
        territory_type: 'commune',
        label: page.label,
        unit: page.unit,
        direction: page.direction,
        comparison_facet: page.comparison?.indicator ?? indicator,
        completeness: 'sparse',
        content_version: 'test-published-scalar-version',
        observations: [{
          territory_id: focalId,
          name: territory.nom,
          value: staticRow.value,
          status: 'measured',
          support_count: null,
          denominator_count: null,
          rang_epci: null,
          rang_epci_n: null,
          rang_dep: null,
          rang_dep_n: null,
          rang_reg: null,
          rang_reg_n: null,
          sources: [{
            source_id: page.sources[0],
            name: staticRow.vintage_source,
            vintage_id: `${staticRow.vintage_version}/${staticRow.vintage_date_reference}`,
            version: staticRow.vintage_version,
            reference_date: staticRow.vintage_date_reference,
            publication_date: staticRow.vintage_date_publication,
          }],
        }],
      }), { status: 200 })
    }))

    const loadedModel = await chargerModeleTerritoire('commune', targetId)
    const canonicalGroup = sourceMetadata.subgroups.find((group: any) => group.key === 'trajectoire-demographique')
    const embeddedGroup = model.themes.demographie.theme_metadata.subgroups
      .find((group: any) => group.key === 'trajectoire-demographique')
    expect(catalogue.subgroups).toEqual(sourceMetadata.subgroups)
    expect(embeddedGroup.figure.family).not.toBe(canonicalGroup.figure.family)
    expect(canonicalGroup.figure).toMatchObject({ family: 'scalar', indicator: 'evolution_1968' })
    expect(loadedModel.themes.demographie?.metadata.subgroups
      .find((group) => group.key === 'trajectoire-demographique')?.figure.family)
      .toBe(canonicalGroup.figure.family)
    expect(loadedModel.themes.demographie?.metadata.indicator_pages?.densite?.unit)
      .toBe(catalogue.indicator_pages.densite.unit)

    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push(`/territoire/commune/${targetId}?theme=demographie`)
    await router.isReady()
    const wrapper = mount(TerritoireView, { global: { plugins: [router], provide: {
      [TERRITORY_READ_MODEL_CHARGER_KEY]: async () => loadedModel,
    } } })
    await flushPromises()

    expect(model.themes.demographie.theme_metadata.indicator_pages.densite.unit).not.toBe(catalogue.indicator_pages.densite.unit)
    expect(requested.sort()).toEqual(Object.keys(catalogue.scalar_contracts).sort())
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Les indicateurs de ce thème ne sont pas disponibles.')
    const evolution = staticRows.find((row: any) => row.key === 'evolution_1968' && row.territoire === targetId)
    const changeFigure = wrapper.find('[data-clef="evolution_1968"]')
    expect(changeFigure.exists()).toBe(true)
    expect(changeFigure.find('.trajectory-indisponible').exists()).toBe(false)
    expect(changeFigure.find('.valeur-numerique').text()).toBe(`+${formaterValeur(evolution)}`)
    wrapper.unmount()
  })

  it('renders the semantic Démographie density and never calls its retired theme route', async () => {
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1')
    const model = readData(`modeles-lecture/territoires/commune/${targetId}.json`)
    const metadata = readData('theme_demographie.json')
    const semanticCalls: any[] = []
    const retiredDemographieCalls: string[] = []
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      requests.push(url)
      if (url.startsWith('/data/')) return new Response(JSON.stringify(readData(url.slice('/data/'.length))), { status: 200 })
      if (url === '/api/resources') return new Response(JSON.stringify({ contract: 'semantic-resource-catalogue-v1', resources: [
       ...Object.keys(metadata.indicator_pages).map((resource_id) => ({ resource_id, theme_id: 'demographie', resource_kind: 'indicator',
         shapes: [resource_id === 'structure_age' ? 'declared_profile' : 'scalar'],
         intents: ['facts', 'fixed_comparison', 'selected_comparison'] })),
        { resource_id: 'demographie_selected_reading', theme_id: 'demographie', resource_kind: 'typed_reading',
          fields: ['status', 'source_id', 'vintage_id'] },
      ] }), { status: 200 })
      if (url === '/api/resources/read-batch') {
        const body = JSON.parse(String(init?.body))
        semanticCalls.push(body)
        const results = body.items.map((item: any) => {
          const resource = item.resource
          const target = item.target
          const original = model.themes.demographie.indicateurs.find((row: any) => row.key === resource && row.territoire === target.id)
          let data: any
          if (item.intent.kind === 'fixed_comparison' || item.intent.kind === 'selected_comparison') {
            const version = resource === 'structure_age' ? 'profile-v1' : `${resource}-v1`
            data = { resource, target, contract: 'indicator-comparison-v1', shape: resource === 'structure_age' ? 'profile' : 'scalar',
              content_version: version, profile_content_version: version,
              reference_content_version: 'territories-v1', selection: null, scope: { kind: 'density_class' },
              result: { indicator_id: resource, status: 'available', direction: 'high', rank: 2, rank_size: 10,
                source_facet: resource === 'structure_age' ? { detail: '<15', sex: 'F' } : resource,
                ...(resource === 'structure_age' ? { source_facet_indicator_id: 'densite', scalar_content_version: 'densite-v1' } : {}) },
              ...(resource === 'structure_age' ? { scalar_content_version: 'densite-v1' } : {}) }
          } else if (resource === 'demographie_selected_reading') {
            data = { resource, target, content_version: 'reading-v1', facts: [{ groupe: 'trajectoire-demographique',
              story_key: 'trajectoire-demographique', salience_reason: 'defaut', periode: '2017-2023',
              solde_naturel: 1, solde_migratoire: 2, taux_solde_naturel: 0.3, taux_solde_migratoire: -0.2,
              classification: 'attire-renouvelle', status: 'measured', source_id: 'serie_historique', vintage_id: 'serie_historique' }] }
          } else if (resource === 'structure_age') {
            const profile = model.themes.demographie.indicateurs.filter((row: any) => row.key === resource && row.territoire === target.id)
            data = { resource, target, content_version: 'profile-v1', descriptor: { unit: '%', axes: [
              { name: 'detail', key: '<15' }, { name: 'sex', key: 'F' },
            ] }, observations: profile.slice(0, 1).map((row: any) => ({ detail: row.detail, sex: row.sex,
              value: row.value, status: row.observation_status ?? 'measured', sources: [{ source_id: 'age_detail', name: 'INSEE',
                version: '2023', reference_date: '2023-01-01', publication_date: '2026-06-30' }] })) }
          } else {
            data = { resource, target, value: resource === 'densite' ? 7654 : original?.value ?? null,
              status: resource === 'densite' ? 'measured' : original?.observation_status ?? 'not_available',
              unit: original?.unit ?? '%', content_version: `${resource}-v1`,
              sources: [{ source_id: metadata.sources[resource], name: 'INSEE', version: '2023',
                reference_date: '2023-01-01', publication_date: '2026-06-30' }] }
          }
          return { id: item.id, resource, data }
        })
        return new Response(JSON.stringify({ contract: 'semantic-read-batch-v1', results }), { status: 200 })
      }
      if (url.includes('/themes/demographie/')) retiredDemographieCalls.push(url)
      if (url.startsWith('/api/')) throw new Error(`Unexpected API request ${url}`)
      throw new Error(`Unexpected request ${url}`)
    }))
    const loadedModel = await chargerModeleTerritoire('commune', targetId)
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push(`/territoire/commune/${targetId}?theme=demographie`)
    await router.isReady()
    const wrapper = mount(TerritoireView, { global: { plugins: [router], provide: {
      [TERRITORY_READ_MODEL_CHARGER_KEY]: async () => loadedModel,
    } } })
    await flushPromises()
    expect(semanticCalls.length, `${requests.join('\n')}\n${wrapper.text()}`).toBeGreaterThan(0)
    expect(semanticCalls[0].items.map((item: any) => item.resource)).toEqual(expect.arrayContaining([
      ...Object.keys(metadata.indicator_pages), 'demographie_selected_reading',
    ]))
    expect(semanticCalls[0].items.filter((item: any) => item.intent.kind === 'fixed_comparison')).toHaveLength(4)
    expect(retiredDemographieCalls).toEqual([])
    expect(wrapper.find('[data-clef="densite"] .valeur-numerique').exists(), wrapper.text()).toBe(true)
    expect(wrapper.find('[data-clef="densite"] .valeur-numerique').text()).toContain('7 654')
    wrapper.unmount()
  })
})
