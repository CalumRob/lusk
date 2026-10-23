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
    const model = readData(`modeles-lecture/territoires/commune/${targetId}.json`)
    const territory = model.territory
    const catalogue = readData('theme_demographie.json')
    const sourceMetadata = JSON.parse(readFileSync(resolve(process.cwd(),
      '../pipeline/inst/extdata/theme-metadata/theme_demographie.json'), 'utf8'))
    const staticRows = model.themes.demographie.indicateurs
    const cohortTerritories = readData('territoires.json')
    // The raw producer metadata may omit `family`; family is reconciled from
    // producer subgroup declarations when the app validates the catalogue.
    // `scalar_contracts` is the authoritative registration for this read.
    const scalarIds: string[] = Array.isArray(catalogue.scalar_contracts)
      ? catalogue.scalar_contracts as string[]
      : Object.keys(catalogue.scalar_contracts)
    const resources = scalarIds.map((indicator) => {
      const page = catalogue.indicator_pages[indicator]
      const contract = catalogue.scalar_contracts[indicator]
      return { resource_id: indicator, theme_id: 'demographie', indicator_id: indicator, label: page.label,
        unit: page.unit, direction: page.comparison?.direction ?? page.direction,
        allowed_levels: contract.allowed_levels ?? page.levels, sources: page.sources, shapes: ['scalar'],
        target_kinds: ['territory', 'territory_cohort'], fields: ['value', 'support_count', 'denominator_count'],
        intents: ['facts', 'fixed_comparison', 'selected_comparison'] }
    })
    const requested: string[] = []
    vi.stubEnv('VITE_SCALAR_COHORT_API', '1')
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/data/')) {
        const file = url.slice('/data/'.length)
        return new Response(JSON.stringify(readData(file)), { status: 200 })
      }
      if (url === '/api/resources') return new Response(JSON.stringify({ contract: 'semantic-resource-catalogue-v1', resources }))
      if (url === '/api/resources/read-batch') {
        const body = JSON.parse(init?.body as string) as { items: Array<Record<string, any>> }
        const results = body.items.map((item) => {
          const indicator = String(item.resource)
          const target = item.target as { type: string; department_id?: string | null; epci_id?: string | null }
          const page = catalogue.indicator_pages[indicator]
          const staticRow = staticRows.find((row: any) => row.key === indicator && row.territoire === territory.territoire)
          if (!page || !staticRow) throw new Error(`Missing published fixture for ${indicator}`)
          requested.push(indicator)
          const members = cohortTerritories.filter((member: any) => member.type === target.type &&
            (!target.department_id || member.departement === target.department_id) &&
            (!target.epci_id || member.epci === target.epci_id))
          const data = { resource: indicator, target, shape: 'scalar',
            cohort: { territory_type: target.type, department_id: target.department_id ?? null,
              epci_id: target.epci_id ?? null, member_count: members.length,
              members: members.map((member: any) => ({ id: member.territoire, type: member.type, name: member.nom })),
              reference_content_version: 'reference-test-v1' },
            content_version: 'test-published-scalar-version', reference_content_version: 'reference-test-v1',
            descriptor: { indicator_id: indicator, theme_id: 'demographie', label: page.label, unit: page.unit,
              direction: page.comparison?.direction ?? page.direction, comparison_facet: page.comparison?.indicator ?? indicator,
              allowed_levels: resources.find((resource: { resource_id: string; allowed_levels: string[] }) => resource.resource_id === indicator)!.allowed_levels,
              denominator_semantics: 'Producer-declared denominator', completeness: 'sparse', descriptor_version: 'test-scalar-v1' },
            observations: [{ territory: { id: territory.territoire, type: territory.type, name: territory.nom },
              status: staticRow.value === null ? 'not_published' : 'measured', value: staticRow.value,
              support_count: null, denominator_count: null, sources: [{ source_id: page.sources[0],
                name: staticRow.vintage_source, vintage_id: `${staticRow.vintage_version}/${staticRow.vintage_date_reference}`,
                version: staticRow.vintage_version, reference_date: staticRow.vintage_date_reference,
                publication_date: staticRow.vintage_date_publication }] }] }
          return { id: item.id, resource: indicator, data }
        })
        return new Response(JSON.stringify({ contract: 'semantic-read-batch-v1', results }))
      }
      throw new Error(`Unexpected request ${url}`)
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
    expect(requested.sort()).toEqual(scalarIds.sort())
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Les indicateurs de ce thème ne sont pas disponibles.')
    const evolution = staticRows.find((row: any) => row.key === 'evolution_1968' && row.territoire === targetId)
    const changeFigure = wrapper.find('[data-clef="evolution_1968"]')
    expect(changeFigure.exists()).toBe(true)
    expect(changeFigure.find('.trajectory-indisponible').exists()).toBe(false)
    expect(changeFigure.find('.valeur-numerique').text()).toBe(`+${formaterValeur(evolution)}`)
    wrapper.unmount()
  })
})
