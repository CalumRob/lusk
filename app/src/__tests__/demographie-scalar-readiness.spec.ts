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
})
