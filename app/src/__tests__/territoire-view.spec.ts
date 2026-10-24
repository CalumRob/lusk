import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'

import TerritoireView from '../views/TerritoireView.vue'
import BlocProgrammes from '../components/fiche/BlocProgrammes.vue'
import CahierComparisonNote from '../fiche/prototype/CahierComparisonNote.vue'
import { OPTIONS_COMPARAISON_KEY, optionsContexteComparaison } from '../fiche/comparisonContext'
import { varianteDeUrl } from '../fiche/prototype/variantes'
import {
  histoiresDemographieFixture,
  histoiresHabitatFixture,
  indicateursDemographieFixture,
  indicateursHabitatFixture,
  indicateursProgrammesFixture,
  metadonneesThemesFixtures,
  territoiresFixture,
} from '../payload/fixtures'
import type { Histoire, Indicateur, Payload, Theme } from '../payload/types'
import {
  chargerModeleTerritoire,
  TERRITORY_READ_MODEL_CHARGER_KEY,
  validerModeleTerritoire,
} from '../payload/territoryReadModel'
import type { ChargerModeleTerritoire } from '../payload/territoryReadModel'
import { acquireThemeFacts } from '../payload/themeAcquisition'
import {
  semanticComparisonForTheme,
  themeFactsRowsFromSemantic,
  validerReponseComparaisonTheme,
} from '../payload/themeFactsAdapter'
import { PayloadError, validerThemeMetadata } from '../payload/validate'
import { routes } from '../router'
import {
  nativeBatchResponse,
  nativeCatalogueResponse,
  nativeReadFixture,
  nativeResources,
} from './helpers/semanticApiFixtures'

const indicateurs: Indicateur[] = [
  ...indicateursProgrammesFixture,
  ...indicateursDemographieFixture,
  ...indicateursHabitatFixture,
]
const histoires: Histoire[] = [...histoiresDemographieFixture, ...histoiresHabitatFixture]

const fetchBloque = vi.fn(async (input: RequestInfo | URL) => {
  throw new Error(`Accès réseau réel interdit dans ce test : ${String(input)}`)
})

const modelePublie22001 = JSON.parse(readFileSync(
  resolve(process.cwd(), '../public/data/modeles-lecture/territoires/commune/22001.json'),
  'utf8',
)) as Record<string, any>

function semanticScalarBatch(theme: string, metadata: any, items: Array<Record<string, any>>,
  focalId: string, valueFor: (indicator: string) => number) {
  const territories = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/territoires.json'), 'utf8'))
  return { contract: 'semantic-read-batch-v1', results: items.map((item) => {
    const indicator = item.resource as string
    const target = item.target as { kind: string; type: string; id?: string; department_id?: string | null; epci_id?: string | null }
    const contract = metadata.scalar_contracts[indicator]
    const page = metadata.indicator_pages[indicator]
    if (target.kind === 'territory') {
      const focal = territories.find((member: any) => member.type === target.type && member.territoire === target.id)
      const selectedIntent = item.intent.kind === 'selected_comparison'
      const members = selectedIntent
        ? item.intent.members.map((selection: { id: string }) => territories.find((member: any) => member.territoire === selection.id))
        : target.type === 'commune'
          ? territories.filter((member: any) => member.type === 'commune' && member.classe_densite_code === focal?.classe_densite_code)
          : territories.filter((member: any) => member.type === target.type)
      const scope = selectedIntent
        ? { kind: 'explicit_selection', member_count: members.length }
        : target.type === 'commune'
          ? { kind: 'density_class', territory_type: 'commune', density_class_code: focal?.classe_densite_code,
              member_count: members.length }
          : { kind: 'same_level', territory_type: target.type, member_count: members.length }
      const available = members.length >= 2 && members.some((member: any) => member?.territoire === focalId)
      const data = { resource: indicator, target, contract: 'indicator-comparison-v1', indicator_id: indicator,
        shape: 'scalar', content_version: `${theme}-scalar-test-v1`, reference_content_version: 'reference-test-v1',
        selection: selectedIntent ? item.intent.members.map((member: { type: string; id: string }) =>
          ({ territory_type: member.type, territory_id: member.id })) : null,
        scope, result: { indicator_id: indicator, status: available ? 'available' : 'unavailable',
          unit: page.unit, direction: page.comparison?.direction ?? page.direction,
          source_facet: contract.comparison_facet ?? page.comparison?.indicator ?? indicator,
          descriptor_version: `${theme}-scalar-descriptor-v1`, selected_member_count: members.length,
          eligible_count: members.length, missing_count: 0, rank: available ? 1 : null,
          rank_size: available ? members.length : null } }
      return { id: item.id, resource: indicator, data }
    }
    const members = territories.filter((member: any) => member.type === target.type &&
      (!target.department_id || member.departement === target.department_id) &&
      (!target.epci_id || member.epci === target.epci_id))
    const observations = (contract.completeness === 'dense_complete'
      ? members
      : members.filter((member: any) => member.territoire === focalId)).map((member: any) => ({
      territory: { id: member.territoire, type: member.type, name: member.nom },
      status: 'measured', value: valueFor(indicator), support_count: null, denominator_count: null,
      sources: [{ source_id: page.sources[0], name: 'Source API fiche',
        vintage_id: `${page.sources[0]}-2026`, version: '2026', reference_date: null, publication_date: null }],
    }))
    const data = { resource: indicator, target, shape: 'scalar',
      cohort: { territory_type: target.type, department_id: target.department_id ?? null,
        epci_id: target.epci_id ?? null, member_count: members.length,
        members: members.map((member: any) => ({ id: member.territoire, type: member.type, name: member.nom })),
        reference_content_version: 'reference-test-v1' },
      content_version: `${theme}-scalar-test-v1`, reference_content_version: 'reference-test-v1',
      descriptor: { indicator_id: indicator, theme_id: theme, label: page.label, unit: page.unit,
        direction: page.comparison?.direction ?? page.direction,
        comparison_facet: contract.comparison_facet ?? page.comparison?.indicator ?? indicator,
        allowed_levels: contract.allowed_levels ?? page.levels,
        denominator_semantics: 'Producer-declared denominator', completeness: contract.completeness,
        descriptor_version: `${theme}-scalar-descriptor-v1` }, observations }
    return { id: item.id, resource: indicator, data }
  }) }
}

function modeleAvecContextesComparaison() {
  const model = structuredClone(modelePublie22001)
  const validated = validerModeleTerritoire(
    model,
    'territoires/commune/22001.json',
    { type: 'commune', territoire: '22001' },
    { requireAllThemes: true },
  )
  validated.cohortTerritories = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/territoires.json'), 'utf8'))
  return validated
}

function nativeSemanticFetch(requests: Array<Array<Record<string, any>>> = []) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/resources') return nativeCatalogueResponse()
    if (url === '/api/resources/read-batch') {
      const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
      requests.push(items)
      return nativeBatchResponse(items, nativeReadFixture)
    }
    throw new Error(`Unexpected request: ${url}`)
  })
}

function modelFor(territoire: string) {
  const target = territoiresFixture.find((candidate) => candidate.territoire === territoire)!
  const themes = Object.fromEntries(
    (['programmes', 'demographie', 'habitat'] as Theme[]).map((theme) => [theme, {
      theme,
      indicateurs: indicateurs.filter((row) => row.theme === theme),
      histoires: histoires.filter((row) => row.theme === theme),
      theme_metadata: metadonneesThemesFixtures[theme],
      profils_acces_bpe: null,
      distribution_acces_batiments: null,
      rampe_acces_batiments: null,
    }]),
  )
  return validerModeleTerritoire({
    schema_version: '1',
    snapshot_id: '2026-09-15',
    territory: target,
    territoires: territoiresFixture,
    themes,
  }, `territoires/${target.type}/${territoire}.json`, {
    type: target.type,
    territoire,
  })
}

async function monter(
  chemin: string,
  charger: ChargerModeleTerritoire = vi.fn(async (_type, territoire) => modelFor(territoire)),
) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(chemin)
  await router.isReady()
  const wrapper = mount(TerritoireView, {
    global: {
      plugins: [router],
      provide: { [TERRITORY_READ_MODEL_CHARGER_KEY]: charger },
    },
  })
  await flushPromises()
  return { router, wrapper, charger }
}

async function monterNoteComparaison(mode: 'densite' | 'epci' | 'bretagne') {
  const model = modeleAvecContextesComparaison()
  const contexts = model.themes.mobilite!.comparisons
  const options = optionsContexteComparaison({ territoire: model.territory, contextes: contexts })
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(`/territoire/commune/22001?theme=mobilite&comparaison=${mode}`)
  await router.isReady()
  const wrapper = mount(CahierComparisonNote, {
    props: { label: contexts[mode]!.scope.label },
    global: {
      plugins: [router],
      provide: { [OPTIONS_COMPARAISON_KEY]: computed(() => options) },
    },
  })
  return { model, router, wrapper }
}

describe('TerritoireView — modèle atomique par territoire', () => {
  it('ouvre la fiche Programmes par défaut depuis les ressources sémantiques natives, sans route thème ni repli statique', async () => {
    const model = modeleAvecContextesComparaison()
    const requests: Array<Array<Record<string, any>>> = []
    const programmeResources = nativeResources('programmes')
    const series = programmeResources.find((resource) => resource.shapes.includes('ordered_series'))!
    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/api/resources/read-batch') {
        const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
        requests.push(items)
        return nativeBatchResponse(items, (item, resource) => {
          const data = nativeReadFixture(item, resource)
          if (item.intent.kind !== 'facts') return data
          const facts = model.themes.programmes!.indicators.filter((fact) =>
            fact.key === resource.resource_id && fact.dimension !== null && fact.dimension !== undefined)
          if (!facts.length) return data
          const sourceId = resource.sources[0]!
          const provenance = (fact: Indicateur) => ({ source_id: sourceId,
            source_name: fact.vintage_source, vintage_id: `${sourceId}-${fact.vintage_version}`,
            version: fact.vintage_version, reference_date: fact.vintage_date_reference,
            publication_date: fact.vintage_date_publication, revision_id: 'fixture-revision',
            dataset_name: resource.resource_id, revision_hash: 'fixture-revision-hash' })
          if (resource.resource_id === series.resource_id) {
            const periods = facts.map((fact) => String(fact.dimension))
            return { ...data, axis_values: periods, axis_numeric_values: periods.map(Number),
              points: facts.map((fact) => ({ axis: String(fact.dimension), observation_period: String(fact.dimension),
                // A distinct sentinel proves the native response, not the static row, drives the displayed value.
                value: 9_999_999, status: 'measured', missing_reason: null,
                provenance: [provenance(fact)] })) }
          }
          // This distinct amount is a test sentinel on a producer-backed
          // period/detail observation, not a claim about its published value.
          return { ...data, unit: resource.unit, entries: facts.map((fact) => ({
            detail: fact.detail, label: fact.detail, observation_period: String(fact.dimension),
            value: 9_876, status: 'measured', sources: [{ source_id: sourceId,
              name: fact.vintage_source, version: fact.vintage_version,
              reference_date: fact.vintage_date_reference, publication_date: fact.vintage_date_publication }],
          })) }
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1')
    vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/22001', vi.fn(async () => model))
    await flushPromises()
    expect(fetchApi.mock.calls.some(([url]) => String(url) === '/api/resources')).toBe(true)
    expect(fetchApi.mock.calls.some(([url]) => String(url) === '/api/resources/read-batch'),
      `fetch calls: ${JSON.stringify(fetchApi.mock.calls.map(([url]) => String(url)))}`).toBe(true)
    const expectedReads = programmeResources.flatMap((resource) => resource.target_kinds.includes('territory') &&
      resource.intents.includes('facts')
      ? [[resource.resource_id, 'facts'], ...(resource.intents.includes('fixed_comparison')
        ? [[resource.resource_id, 'fixed_comparison']] : [])]
      : [])
    expect(requests[0]?.map((item) => [item.resource, item.intent.kind])).toEqual(expectedReads)
    expect(requests[0]?.every((item) => item.target.kind === 'territory' && item.target.id === model.territory.territoire)).toBe(true)
    const text = wrapper.get('[role="tabpanel"]').text()
    const alert = wrapper.find('[role="alert"]')
    expect(alert.exists()).toBe(false)
    expect(text).toContain('10,00 M€')
    expect(text).toContain('Subventions attribuées')
    expect(text).toContain(model.themes.programmes!.indicators
      .find((fact) => fact.key === series.resource_id)!.vintage_source)
    expect(text).toContain('9 876 €')
    expect(text).not.toContain('1 600 €')
    expect(fetchApi.mock.calls.some(([url]) => String(url).includes('/themes/'))).toBe(false)
    expect(fetchApi.mock.calls.filter(([url]) => String(url) === '/api/resources/read-batch').length).toBeGreaterThan(0)
    wrapper.unmount()
  }, 20000)

  it('keeps the measured Programmes year visible when a legacy no-record axis follows it', async () => {
    const model = modeleAvecContextesComparaison()
    const legacy = nativeResources('programmes').find((resource) =>
      resource.resource_id === 'subventions_annuelles')!
    const producerMetadata = JSON.parse(readFileSync(resolve(process.cwd(),
      '../public/data/theme_programmes.json'), 'utf8'))
    // The real territory loader reconciles this canonical catalogue over the
    // snapshot's older per-territory metadata before semantic acquisition.
    model.themes.programmes!.metadata.indicator_pages =
      validerThemeMetadata(producerMetadata, 'theme_programmes.json').indicator_pages
    const sourceId = legacy.sources[0]!
    const descriptorVintageId = producerMetadata.source_records[sourceId].vintages[0].id
    const requests: Array<Array<Record<string, any>>> = []
    const focalReads: Array<Record<string, any>> = []
    let successfulComparison: Record<string, any> | undefined
    let comparisonAttempts = 0
    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/resources') return new Response(JSON.stringify({
        contract: 'semantic-resource-catalogue-v1', resources: [legacy],
      }))
      if (url === '/api/resources/read-batch') {
        const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
        requests.push(items)
        if (items.some((item) => item.intent.kind === 'facts') &&
            items.some((item) => item.intent.kind === 'fixed_comparison')) {
          return new Response('paired legacy snapshot unavailable', { status: 503 })
        }
        if (items.every((item) => item.intent.kind === 'facts')) {
          return new Response(JSON.stringify({ contract: 'semantic-read-batch-v1', results: items.map((item) => {
            const data = { resource: legacy.resource_id, target: item.target,
              publication_id: 'legacy-series-v1',
              territory: { id: item.target.id, type: item.target.type, name: model.territory.nom },
              indicator_id: legacy.indicator_id, axis_kind: 'year', completeness: 'may_be_missing',
              label: legacy.label, unit: legacy.unit, direction: legacy.direction,
              descriptor_version: 'legacy-series-descriptor-v1', comparison_point: null,
              points: [
                { axis: '2024', status: 'measured', observation_period: '2024', value: 230,
                  source_id: sourceId, vintage_id: 'api-vintage-2027', source_version: 'api-v7-updated',
                  source_reference_date: null, source_publication_date: '2027-09-01' },
                { axis: '2025', status: 'missing', observation_period: null, value: null,
                  source_id: sourceId, vintage_id: descriptorVintageId, source_version: null,
                  source_reference_date: null, source_publication_date: null },
              ], availability: 'incomplete' }
            focalReads.push(data)
            return { id: item.id, resource: item.resource, data }
          }) }))
        }
        if (comparisonAttempts++ === 0) return new Response('comparison retry offline', { status: 503 })
        return new Response(JSON.stringify({ contract: 'semantic-read-batch-v1', results: items.map((item) => {
          const data = { resource: legacy.resource_id, target: item.target,
            contract: 'indicator-comparison-v1', complete_theme: false,
            indicator_id: legacy.indicator_id, shape: 'series', content_version: 'legacy-series-v1',
            reference_content_version: 'legacy-reference-v1', selection: null,
            scope: { kind: 'density_class', territory_type: 'commune',
              density_class_code: model.territory.classe_densite_code, member_count: 2 },
            result: { indicator_id: legacy.indicator_id, label: legacy.label, facet: null,
              source_facet: null, unit: legacy.unit, direction: legacy.direction,
              descriptor_version: 'legacy-series-descriptor-v1', status: 'unavailable',
              reason: 'unsupported_comparison_contract', selected_member_count: 2,
              eligible_count: 0, missing_count: 2, median: null, rank: null, comparison_sources: [] } }
          successfulComparison = data
          return { id: item.id, resource: item.resource, data }
        }) }))
      }
      if (url.startsWith('/data/')) {
        return new Response(readFileSync(resolve(process.cwd(), `../public/data/${url.slice('/data/'.length)}`), 'utf8'))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1')
    vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/22001', vi.fn(async () => model))
    await flushPromises()

    expect(focalReads[0]).not.toHaveProperty('dataset_id')
    expect(focalReads[0]).not.toHaveProperty('reference_content_version')
    expect(wrapper.get('[role="alert"]').text()).toContain('Les comparaisons de ce thème ne sont pas disponibles.')
    expect(wrapper.find('.subvention-total').text()).toContain('230 €')
    expect(wrapper.find('.subvention-total').text()).toContain('en 2024')
    expect(wrapper.find('.subvention-total').text()).not.toMatch(/(^|\s)0\s*€/)
    expect(wrapper.find('.subvention-vintage').text()).toContain('Région Bretagne')
    const renderedPayload = wrapper.findComponent(BlocProgrammes).props('payload') as Payload
    const renderedAnnual = renderedPayload.indicateurs.filter((row) => row.territoire === '22001' &&
      row.theme === 'programmes' && row.key === 'subventions_annuelles')
    expect(renderedAnnual.map((row) => [row.dimension, row.value, row.observation_status])).toEqual([
      ['2024', 230, 'measured'], ['2025', null, 'missing'],
    ])
    expect(renderedAnnual[1]).toMatchObject({ source_id: sourceId, vintage_id: descriptorVintageId,
      source_version: null, source_reference_date: null, source_publication_date: null,
      vintage_version: null, vintage_date_reference: null, vintage_date_publication: null })
    expect(renderedAnnual[1]).not.toHaveProperty('fact_sources')
    expect(requests.map((items) => items.map((item) => item.intent.kind))).toEqual([
      ['facts', 'fixed_comparison'], ['facts'], ['fixed_comparison'],
    ])

    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()

    expect(requests).toHaveLength(4)
    expect(requests[3]!.map((item) => item.intent.kind)).toEqual(['fixed_comparison'])
    const comparison = { theme_id: 'programmes' as const, comparison_reads: [{
      resource: legacy.resource_id, shapes: legacy.shapes, declaration: legacy, data: successfulComparison!,
    }] }
    expect(() => validerReponseComparaisonTheme('programmes', comparison, undefined,
      { type: 'commune', id: '22001' })).not.toThrow()
    expect(() => semanticComparisonForTheme(comparison, {
      target: { territoire: '22001', type: 'commune', classe_densite_code: model.territory.classe_densite_code },
      territories: model.cohortTerritories,
    }, [{ resource: legacy.resource_id, shapes: legacy.shapes, declaration: legacy, data: focalReads[0]! }],
    { type: 'commune', id: '22001' })).not.toThrow()
    expect(wrapper.findAll('[role="alert"]').map((alert) => alert.text())).toEqual([])
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('Programmes et subventions')
    expect(focalReads).toHaveLength(1)
    wrapper.unmount()
  })

  it('selects a commune EPCI perimeter by its typed parent identity without loading scalar cohorts', async () => {
    Reflect.deleteProperty(import.meta.env, 'VITE_THEME_ACQUISITION_API')
    Reflect.deleteProperty(import.meta.env, 'VITE_SCALAR_COHORT_API')
    Reflect.deleteProperty(process.env, 'VITE_THEME_ACQUISITION_API')
    Reflect.deleteProperty(process.env, 'VITE_SCALAR_COHORT_API')
    expect(import.meta.env.VITE_THEME_ACQUISITION_API).toBeUndefined()
    expect(import.meta.env.VITE_SCALAR_COHORT_API).toBeUndefined()

    const territoryId = '22285'
    const file = `territoires/commune/${territoryId}.json`
    const published = JSON.parse(readFileSync(resolve(process.cwd(), `../public/data/modeles-lecture/${file}`), 'utf8'))
    const model = validerModeleTerritoire(published, file, { type: 'commune', territoire: territoryId },
      { requireAllThemes: true })
    expect(model.cohortTerritories).toBeUndefined()
    const parent = model.territories.find((candidate) => candidate.type === 'epci' &&
      candidate.territoire === model.territory.epci)!
    const region = model.territories.find((candidate) => candidate.type === 'region')!
    const reference = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/territoires.json'), 'utf8'))
    const resolvedMembers = reference.filter((candidate: any) => candidate.type === 'commune' &&
      candidate.epci === parent.territoire)
    const resolvedBretagne = reference.filter((candidate: any) => candidate.type === 'commune')
    expect(resolvedMembers.length).toBeGreaterThan(1)

    const legacy = nativeResources('programmes').find((resource) =>
      resource.resource_id === 'subventions_annuelles')!
    const sourceId = legacy.sources[0]!
    const vintageId = model.themes.programmes!.metadata.source_records?.[sourceId]?.vintages?.[0]?.id
    expect(vintageId).toBeTruthy()
    const descriptorVersion = 'programmes-series-descriptor-v1'
    const publicationVersion = 'programmes-api-facts-sentinel-v1'
    const factValue = 987654
    const requests: Array<Array<Record<string, any>>> = []
    const selectedReads: Array<Record<string, any>> = []

    const comparisonData = (item: Record<string, any>) => {
      const isSelected = item.intent.kind === 'selected_comparison'
      const selection = isSelected ? item.intent.members.map((member: { type: string; id: string }) => ({
        territory_type: member.type, territory_id: member.id,
      })) : null
      // Model the API resolver: one typed EPCI identity expands against the
      // canonical reference to the actual commune perimeter used for rank.
      const selectedIdentity = selection?.[0]
      const resolvedSelection = selection?.length === 0 ? [] : selectedIdentity?.territory_type === 'epci'
        ? resolvedMembers : selectedIdentity?.territory_type === 'region' ? resolvedBretagne : []
      const memberCount = isSelected ? resolvedSelection.length : reference.filter((candidate: any) =>
        candidate.type === 'commune' && candidate.classe_densite_code === model.territory.classe_densite_code).length
      const data = { resource: legacy.resource_id, target: item.target,
        contract: 'indicator-comparison-v1', complete_theme: false,
        indicator_id: legacy.indicator_id, shape: 'series', content_version: publicationVersion,
        reference_content_version: 'programmes-reference-v1', selection,
        scope: isSelected ? { kind: 'explicit_selection', member_count: memberCount }
          : { kind: 'density_class', territory_type: 'commune',
            density_class_code: model.territory.classe_densite_code, member_count: memberCount },
        result: { indicator_id: legacy.indicator_id, source_facet: '2024', unit: legacy.unit,
          direction: legacy.direction, descriptor_version: descriptorVersion, status: 'available',
          selected_member_count: memberCount, eligible_count: memberCount, missing_count: 0,
          median: factValue, rank: 1, rank_size: memberCount } }
      if (isSelected) selectedReads.push(data)
      return data
    }

    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/resources') {
        return new Response(JSON.stringify({ contract: 'semantic-resource-catalogue-v1', resources: [legacy] }))
      }
      if (url !== '/api/resources/read-batch') throw new Error(`Unexpected request: ${url}`)
      const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
      requests.push(items)
      return nativeBatchResponse(items, (item) => {
        if (item.intent.kind !== 'facts') return comparisonData(item)
        return { resource: legacy.resource_id, target: item.target,
          publication_id: publicationVersion,
          territory: { id: territoryId, type: 'commune', name: model.territory.nom },
          indicator_id: legacy.indicator_id, axis_kind: 'year', completeness: 'may_be_missing',
          label: legacy.label, unit: legacy.unit, direction: legacy.direction,
          descriptor_version: descriptorVersion, comparison_point: '2024',
          points: [{ axis: '2024', status: 'measured', observation_period: '2024', value: factValue,
            source_id: sourceId, vintage_id: vintageId, source_version: 'api-facts-clock-v1',
            source_reference_date: null, source_publication_date: '2026-08-05' }],
          availability: 'observed' }
      })
    })
    vi.stubGlobal('fetch', fetchApi)
    const { router, wrapper } = await monter(`/territoire/commune/${territoryId}?theme=programmes`,
      vi.fn(async () => model))
    await flushPromises()

    expect(wrapper.find('.subvention-total').text()).toContain('987')
    expect(requests).toHaveLength(1)
    expect(requests[0]!.map((item) => item.intent.kind)).toEqual(['facts', 'fixed_comparison'])

    await router.replace({ query: { theme: 'programmes', comparaison: 'epci' } })
    await flushPromises()

    const selectedBatch = requests.at(-1)!
    const selectedItem = selectedBatch.find((item) => item.intent.kind === 'selected_comparison')!
    expect(selectedItem.intent.members).toEqual([{ type: 'epci', id: parent.territoire }])
    expect(selectedBatch.every((item) => item.intent.kind === 'selected_comparison')).toBe(true)
    expect(requests.flat().filter((item) => item.intent.kind === 'facts')).toHaveLength(1)
    expect(wrapper.find('.subvention-total').text()).toContain('987')
    expect(selectedReads.at(-1)?.selection).toEqual([{ territory_type: 'epci', territory_id: parent.territoire }])
    expect(selectedReads.at(-1)?.scope.member_count).toBe(resolvedMembers.length)
    expect(selectedReads.at(-1)?.result.selected_member_count).toBe(resolvedMembers.length)
    expect(selectedReads.at(-1)?.result.rank_size).toBe(resolvedMembers.length)
    const renderedPayload = wrapper.findComponent(BlocProgrammes).props('payload') as Payload
    const annual = renderedPayload.indicateurs.find((row) => row.territoire === territoryId &&
      row.theme === 'programmes' && row.key === 'subventions_annuelles')
    expect(annual?.comparaisonApi).toMatchObject({ rang: 1, taille: resolvedMembers.length,
      portee: model.themes.mobilite!.comparisons.epci!.scope.label, direction: 'high' })
    expect(wrapper.findAll('[role="alert"]').map((alert) => alert.text())).toEqual([])

    const epciRead = selectedReads.at(-1)
    await router.replace({ query: { theme: 'programmes', comparaison: 'bretagne' } })
    await flushPromises()
    const bretagneBatch = requests.at(-1)!
    const bretagneItem = bretagneBatch.find((item) => item.intent.kind === 'selected_comparison')!
    expect(bretagneItem.intent.members).toEqual([{ type: 'region', id: region.territoire }])
    expect(bretagneBatch.every((item) => item.intent.kind === 'selected_comparison')).toBe(true)
    expect(requests.flat().filter((item) => item.intent.kind === 'facts')).toHaveLength(1)
    expect(selectedReads.at(-1)?.selection).toEqual([{ territory_type: 'region', territory_id: region.territoire }])
    expect(selectedReads.at(-1)?.scope.member_count).toBe(resolvedBretagne.length)
    expect(selectedReads.at(-1)?.result.selected_member_count).toBe(resolvedBretagne.length)
    expect(selectedReads.at(-1)?.result.rank_size).toBe(resolvedBretagne.length)
    expect(epciRead?.result.selected_member_count).toBe(resolvedMembers.length)
    const bretagnePayload = wrapper.findComponent(BlocProgrammes).props('payload') as Payload
    const bretagneAnnual = bretagnePayload.indicateurs.find((row) => row.territoire === territoryId &&
      row.theme === 'programmes' && row.key === 'subventions_annuelles')
    expect(bretagneAnnual?.comparaisonApi).toMatchObject({ rang: 1, taille: resolvedBretagne.length,
      portee: model.themes.mobilite!.comparisons.bretagne!.scope.label, direction: 'high' })
    expect(wrapper.findAll('[role="alert"]').map((alert) => alert.text())).toEqual([])

    // If a named scope's canonical identity is missing, fail closed rather
    // than send [] or silently request the density/default comparison.
    model.territories = model.territories.filter((candidate) => candidate.type !== 'epci')
    const requestCountBeforeMissingParent = requests.length
    await router.replace({ query: { theme: 'programmes', comparaison: 'epci' } })
    await flushPromises()
    expect(requests).toHaveLength(requestCountBeforeMissingParent)
    expect(wrapper.find('[role="alert"]').text()).toContain('Réessayer')
    wrapper.unmount()
  })

  it('ne rend pas la section subventions quand les lectures natives déclarent leur absence', async () => {
    const model = modeleAvecContextesComparaison()
    expect(model.themes.programmes!.indicators.some((fact) => fact.key === 'subventions_annuelles')).toBe(true)
    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/api/resources/read-batch') {
        const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
        return nativeBatchResponse(items, (item, resource) => {
          const data = nativeReadFixture(item, resource)
          if (item.intent.kind !== 'facts') return data
          if (resource.shapes.includes('anchored_membership')) {
            return { ...data, availability: 'no_record', entries: [], relationships: [], summaries: [] }
          }
          if (resource.shapes.includes('ordered_series')) {
            return { ...data, axis_values: [], axis_numeric_values: [], points: [], availability: 'no_record' }
          }
          if (resource.shapes.includes('period_detail')) {
            return { ...data, entries: [], availability: 'no_record' }
          }
          return data
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1')
    vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/22001', vi.fn(async () => model))

    expect(wrapper.get('[role="tabpanel"]').text()).toContain('Aucun programme référencé.')
    expect(wrapper.find('.programme-subventions').exists()).toBe(false)
    expect(wrapper.find('.subvention-total').exists()).toBe(false)
    expect(fetchApi.mock.calls.some(([url]) => String(url).includes('/themes/'))).toBe(false)
    wrapper.unmount()
  })

  it('acquiert et réchauffe les faits natifs des thèmes, puis réutilise le cache pendant la navigation', async () => {
    const requests: Array<Array<Record<string, any>>> = []
    const fetchApi = nativeSemanticFetch(requests)
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1')
    vi.stubGlobal('fetch', nativeSemanticFetch())
    const model = modeleAvecContextesComparaison()
    const activityLabel = (model.themes.economie!.histories[0] as any).top1_activity_label as string
    const acquired = await acquireThemeFacts('commune', '22001', 'programmes')
    expect(() => themeFactsRowsFromSemantic('programmes', acquired, {
      territoire: '22001', type: 'commune' })).not.toThrow()
    const acquiredHabitat = await acquireThemeFacts('commune', '22001', 'habitat')
    expect(() => themeFactsRowsFromSemantic('habitat', acquiredHabitat, {
      territoire: '22001', type: 'commune' })).not.toThrow()
    vi.stubGlobal('fetch', fetchApi)
    const { router, wrapper } = await monter('/territoire/commune/22001', vi.fn(async () => model))

    expect(wrapper.get('[role="tabpanel"]').text()).toContain('Programmes et subventions')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    const themeByResource = new Map(nativeResources().map((resource) => [resource.resource_id, resource.theme_id]))
    const requestsByTheme = () => Object.fromEntries(
      ['programmes', 'habitat', 'demographie', 'milieux', 'economie', 'mobilite'].map((theme) => [theme,
        requests.filter((items) => items.some((item) => themeByResource.get(item.resource) === theme)).length]),
    )
    const warmedCounts = requestsByTheme()
    const themeRequests = requests.filter((items) => items.some((item) => themeByResource.has(item.resource)))

    expect(themeRequests[0]?.every((item) => themeByResource.get(item.resource) === 'programmes')).toBe(true)
    expect(Object.values(warmedCounts).every((count) => count > 0)).toBe(true)
    expect(requests.every((items) => items.length >= 1 && items.length <= 12)).toBe(true)
    expect(fetchApi.mock.calls.some(([url]) => String(url).includes('/themes/'))).toBe(false)

    for (const [theme, heading] of [
      ['habitat', 'Part de passoires thermiques'],
      ['demographie', 'Densité de population'],
      ['milieux', 'Consommation d’ENAF'],
      ['economie', 'Chômage'],
      ['mobilite', 'Mobilité'],
    ] as const) {
      await router.replace({ query: { theme } })
      await flushPromises()
      expect(wrapper.get('[role="tabpanel"]').text(),
        `${theme}; alert=${wrapper.find('[role="alert"]').exists() ? wrapper.find('[role="alert"]').text() : 'none'}; calls=${JSON.stringify(fetchApi.mock.calls.map(([url]) => String(url)))}`)
        .toContain(heading)
      if (theme === 'demographie') {
        // The native typed-reading descriptor publishes rate_unit and cohort facts.
        expect(wrapper.find('[role="alert"]').exists()).toBe(false)
        expect(wrapper.get('[data-clef="densite"] .valeur-numerique').text()).toBe('24,45')
      } else if (theme === 'habitat') {
        const passoires = nativeResources(theme).find((resource) => resource.resource_id === 'part_passoires')!
        expect(wrapper.get(`[data-clef="${passoires.resource_id}"] .valeur-numerique`).text()).toBe('13')
      } else if (theme === 'milieux') {
        const publishedReading = model.themes.milieux!.histories[0]!
        const period = (publishedReading as any).periode_pop as string
        const visibleResource = nativeResources(theme).find((resource) =>
          resource.shapes.includes('ordered_series') && resource.target_kinds.includes('territory'))!
        expect(wrapper.get('[role="tabpanel"]').text()).toContain(period)
        expect(wrapper.get('[role="tabpanel"]').text()).toContain(model.themes.milieux!.indicators
          .find((fact) => fact.key === visibleResource.resource_id)!.vintage_source)
      } else if (theme === 'economie') {
        expect(wrapper.get('[role="tabpanel"]').text()).toContain(activityLabel)
      } else {
        expect(wrapper.find('[role="alert"]').exists()).toBe(false)
      }
    }

    const namedResource = nativeResources('mobilite').find((resource) => resource.shapes.includes('named_reference'))!
    const curveResource = nativeResources('mobilite').find((resource) => resource.resource_id === 'raccordement_courbe')!
    const mobilityReads = requests.flat()
    expect(mobilityReads.some((item) => item.resource === namedResource.resource_id &&
      item.target.kind === 'named_reference' && namedResource.target_ids.includes(item.target.id))).toBe(true)
    expect(mobilityReads.some((item) => item.resource === curveResource.resource_id && item.intent.kind === 'facts')).toBe(true)

    expect(requestsByTheme()).toEqual(warmedCounts)
    wrapper.unmount()
  })

  it('ne laisse pas un échec de réchauffage natif entacher le thème actif et le réessaie à la visite', async () => {
    const requests: Array<Array<Record<string, any>>> = []
    let failedEconomyWarmup = false
    const economyResources = new Set(nativeResources('economie').map((resource) => resource.resource_id))
    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/api/resources/read-batch') {
        const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
        requests.push(items)
        if (!failedEconomyWarmup && items.some((item) => economyResources.has(item.resource) &&
            item.target.kind === 'territory' && item.intent.kind === 'facts')) {
          failedEconomyWarmup = true
          return new Response('background fixture unavailable', { status: 503 })
        }
        return nativeBatchResponse(items, nativeReadFixture)
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1')
    vi.stubGlobal('fetch', fetchApi)
    const model = modeleAvecContextesComparaison()
    const { router, wrapper } = await monter('/territoire/commune/22001', vi.fn(async () => model))
    await flushPromises()

    expect(failedEconomyWarmup).toBe(true)
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('Programmes et subventions')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    const beforeVisit = requests.filter((items) => items.some((item) => economyResources.has(item.resource))).length

    await router.replace({ query: { theme: 'economie' } })
    await flushPromises()

    expect(requests.filter((items) => items.some((item) => economyResources.has(item.resource))).length)
      .toBeGreaterThan(beforeVisit)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('Chômage')
    wrapper.unmount()
  })

  it('ignore les faits natifs tardifs d’un thème quitté sans remplacer le thème courant', async () => {
    const requests: Array<Array<Record<string, any>>> = []
    const habitatResources = new Set(nativeResources('habitat').map((resource) => resource.resource_id))
    let resolveHabitat: (() => void) | undefined
    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/api/resources/read-batch') {
        const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
        requests.push(items)
        if (!resolveHabitat && items.some((item) => habitatResources.has(item.resource) &&
            item.target.kind === 'territory' && item.intent.kind === 'facts')) {
          return new Promise<Response>((resolve) => {
            resolveHabitat = () => resolve(nativeBatchResponse(items, nativeReadFixture))
          })
        }
        return nativeBatchResponse(items, nativeReadFixture)
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1')
    vi.stubGlobal('fetch', fetchApi)
    const model = modeleAvecContextesComparaison()
    const { router, wrapper } = await monter('/territoire/commune/22001?theme=habitat', vi.fn(async () => model))
    expect(resolveHabitat).toBeTypeOf('function')

    await router.replace({ query: { theme: 'economie' } })
    await flushPromises()
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('Chômage')
    expect(requests.flat().some((item) => item.resource === 'economie_selected_reading')).toBe(true)

    resolveHabitat!()
    await flushPromises()
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('Chômage')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('réessaie une acquisition native du thème après échec, sans repli sur les faits statiques', async () => {
    const requests: Array<Array<Record<string, any>>> = []
    const habitatResources = new Set(nativeResources('habitat').map((resource) => resource.resource_id))
    let failedPairedRead = false
    let failedFactsRecovery = false
    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/api/resources/read-batch') {
        const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
        requests.push(items)
        const habitatFocalReads = items.filter((item) =>
          habitatResources.has(item.resource) && item.target.kind === 'territory')
        if (!failedPairedRead && habitatFocalReads.some((item) => item.intent.kind === 'fixed_comparison')) {
          failedPairedRead = true
          return new Response('fixture unavailable', { status: 503 })
        }
        if (failedPairedRead && !failedFactsRecovery && habitatFocalReads.length > 0 &&
            habitatFocalReads.every((item) => item.intent.kind === 'facts')) {
          failedFactsRecovery = true
          return new Response('fixture unavailable', { status: 503 })
        }
        return nativeBatchResponse(items, nativeReadFixture)
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1')
    vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/22001?theme=habitat',
      vi.fn(async () => modeleAvecContextesComparaison()))

    expect(wrapper.get('[role="alert"]').text()).toContain('indicateurs de ce thème')
    expect(failedPairedRead).toBe(true)
    expect(failedFactsRecovery).toBe(true)
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()

    expect(failedPairedRead).toBe(true)
    expect(failedFactsRecovery).toBe(true)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    const passoires = nativeResources('habitat').find((resource) => resource.resource_id === 'part_passoires')!
    expect(wrapper.get(`[data-clef="${passoires.resource_id}"] .valeur-numerique`).text()).toBe('13')
    expect(requests.every((items) => items.length >= 1 && items.length <= 12)).toBe(true)
    expect(fetchApi.mock.calls.some(([url]) => String(url).includes('/themes/'))).toBe(false)
    wrapper.unmount()
  })

  it('masque les faits Habitat statiques pendant la lecture native en attente', async () => {
    const requests: Array<Array<Record<string, any>>> = []
    let resolveFirstRead: (() => void) | undefined
    let shouldDefer = true
    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/api/resources/read-batch') {
        const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
        requests.push(items)
        if (shouldDefer && items.some((item) => item.target.kind === 'territory')) {
          shouldDefer = false
          return new Promise<Response>((resolve) => {
            resolveFirstRead = () => resolve(nativeBatchResponse(items, nativeReadFixture))
          })
        }
        return nativeBatchResponse(items, nativeReadFixture)
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1')
    vi.stubGlobal('fetch', fetchApi)
    const model = modeleAvecContextesComparaison()
    const { wrapper } = await monter('/territoire/commune/22001?theme=habitat',
      vi.fn(async () => model))
    const passoires = nativeResources('habitat').find((resource) => resource.resource_id === 'part_passoires')!
    const sourceLabel = model.themes.habitat!.indicators.find((fact) =>
      fact.key === passoires.resource_id)!.vintage_source

    expect(requests.length).toBeGreaterThan(0)
    expect(resolveFirstRead).toBeTypeOf('function')
    expect(wrapper.get('[role="tabpanel"]').text()).not.toContain(sourceLabel)
    resolveFirstRead!()
    await flushPromises()

    expect(wrapper.get('[role="tabpanel"]').text()).toContain(sourceLabel)
    expect(wrapper.get(`[data-clef="${passoires.resource_id}"] .valeur-numerique`).text()).toBe('13')
    wrapper.unmount()
  })

  it('ne remplace pas les faits focaux lorsqu’une comparaison native échoue puis est réessayée', async () => {
    const requests: Array<Array<Record<string, any>>> = []
    let selectedFailures = 1
    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/api/resources/read-batch') {
        const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
        requests.push(items)
        if (items.some((item) => item.intent.kind === 'selected_comparison') && selectedFailures > 0) {
          selectedFailures--
          return new Response('comparison unavailable', { status: 503 })
        }
        return nativeBatchResponse(items, nativeReadFixture)
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1')
    vi.stubGlobal('fetch', fetchApi)
    const model = modeleAvecContextesComparaison()
    const activityLabel = (model.themes.economie!.histories[0] as any).top1_activity_label as string
    const { wrapper } = await monter('/territoire/commune/22001?theme=economie&comparaison=epci',
      vi.fn(async () => model))
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('comparaisons de ce thème')
    expect(wrapper.get('[role="tabpanel"]').text()).toContain(activityLabel)
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()

    const selectedReads = requests.filter((items) => items.some((item) => item.intent.kind === 'selected_comparison'))
    expect(selectedReads).toHaveLength(2)
    expect(selectedReads[1]!.every((item) => item.intent.kind === 'selected_comparison')).toBe(true)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.get('[role="tabpanel"]').text()).toContain(activityLabel)
    expect(fetchApi.mock.calls.some(([url]) => String(url).includes('/themes/'))).toBe(false)
    wrapper.unmount()
  })

  it('ignore une réponse de comparaison native périmée après un changement de portée', async () => {
    const requests: Array<Array<Record<string, any>>> = []
    let resolveOldComparison: (() => void) | undefined
    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/api/resources/read-batch') {
        const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
        requests.push(items)
        const response = nativeBatchResponse(items, nativeReadFixture)
        if (!resolveOldComparison && items.some((item) => item.intent.kind === 'selected_comparison')) {
          return new Promise<Response>((resolve) => {
            resolveOldComparison = () => resolve(response)
          })
        }
        return response
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1')
    vi.stubGlobal('fetch', fetchApi)
    const model = modeleAvecContextesComparaison()
    const activityLabel = (model.themes.economie!.histories[0] as any).top1_activity_label as string
    const { router, wrapper } = await monter(
      '/territoire/commune/22001?theme=economie&comparaison=epci',
      vi.fn(async () => model),
    )
    expect(resolveOldComparison).toBeTypeOf('function')

    await router.replace({ query: { theme: 'economie', comparaison: 'bretagne' } })
    await flushPromises()
    const bretagne = model.territories.find((territory) => territory.type === 'region')!
    const selectedReads = requests.filter((items) =>
      items.some((item) => item.intent.kind === 'selected_comparison'))
    expect(selectedReads.at(-1)?.[0]?.intent.members).toEqual([{ type: bretagne.type, id: bretagne.territoire }])
    expect(wrapper.get('[role="tabpanel"]').text()).toContain(activityLabel)

    resolveOldComparison!()
    await flushPromises()
    expect(router.currentRoute.value.query.comparaison).toBe('bretagne')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.get('[role="tabpanel"]').text()).toContain(activityLabel)
    wrapper.unmount()
  })

  beforeEach(() => {
    // Tests which intentionally exercise the incumbent presentation path opt
    // out explicitly; acquisition-contract tests below turn the default API
    // path back on and provide native /api/resources fixtures.
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '0')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('API not configured in tests')))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    // Late Vue watchers/retries must never reach Happy DOM's real base URL.
    vi.stubGlobal('fetch', fetchBloque)
  })

  it('keeps the building figures without exposing an interactive peer selector', async () => {
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1')
    vi.stubGlobal('fetch', nativeSemanticFetch())
    const { wrapper } = await monter('/territoire/commune/22001?theme=mobilite',
      vi.fn(async () => modeleAvecContextesComparaison()))
    await flushPromises()
    expect(wrapper.find('#building-peer-search').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Choisir les territoires du groupe comparé')
    wrapper.unmount()
  })

  it('renders registered scalar API values in the mounted fiche instead of the static model value', async () => {
    // La famille overlay vit sur un thème NON-mobilité : le cahier plié
    // (productionMobilite) possède l'acquisition Mobilité — le fan-out par
    // indicateur ne s'y déclenche jamais, qu'importe le drapeau.
    const metadata = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/theme_demographie.json'), 'utf8'))
    const registered = Object.keys(metadata.scalar_contracts) as string[]
    const published = JSON.parse(readFileSync(resolve(process.cwd(),
      '../public/data/modeles-lecture/territoires/commune/22001.json'), 'utf8'))
    expect(published.themes.demographie.theme_metadata.scalar_contracts).toBeUndefined()
    const pending: Array<() => void> = []
    const requestedIndicators: string[] = []
    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/data/')) {
        return new Response(readFileSync(resolve(process.cwd(), `../public/data/${url.slice('/data/'.length)}`), 'utf8'), { status: 200 })
      }
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/api/resources/read-batch') {
        const request = JSON.parse(init?.body as string) as { items: Array<Record<string, any>> }
        requestedIndicators.push(...request.items.map((item) => item.resource))
        const response = new Response(JSON.stringify(semanticScalarBatch('demographie', metadata,
          request.items, '22001', () => 987654321)), { status: 200 })
        return new Promise<Response>((resolve) => pending.push(() => resolve(response)))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubEnv('VITE_SCALAR_COHORT_API', '1')
    vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/22001?theme=demographie&comparaison=epci', chargerModeleTerritoire)
    expect(requestedIndicators).toHaveLength(registered.length * 2)
    expect(new Set(requestedIndicators)).toEqual(new Set(registered))
    expect(pending).toHaveLength(1)
    expect(wrapper.get('[role="tabpanel"]').text()).not.toContain('987 654 321')
    pending.forEach((resolve) => resolve())
    await flushPromises()
    const text = wrapper.get('[role="tabpanel"]').text()
    const batchCalls = fetchApi.mock.calls.filter(([url]) => String(url) === '/api/resources/read-batch')
    expect(batchCalls).toHaveLength(1)
    expect(fetchApi).toHaveBeenCalledWith('/data/theme_demographie.json')
    const batchRequest = JSON.parse((batchCalls[0]![1] as RequestInit).body as string)
    expect(batchRequest.items).toHaveLength(registered.length * 2)
    const factItems = batchRequest.items.filter((item: any) => item.target.kind === 'territory_cohort')
    const comparisonItems = batchRequest.items.filter((item: any) => item.target.kind === 'territory')
    expect(factItems).toHaveLength(registered.length)
    expect(comparisonItems).toHaveLength(registered.length)
    expect(factItems.every((item: any) => item.target.epci_id === published.territory.epci &&
      item.target.department_id === null)).toBe(true)
    expect(comparisonItems.every((item: any) => item.intent.kind === 'selected_comparison')).toBe(true)
    expect(fetchApi.mock.calls.some(([url]) => String(url).includes('/indicator-cohorts/'))).toBe(false)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(text).toContain('987')
    expect(text).toContain('98 765 432')
    expect(text).not.toContain('24,45')
    wrapper.unmount()
  })

  it('renders the default scalar rank and changes only comparison reads across fiche scopes, ignoring a late old scope', async () => {
    const metadata = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/theme_demographie.json'), 'utf8'))
    const references = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/territoires.json'), 'utf8')) as any[]
    const model = modeleAvecContextesComparaison()
    model.themes.demographie!.metadata = validerThemeMetadata(metadata, 'theme_demographie.json')
    const contextLabels = model.themes.mobilite!.comparisons
    const requests: Array<{ items: Array<Record<string, any>> }> = []
    let resolveLateEpci: (() => void) | undefined
    let epciAttempts = 0
    const responseFor = (item: Record<string, any>) => {
      const indicator = item.resource as string
      const page = metadata.indicator_pages[indicator]
      const contract = metadata.scalar_contracts[indicator]
      if (item.target.kind === 'territory_cohort') {
        const data = semanticScalarBatch('demographie', metadata, [item], '22001', () => 4321).results[0]!.data
        return { id: item.id, resource: indicator, data }
      }
      const selected = item.intent.kind === 'selected_comparison'
        ? item.intent.members.map((member: { type: string; id: string }) => references.find((ref) => ref.territoire === member.id)!)
        : item.target.type === 'commune'
          ? references.filter((ref) => ref.type === 'commune' && ref.classe_densite_code === references.find((ref) => ref.territoire === item.target.id)?.classe_densite_code)
          : references.filter((ref) => ref.type === item.target.type)
      const scope = item.intent.kind === 'selected_comparison'
        ? { kind: 'explicit_selection', member_count: selected.length }
        : item.target.type === 'commune'
          ? { kind: 'density_class', territory_type: 'commune',
              density_class_code: references.find((ref) => ref.territoire === item.target.id)?.classe_densite_code,
              member_count: selected.length }
          : { kind: 'same_level', territory_type: item.target.type, member_count: selected.length }
      const available = selected.length > 0
      return { id: item.id, resource: indicator, data: {
        resource: indicator, target: item.target, contract: 'indicator-comparison-v1', indicator_id: indicator,
        shape: 'scalar', content_version: 'demographie-scalar-test-v1', reference_content_version: 'reference-test-v1',
        selection: item.intent.kind === 'selected_comparison'
          ? item.intent.members.map((member: { type: string; id: string }) => ({ territory_type: member.type, territory_id: member.id }))
          : null,
        scope,
        result: { indicator_id: indicator, status: available ? 'available' : 'unavailable',
          unit: page.unit, direction: page.comparison?.direction ?? page.direction,
          source_facet: contract.comparison_facet, descriptor_version: 'scalar-descriptor-test-v1',
          selected_member_count: selected.length, eligible_count: selected.length, missing_count: 0,
          rank: available ? 1 : null, rank_size: available ? selected.length : null },
      } }
    }
    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/data/theme_demographie.json') return new Response(JSON.stringify(metadata), { status: 200 })
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/api/resources/read-batch') {
        const request = JSON.parse(init?.body as string) as { items: Array<Record<string, any>> }
        requests.push(request)
        const response = new Response(JSON.stringify({ contract: 'semantic-read-batch-v1',
          results: request.items.map(responseFor) }))
        const selection = request.items[0]?.intent
        const bretagneMemberCount = references.filter((reference) => reference.type === 'commune').length
        if (request.items.every((item) => item.target.kind === 'territory') && selection?.kind === 'selected_comparison' &&
            selection.members.some((member: { id: string }) => member.id === '22001') &&
            selection.members.length < bretagneMemberCount) {
          epciAttempts++
          if (epciAttempts === 1) return new Response('comparison unavailable', { status: 503 })
          if (epciAttempts === 2) return new Promise<Response>((resolve) => { resolveLateEpci = () => resolve(response) })
        }
        return response
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubEnv('VITE_SCALAR_COHORT_API', '1')
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '0')
    vi.stubGlobal('fetch', fetchApi)
    const { router, wrapper } = await monter('/territoire/commune/22001?theme=demographie', vi.fn(async () => model))
    await flushPromises()

    expect(requests.length).toBeGreaterThan(0)
    const focalFigure = wrapper.get('[data-clef="densite"]')
    const valueBefore = focalFigure.get('.valeur-numerique').text()
    expect(valueBefore).toBe('4 321')
    expect(focalFigure.get('.puce-rang-texte').text()).toContain(contextLabels.densite!.scope.label)
    const initialRequest = requests[0]!
    expect(initialRequest.items).toHaveLength(Object.keys(metadata.scalar_contracts).length * 2)
    expect(initialRequest.items.filter((item) => item.target.kind === 'territory_cohort')).toHaveLength(Object.keys(metadata.scalar_contracts).length)
    expect(initialRequest.items.filter((item) => item.target.kind === 'territory')).toHaveLength(Object.keys(metadata.scalar_contracts).length)

    await router.replace({ query: { theme: 'demographie', comparaison: 'epci' } })
    await flushPromises()
    expect(requests).toHaveLength(2)
    expect(requests[1]!.items.every((item) => item.target.kind === 'territory' && item.intent.kind === 'selected_comparison')).toBe(true)
    const focalReference = references.find((reference) => reference.type === 'commune' && reference.territoire === '22001')
    const epciMembers = references.filter((reference) => reference.type === 'commune' && reference.epci === focalReference?.epci)
      .map((reference) => ({ type: reference.type, id: reference.territoire }))
      .sort((left, right) => left.id.localeCompare(right.id))
    expect(requests[1]!.items[0]!.intent.members).toEqual(epciMembers)
    expect(wrapper.get('[role="alert"]').text()).toContain('rangs de comparaison')
    expect(wrapper.get('[data-clef="densite"] .valeur-numerique').text()).toBe(valueBefore)

    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(requests).toHaveLength(3)
    expect(requests[2]!.items.every((item) => item.target.kind === 'territory' && item.intent.kind === 'selected_comparison')).toBe(true)

    await router.replace({ query: { theme: 'demographie', comparaison: 'bretagne' } })
    await flushPromises()
    expect(requests).toHaveLength(4)
    expect(requests[3]!.items.every((item) => item.target.kind === 'territory' && item.intent.kind === 'selected_comparison')).toBe(true)
    const bretagneMembers = references.filter((reference) => reference.type === 'commune')
      .map((reference) => ({ type: reference.type, id: reference.territoire }))
      .sort((left, right) => left.id.localeCompare(right.id))
    expect(requests[3]!.items[0]!.intent.members).toEqual(bretagneMembers)
    const currentFigure = wrapper.get('[data-clef="densite"]')
    expect(currentFigure.get('.valeur-numerique').text()).toBe(valueBefore)
    expect(currentFigure.get('.puce-rang-texte').text()).toContain(contextLabels.bretagne!.scope.label)

    resolveLateEpci!()
    await flushPromises()
    expect(wrapper.get('[data-clef="densite"] .valeur-numerique').text()).toBe(valueBefore)
    expect(wrapper.get('[data-clef="densite"] .puce-rang-texte').text()).toContain(contextLabels.bretagne!.scope.label)
    expect(requests.slice(1).flatMap((request) => request.items).some((item) => item.target.kind === 'territory_cohort')).toBe(false)
    wrapper.unmount()
  })

  it('recovers focal scalar facts after an initial paired comparison failure and retries ranks only', async () => {
    const metadata = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/theme_demographie.json'), 'utf8'))
    metadata.scalar_contracts = { densite: metadata.scalar_contracts.densite }
    const model = modeleAvecContextesComparaison()
    model.themes.demographie!.metadata = validerThemeMetadata(metadata, 'theme_demographie.json')
    const requests: Array<{ items: Array<Record<string, any>> }> = []
    let comparisonAttempts = 0
    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/data/theme_demographie.json') return new Response(JSON.stringify(metadata), { status: 200 })
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/api/resources/read-batch') {
        const request = JSON.parse(init?.body as string) as { items: Array<Record<string, any>> }
        requests.push(request)
        if (request.items.some((item) => item.target.kind === 'territory_cohort') &&
            request.items.some((item) => item.target.kind === 'territory')) {
          return new Response('comparison unavailable in paired read', { status: 503 })
        }
        const batch = semanticScalarBatch('demographie', metadata, request.items, '22001', () => 77777)
        if (request.items.every((item) => item.target.kind === 'territory') && ++comparisonAttempts === 1) {
          batch.results.forEach((result: any) => { result.data.content_version = 'stale-scalar-publication' })
        }
        return new Response(JSON.stringify(batch))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubEnv('VITE_SCALAR_COHORT_API', '1')
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '0')
    vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/22001?theme=demographie', vi.fn(async () => model))
    await flushPromises()

    expect(requests).toHaveLength(2)
    expect(requests[0]!.items).toHaveLength(2)
    expect(requests[0]!.items.some((item) => item.target.kind === 'territory_cohort')).toBe(true)
    expect(requests[0]!.items.some((item) => item.target.kind === 'territory')).toBe(true)
    expect(requests[1]!.items).toHaveLength(1)
    expect(requests[1]!.items[0]!.target.kind).toBe('territory_cohort')
    const figure = wrapper.get('[data-clef="densite"]')
    expect(figure.get('.valeur-numerique').text()).toBe('77 777')
    expect(figure.find('.puce-rang-texte').exists()).toBe(false)
    expect(wrapper.get('[role="alert"]').text()).toContain('rangs de comparaison')

    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(requests).toHaveLength(3)
    expect(requests[2]!.items).toHaveLength(1)
    expect(requests[2]!.items[0]!.target.kind).toBe('territory')
    expect(requests[2]!.items[0]!.intent.kind).toBe('fixed_comparison')
    expect(wrapper.get('[data-clef="densite"] .valeur-numerique').text()).toBe('77 777')
    expect(wrapper.find('[data-clef="densite"] .puce-rang-texte').exists()).toBe(false)
    expect(wrapper.get('[role="alert"]').text()).toContain('rangs de comparaison')

    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(requests).toHaveLength(4)
    expect(requests[3]!.items).toHaveLength(1)
    expect(requests[3]!.items[0]!.target.kind).toBe('territory')
    expect(requests[3]!.items[0]!.intent.kind).toBe('fixed_comparison')
    expect(wrapper.get('[data-clef="densite"] .valeur-numerique').text()).toBe('77 777')
    expect(wrapper.get('[data-clef="densite"] .puce-rang-texte').text())
      .toContain(model.themes.mobilite!.comparisons.densite!.scope.label)
    expect(requests.slice(2).flatMap((request) => request.items).every((item) => item.target.kind === 'territory')).toBe(true)
    wrapper.unmount()
  })

  it('keeps scalar facts unavailable when both the paired read and facts-only recovery fail', async () => {
    const metadata = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/theme_demographie.json'), 'utf8'))
    metadata.scalar_contracts = { densite: metadata.scalar_contracts.densite }
    const model = modeleAvecContextesComparaison()
    model.themes.demographie!.metadata = validerThemeMetadata(metadata, 'theme_demographie.json')
    const requests: Array<{ items: Array<Record<string, any>> }> = []
    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/data/theme_demographie.json') return new Response(JSON.stringify(metadata), { status: 200 })
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/api/resources/read-batch') {
        requests.push(JSON.parse(init?.body as string))
        return new Response('semantic reads unavailable', { status: 503 })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubEnv('VITE_SCALAR_COHORT_API', '1')
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '0')
    vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/22001?theme=demographie', vi.fn(async () => model))
    await flushPromises()

    expect(requests).toHaveLength(2)
    expect(requests[0]!.items.map((item) => item.target.kind)).toEqual(['territory_cohort', 'territory'])
    expect(requests[1]!.items).toHaveLength(1)
    expect(requests[1]!.items[0]!.target.kind).toBe('territory_cohort')
    expect(wrapper.get('[role="alert"]').text()).toContain('Les indicateurs de ce thème ne sont pas disponibles.')
    expect(wrapper.find('[data-clef="densite"] .valeur-numerique').exists()).toBe(false)
    wrapper.unmount()
  })

  it('does not start facts-only recovery after the paired read belongs to a cancelled fiche navigation', async () => {
    const metadata = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/theme_demographie.json'), 'utf8'))
    metadata.scalar_contracts = { densite: metadata.scalar_contracts.densite }
    const model = modeleAvecContextesComparaison()
    model.themes.demographie!.metadata = validerThemeMetadata(metadata, 'theme_demographie.json')
    const requests: Array<{ items: Array<Record<string, any>> }> = []
    let failOldRequest: (() => void) | undefined
    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/data/theme_demographie.json') return new Response(JSON.stringify(metadata), { status: 200 })
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/api/resources/read-batch') {
        const request = JSON.parse(init?.body as string) as { items: Array<Record<string, any>> }
        requests.push(request)
        if (requests.length === 1) {
          return new Promise<Response>((resolve) => {
            failOldRequest = () => resolve(new Response('old paired read unavailable', { status: 503 }))
          })
        }
        return new Response(JSON.stringify(semanticScalarBatch('demographie', metadata,
          request.items, '22002', () => 22222)))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubEnv('VITE_SCALAR_COHORT_API', '1')
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '0')
    vi.stubGlobal('fetch', fetchApi)
    const charger = vi.fn(async (_type: string, code: string) => {
      const routeModel = structuredClone(model)
      const target = routeModel.cohortTerritories!.find((territory: any) => territory.territoire === code)!
      routeModel.territory = target
      routeModel.territories = [target, ...routeModel.territories.filter((territory: any) => territory.territoire !== code)]
      return routeModel
    })
    const { router, wrapper } = await monter('/territoire/commune/22001?theme=demographie', charger)
    await flushPromises()
    expect(requests).toHaveLength(1)

    await router.push('/territoire/commune/22002?theme=demographie')
    await flushPromises()
    expect(requests).toHaveLength(2)
    failOldRequest!()
    await flushPromises()
    expect(requests).toHaveLength(2)
    expect(wrapper.get('[data-clef="densite"] .valeur-numerique').text()).toBe('22 222')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('Habitat scalar cohort replaces only the scalar page and preserves the price trajectory', async () => {
    await (varianteDeUrl('A')?.composant as any).__asyncLoader?.()
    const metadata = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/theme_habitat.json'), 'utf8'))
    const published = JSON.parse(readFileSync(resolve(process.cwd(),
      '../public/data/modeles-lecture/territoires/commune/35238.json'), 'utf8'))
    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/data/theme_habitat.json') return new Response(JSON.stringify(metadata), { status: 200 })
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/api/resources/read-batch') {
        const request = JSON.parse(init?.body as string) as { items: Array<Record<string, any>> }
        return new Response(JSON.stringify(semanticScalarBatch('habitat', metadata,
          request.items, '35238', (indicator) => indicator === 'part_passoires' ? 0.12 : 0.456)), { status: 200 })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubEnv('VITE_SCALAR_COHORT_API', '1')
    vi.stubGlobal('fetch', fetchApi)
    published.themes.habitat.theme_metadata.scalar_contracts = metadata.scalar_contracts
    published.themes.habitat.theme_metadata.indicator_pages = metadata.indicator_pages
    const model = validerModeleTerritoire(published, 'territoires/commune/35238.json',
      { type: 'commune', territoire: '35238' })
    model.cohortTerritories = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/territoires.json'), 'utf8'))
    const { wrapper } = await monter('/territoire/commune/35238?theme=habitat', vi.fn(async () => model))
    await flushPromises()
    const batchCalls = fetchApi.mock.calls.filter(([url]) => String(url) === '/api/resources/read-batch')
    expect(batchCalls).toHaveLength(1)
    const batchRequest = JSON.parse((batchCalls[0]![1] as RequestInit).body as string)
    expect(batchRequest.items.map((item: any) => item.resource)).toContain('part_passoires')
    expect(batchRequest.items.map((item: any) => item.resource)).not.toContain('prix_m2')
    expect(fetchApi.mock.calls.some(([url]) => String(url).includes('/indicator-cohorts/'))).toBe(false)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    const habitatText = wrapper.get('[role="tabpanel"]').text()
    expect(habitatText).toContain('12%Part de passoires thermiques')
    expect(habitatText).toContain('Médiane prix au m²')
    expect(habitatText).toContain('3 777,78 €/m²')
    wrapper.unmount()
  })

  it('renders the pooled DVF scalar/rank beside annual points without borrowing the annual rank', async () => {
    const requests: Array<Array<Record<string, any>>> = []
    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/api/resources/read-batch') {
        const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
        requests.push(items)
        return nativeBatchResponse(items, (item, resource) => {
          const data = nativeReadFixture(item, resource)
          if (resource.resource_id !== 'prix_m2') return data
          if (item.intent.kind === 'facts') {
            data.points = (data.points as Array<Record<string, any>>).map((point) => point.axis === '2025'
              ? { ...point, value: 230, status: 'measured', missing_reason: null }
              : point.axis === '2024' ? { ...point, value: 211, status: 'measured', missing_reason: null } : point)
            data.scalar_facet.observation = { ...data.scalar_facet.observation,
              status: 'measured', value: 700, support_count: 12, denominator_count: 20 }
          } else {
            data.result = { ...data.result, source_facet: '2025', status: 'available',
              direction: 'low', rank: 2, rank_size: 2 }
            data.scalar_facet.result = { ...data.scalar_facet.result, source_facet: 'prix_m2',
              status: 'available', direction: 'low', rank: 1, rank_size: 2 }
          }
          return data
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1')
    vi.stubGlobal('fetch', fetchApi)
    const model = modeleAvecContextesComparaison()
    const { wrapper } = await monter('/territoire/commune/22001?theme=habitat', vi.fn(async () => model))
    await flushPromises()

    const figure = wrapper.get('.figure-trajectoire[data-clef="prix_m2"]')
    expect(figure.get('.trajectoire-repere__valeur').text()).toContain('700')
    expect(figure.get('.trajectoire-repere__valeur').text()).toContain('€/m²')
    expect(figure.get('.trajectoire-repere .puce-rang-texte').text()).toContain('1er/2')
    expect(figure.get('.trajectoire-repere [role="img"]').attributes('aria-label'))
      .toContain(model.themes.mobilite!.comparisons.densite!.scope.label)
    expect(figure.get('svg[role="img"]').attributes('aria-label')).toContain('2025')
    expect(figure.get('svg[role="img"]').attributes('aria-label')).toContain('230')
    expect(requests.flat().some((item) => item.resource === 'prix_m2' && item.intent.kind === 'facts')).toBe(true)
    expect(requests.flat().some((item) => item.resource === 'prix_m2' && item.intent.kind === 'fixed_comparison')).toBe(true)
    wrapper.unmount()
  }, 20_000)

  it('does not attach the initial fixed-group price rank to a scope selected while facts are pending', async () => {
    const initialPending: Array<{ release: () => void; released: boolean }> = []
    const selectedPending: Array<{ release: () => void; released: boolean }> = []
    const habitatResources = new Set(nativeResources('habitat').map((resource) => resource.resource_id))
    const makeResponse = (items: Array<Record<string, any>>) => nativeBatchResponse(items, (item, resource) => {
      const data = nativeReadFixture(item, resource)
      if (resource.resource_id !== 'prix_m2') return data
      if (item.intent.kind === 'facts') {
        data.points = (data.points as Array<Record<string, any>>).map((point) => point.axis === '2025'
          ? { ...point, value: 230, status: 'measured', missing_reason: null }
          : point.axis === '2024' ? { ...point, value: 211, status: 'measured', missing_reason: null } : point)
        data.scalar_facet.observation = { ...data.scalar_facet.observation,
          status: 'measured', value: 700, support_count: 12, denominator_count: 20 }
      } else {
        data.result = { ...data.result, source_facet: '2025', status: 'available',
          direction: 'low', rank: 2, rank_size: 2 }
        data.scalar_facet.result = { ...data.scalar_facet.result, source_facet: 'prix_m2',
          status: 'available', direction: 'low', rank: 1, rank_size: 2 }
      }
      return data
    })
    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/api/resources/read-batch') {
        const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
        const targetThemeReads = items.some((item) => habitatResources.has(item.resource) && item.target.kind === 'territory')
        if (targetThemeReads) {
          const selected = items.some((item) => habitatResources.has(item.resource) && item.intent.kind === 'selected_comparison')
          const queue = selected ? selectedPending : initialPending
          return new Promise<Response>((resolve) => {
            const pending = { released: false, release: () => {
              pending.released = true
              resolve(makeResponse(items))
            } }
            queue.push(pending)
          })
        }
        return makeResponse(items)
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1')
    vi.stubGlobal('fetch', fetchApi)
    const model = modeleAvecContextesComparaison()
    const { router, wrapper } = await monter(
      '/territoire/commune/22001?theme=habitat&comparaison=epci', vi.fn(async () => model))
    await vi.waitFor(() => expect(initialPending.some((entry) => !entry.released)).toBe(true))
    await router.replace({ query: { theme: 'habitat', comparaison: 'bretagne' } })
    await flushPromises()

    for (let attempt = 0; attempt < 12 && !selectedPending.some((entry) => !entry.released); attempt++) {
      await vi.waitFor(() => expect(initialPending.some((entry) => !entry.released)).toBe(true))
      initialPending.find((entry) => !entry.released)!.release()
      await flushPromises()
    }
    expect(selectedPending.some((entry) => !entry.released)).toBe(true)
    const figure = wrapper.get('.figure-trajectoire[data-clef="prix_m2"]')
    expect(figure.get('.trajectoire-repere__valeur').text()).toContain('700')
    expect(figure.find('.trajectoire-repere .puce-rang').exists()).toBe(false)

    selectedPending.find((entry) => !entry.released)!.release()
    await flushPromises()
    expect(figure.get('.trajectoire-repere .puce-rang-texte').text()).toContain('1er/2')
    expect(figure.get('.trajectoire-repere .puce-rang[aria-label]').attributes('aria-label'))
      .toContain(model.themes.mobilite!.comparisons.bretagne!.scope.label)
    expect(figure.get('svg[role="img"]').attributes('aria-label')).toContain('230')
    wrapper.unmount()
  }, 30_000)

  it('keeps the incumbent fiche path when registration is absent or the cutover flag is off', async () => {
    await (varianteDeUrl('A')?.composant as any).__asyncLoader?.()
    const requests = vi.fn().mockRejectedValue(new Error('scalar API must stay off'))
    vi.stubEnv('VITE_SCALAR_COHORT_API', '1')
    vi.stubGlobal('fetch', requests)
    const { wrapper: unregistered } = await monter('/territoire/commune/29002?theme=demographie')
    expect(unregistered.text()).toContain('Densité de population')
    expect(requests.mock.calls.some(([url]) => String(url).includes('/indicator-cohorts/'))).toBe(false)
    unregistered.unmount()

    const metadata = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/theme_demographie.json'), 'utf8'))
    const published = JSON.parse(readFileSync(resolve(process.cwd(),
      '../public/data/modeles-lecture/territoires/commune/22001.json'), 'utf8'))
    published.themes.demographie.theme_metadata.scalar_contracts = metadata.scalar_contracts
    const model = validerModeleTerritoire(published, 'territoires/commune/22001.json',
      { type: 'commune', territoire: '22001' }, { requireAllThemes: true })
    vi.stubEnv('VITE_SCALAR_COHORT_API', '0')
    const { wrapper: disabled } = await monter('/territoire/commune/22001?theme=demographie', vi.fn(async () => model))
    expect(requests.mock.calls.some(([url]) => String(url).includes('/indicator-cohorts/'))).toBe(false)
    expect(disabled.text()).toContain('24,45')
    disabled.unmount()
  })

  it('keeps unregistered facts when a valid registration has no eligible pages at this level', async () => {
    const metadata = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/theme_demographie.json'), 'utf8'))
    const published = JSON.parse(readFileSync(resolve(process.cwd(),
      '../public/data/modeles-lecture/territoires/commune/22001.json'), 'utf8'))
    published.themes.demographie.theme_metadata.scalar_contracts = Object.fromEntries(
      Object.keys(metadata.scalar_contracts).map((key) => [key, { allowed_levels: ['epci'] }]),
    )
    const model = validerModeleTerritoire(published, 'territoires/commune/22001.json',
      { type: 'commune', territoire: '22001' }, { requireAllThemes: true })
    const fetchApi = vi.fn()
    vi.stubEnv('VITE_SCALAR_COHORT_API', '1')
    vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/22001?theme=demographie', vi.fn(async () => model))
    expect(fetchApi).not.toHaveBeenCalled()
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('24,45')
    wrapper.unmount()
  })

  it('keeps acquired scalar facts when comparison scope changes and ignores a late rank response', async () => {
    const metadata = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/theme_demographie.json'), 'utf8'))
    const published = JSON.parse(readFileSync(resolve(process.cwd(),
      '../public/data/modeles-lecture/territoires/commune/22001.json'), 'utf8'))
    published.themes.demographie.theme_metadata.scalar_contracts = metadata.scalar_contracts
    const model = validerModeleTerritoire(published, 'territoires/commune/22001.json',
      { type: 'commune', territoire: '22001' }, { requireAllThemes: true })
    // La validation du cohort vise les pages MÉTADONNÉES DU MODÈLE — son unité
    // densité diffère de celle du catalogue public de thème.
    model.cohortTerritories = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/territoires.json'), 'utf8'))
    const modelPages = model.themes.demographie!.metadata.indicator_pages
    const scalarMetadata = { scalar_contracts: model.themes.demographie!.metadata.scalar_contracts,
      indicator_pages: modelPages }
    const requests: Array<{ items: Array<Record<string, any>> }> = []
    const bretagneMemberCount = model.cohortTerritories!.filter((member: any) => member.type === 'commune').length
    let resolveLateBretagne: (() => void) | undefined
    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url !== '/api/resources/read-batch') throw new Error(`Unexpected request: ${url}`)
      const request = JSON.parse(init?.body as string) as { items: Array<Record<string, any>> }
      const response = new Response(JSON.stringify(semanticScalarBatch('demographie', scalarMetadata,
        request.items, '22001', () => 111111111)), { status: 200 })
      requests.push(request)
      const selection = request.items[0]?.intent
      if (request.items.every((item) => item.target.kind === 'territory') &&
          selection?.kind === 'selected_comparison' && selection.members.length === bretagneMemberCount) {
        return new Promise<Response>((resolve) => { resolveLateBretagne = () => resolve(response) })
      }
      return response
    })
    vi.stubEnv('VITE_SCALAR_COHORT_API', '1')
    vi.stubGlobal('fetch', fetchApi)
    const { router, wrapper } = await monter('/territoire/commune/22001?theme=demographie&comparaison=epci', vi.fn(async () => model))
    await flushPromises()
    expect(requests).toHaveLength(1)
    const acquiredValue = wrapper.get('[data-clef="densite"] .valeur-numerique').text()
    expect(acquiredValue).toBe('111 111 111')
    expect(requests[0]!.items).toHaveLength(Object.keys(metadata.scalar_contracts).length * 2)
    expect(requests[0]!.items.filter((item) => item.target.kind === 'territory_cohort')).toHaveLength(Object.keys(metadata.scalar_contracts).length)
    expect(requests[0]!.items.filter((item) => item.target.kind === 'territory')).toHaveLength(Object.keys(metadata.scalar_contracts).length)

    await router.push('/territoire/commune/22001?theme=demographie&comparaison=bretagne')
    await flushPromises()
    expect(requests).toHaveLength(2)
    expect(requests[1]!.items.every((item) => item.target.kind === 'territory' && item.intent.kind === 'selected_comparison')).toBe(true)
    expect(wrapper.get('[data-clef="densite"] .valeur-numerique').text()).toBe(acquiredValue)
    expect(wrapper.find('[data-clef="densite"] .puce-rang-texte').exists()).toBe(false)

    await router.push('/territoire/commune/22001?theme=demographie&comparaison=epci')
    await flushPromises()
    expect(requests).toHaveLength(3)
    expect(requests[2]!.items.every((item) => item.target.kind === 'territory' && item.intent.kind === 'selected_comparison')).toBe(true)
    const epciLabel = model.themes.mobilite!.comparisons.epci!.scope.label
    expect(wrapper.get('[data-clef="densite"] .valeur-numerique').text()).toBe(acquiredValue)
    expect(wrapper.get('[data-clef="densite"] .puce-rang-texte').text()).toContain(epciLabel)

    resolveLateBretagne!()
    await flushPromises()
    expect(wrapper.get('[data-clef="densite"] .valeur-numerique').text()).toBe(acquiredValue)
    expect(wrapper.get('[data-clef="densite"] .puce-rang-texte').text()).toContain(epciLabel)
    expect(requests.slice(1).every((request) => request.items.every((item) => item.target.kind === 'territory'))).toBe(true)
    wrapper.unmount()
  })

  it('renders a retryable error for malformed registration and recovers without showing static facts', async () => {
    const metadata = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/theme_demographie.json'), 'utf8'))
    const published = JSON.parse(readFileSync(resolve(process.cwd(),
      '../public/data/modeles-lecture/territoires/commune/22001.json'), 'utf8'))
    published.themes.demographie.theme_metadata.scalar_contracts = { densite: { allowed_levels: 'commune' } }
    const model = validerModeleTerritoire(published, 'territoires/commune/22001.json',
      { type: 'commune', territoire: '22001' }, { requireAllThemes: true })
    model.cohortTerritories = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/territoires.json'), 'utf8'))
    const modelPages = model.themes.demographie!.metadata.indicator_pages
    const scalarMetadata = { scalar_contracts: metadata.scalar_contracts, indicator_pages: modelPages }
    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/api/resources/read-batch') {
        const request = JSON.parse(init?.body as string) as { items: Array<Record<string, any>> }
        return new Response(JSON.stringify(semanticScalarBatch('demographie', scalarMetadata,
          request.items, '22001', () => 987654321)))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubEnv('VITE_SCALAR_COHORT_API', '1')
    vi.stubGlobal('fetch', fetchApi)
    const { wrapper } = await monter('/territoire/commune/22001?theme=demographie', vi.fn(async () => model))
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(wrapper.find('[role="alert"]').text()).toContain('pas disponibles')
    expect(wrapper.text()).not.toContain('24,45')
    expect(fetchApi).not.toHaveBeenCalled()

    model.themes.demographie!.metadata.scalar_contracts = metadata.scalar_contracts
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(fetchApi.mock.calls.some(([url]) => String(url) === '/api/resources/read-batch')).toBe(true)
    expect(wrapper.text()).toContain('987 654 321')
    expect(wrapper.text()).not.toContain('24,45')
    wrapper.unmount()
  })

  it('affiche les six onglets pendant que l’unique modèle charge', async () => {
    const charger = vi.fn(() => new Promise<never>(() => {}))
    const { wrapper, router } = await monter('/territoire/commune/29002', charger)

    expect(wrapper.findAll('[role="tab"]')).toHaveLength(6)
    expect(wrapper.find('.squelette').exists()).toBe(true)
    await wrapper.findAll('[role="tab"]')[3]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.theme).toBe('habitat')
    expect(charger).toHaveBeenCalledTimes(1)
  })

  it('rend l’identité et le contexte depuis la même réponse', async () => {
    const { wrapper } = await monter('/territoire/commune/29002')

    expect(wrapper.find('.fiche-titre h1').text()).toBe('Commune C')
    expect(wrapper.find('.puce-type').text()).toBe('Commune')
    expect(wrapper.find('.fiche-actions .contexte-switcher').exists()).toBe(true)
    const breadcrumb = wrapper.find('.fil-ariane')
    expect(breadcrumb.text()).toContain('Accueil')
    expect(breadcrumb.text()).toContain('Les communes')
    expect(breadcrumb.find('a[href="/"]').exists()).toBe(true)
    expect(breadcrumb.find('a[href="/communes"]').exists()).toBe(true)
    expect(wrapper.find('.contexte-switcher').text()).toContain('EPCI Y')
    expect(wrapper.find('.contexte-switcher').text()).toContain('Département 29')
    expect(wrapper.find('.contexte-switcher').text()).toContain('Bretagne')
  })

  it('présente toujours les six thèmes dans l’ordre produit', async () => {
    const { wrapper } = await monter('/territoire/commune/29002')
    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text().trim())).toEqual([
      'Programmes et subventions',
      'Mobilité',
      'Démographie',
      'Habitat',
      'Économie',
      'Milieux',
    ])
  })

  it('ouvre Programmes et subventions par défaut', async () => {
    const { wrapper } = await monter('/territoire/commune/29002')
    expect(wrapper.findAll('[role="tab"]')[0]!.attributes('aria-selected')).toBe('true')
    expect(wrapper.find('[role="tabpanel"]').attributes('id')).toBe('panneau-programmes')
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('Programmes et subventions')
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('Programmes et contrats')
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('Aucun programme référencé.')
  })

  it('sélectionne un thème depuis l’URL sans nouvelle requête', async () => {
    const charger = vi.fn<ChargerModeleTerritoire>(async (_type, territoire) => modelFor(territoire))
    const { wrapper } = await monter('/territoire/commune/29002?theme=demographie', charger)
    expect(wrapper.findAll('[role="tab"]')[2]!.attributes('aria-selected')).toBe('true')
    expect(wrapper.find('[role="tabpanel"]').attributes('id')).toBe('panneau-demographie')
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('Densité de population')
    expect(wrapper.find('[role="tabpanel"]').text()).toContain(
      'la population de Commune C se vide et se meurt : -1,04 par an (naturel)',
    )
    expect(wrapper.find('.fiche').classes()).toContain('fiche--theme-demographie')
    expect(wrapper.find('.filigrane-fiche').attributes('style')).toContain(
      '--filigrane-accent: var(--theme-demographie-line)',
    )
    expect(charger).toHaveBeenCalledTimes(1)
  })

  it('change d’onglet sans recharger le modèle', async () => {
    const charger = vi.fn<ChargerModeleTerritoire>(async (_type, territoire) => modelFor(territoire))
    const { wrapper, router } = await monter('/territoire/commune/29002', charger)
    await wrapper.findAll('[role="tab"]')[3]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.theme).toBe('habitat')
    expect(wrapper.find('[role="tabpanel"]').attributes('id')).toBe('panneau-habitat')
    expect(charger).toHaveBeenCalledTimes(1)
  })

  it('normalise un thème inconnu vers le défaut', async () => {
    const { wrapper, router } = await monter('/territoire/commune/29002?theme=bidule')
    expect(router.currentRoute.value.query.theme).toBeUndefined()
    expect(wrapper.findAll('[role="tab"]')[0]!.attributes('aria-selected')).toBe('true')
  })

  it('canonicalise un mode de comparaison inconnu sans perdre le thème', async () => {
    const { router } = await monter(
      '/territoire/commune/29002?theme=mobilite&comparaison=inconnu&variant=E',
    )
    expect(router.currentRoute.value.query).toEqual({ theme: 'mobilite' })
  })

  it('renders the producer-declared Mobility curve and scopes explicit comparisons through native reads', async () => {
    const requests: Array<Array<Record<string, any>>> = []
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1')
    vi.stubGlobal('fetch', nativeSemanticFetch(requests))
    const model = modeleAvecContextesComparaison()
    const { router, wrapper } = await monter('/territoire/commune/22001?theme=mobilite',
      vi.fn(async () => model))
    const curve = nativeResources('mobilite').find((resource) => resource.resource_id === 'raccordement_courbe')!
    const reference = nativeResources('mobilite').find((resource) => resource.shapes.includes('named_reference'))!
    const fixtureCurve = nativeReadFixture({ target: { kind: 'territory', type: 'commune', id: '22001' },
      intent: { kind: 'facts' } }, curve)
    const declaredAxisCount = curve.axis_values?.[0]?.[1].length ?? 0
    const fixturePoint = (fixtureCurve.points as Array<Record<string, any>>)[0]!
    const reads = () => requests.flat()

    expect(wrapper.find('.transit-series--territory').exists()).toBe(true)
    const territoryPoints = wrapper.findAll('.transit-point--territory')
    expect(declaredAxisCount).toBe(73)
    expect(territoryPoints).toHaveLength(declaredAxisCount)
    expect(territoryPoints[0]?.attributes('data-value')).toBe('0')
    expect(territoryPoints.at(-1)?.attributes('data-value')).toBe('0.5')
    expect(wrapper.text()).toContain(fixturePoint.provenance[0].source_name)
    expect(reads().some((item) => item.resource === curve.resource_id && item.intent.kind === 'facts')).toBe(true)
    expect(reads().some((item) => item.resource === reference.resource_id &&
      item.target.kind === 'named_reference' && reference.target_ids.includes(item.target.id))).toBe(true)

    const cohort = model.cohortTerritories!
    const epciMembers = cohort.filter((territory: any) =>
      territory.type === 'commune' && territory.epci === model.territory.epci)
      .map((territory: any) => ({ type: territory.type, id: territory.territoire }))
      .sort((left: any, right: any) => left.id.localeCompare(right.id))
    await router.replace({ query: { theme: 'mobilite', comparaison: 'epci' } })
    await flushPromises()
    expect(router.currentRoute.value.query.comparaison).toBe('epci')
    const epciRead = reads().find((item) => item.resource === curve.resource_id &&
      item.intent.kind === 'selected_comparison')
    expect(epciRead?.intent.members).toEqual(epciMembers)
    expect(wrapper.findAll('.transit-point--territory')).toHaveLength(declaredAxisCount)

    const bretagneMembers = cohort.filter((territory: any) => territory.type === 'commune')
      .map((territory: any) => ({ type: territory.type, id: territory.territoire }))
      .sort((left: any, right: any) => left.id.localeCompare(right.id))
    await router.replace({ query: { theme: 'mobilite', comparaison: 'bretagne' } })
    await flushPromises()
    expect(router.currentRoute.value.query.comparaison).toBe('bretagne')
    const bretagneReads = reads().filter((item) => item.resource === curve.resource_id &&
      item.intent.kind === 'selected_comparison')
    expect(bretagneReads.at(-1)?.intent.members).toEqual(bretagneMembers)

    await router.replace({ query: { theme: 'mobilite', comparaison: 'epci' } })
    await flushPromises()
    expect(reads().filter((item) => item.resource === curve.resource_id &&
      item.intent.kind === 'selected_comparison' &&
      JSON.stringify(item.intent.members) === JSON.stringify(epciMembers))).toHaveLength(1)
    expect(reads().filter((item) => item.resource === curve.resource_id && item.intent.kind === 'facts')).toHaveLength(1)
    expect(fetchBloque).not.toHaveBeenCalled()
    wrapper.unmount()
  }, 20_000)

  it.each(['densite', 'epci', 'bretagne'] as const)(
    'affiche la portée publiée %s dans la note de comparaison', async (mode) => {
      const { model, wrapper } = await monterNoteComparaison(mode)
      const label = model.themes.mobilite!.comparisons[mode]!.scope.label
      const trigger = wrapper.get('button[aria-haspopup="listbox"]')

      expect(trigger.attributes('aria-current')).toBe('true')
      expect(trigger.text()).toContain(label)
      expect(wrapper.get('.cahier-comparison-note__scope').text()).toBe(label)
      wrapper.unmount()
    },
  )

  it('permet de divulguer et synchroniser la portée publiée depuis le cahier', async () => {
    const { model, router, wrapper } = await monterNoteComparaison('densite')
    const trigger = wrapper.get('button[aria-haspopup="listbox"]')
    const contexts = model.themes.mobilite!.comparisons

    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(trigger.attributes('aria-current')).toBe('true')
    expect(trigger.text()).toContain(contexts.densite!.scope.label)
    expect(wrapper.get('.cahier-comparison-note__scope').text()).toBe(contexts.densite!.scope.label)
    await trigger.trigger('click')
    const options = wrapper.findAll('[role="option"][aria-selected="false"]')
    expect(options.map((option) => option.text())).toEqual([
      contexts.epci!.scope.label,
      contexts.bretagne!.scope.label,
    ])
    await options[0]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.comparaison).toBe('epci')
    await wrapper.setProps({ label: contexts.epci!.scope.label })
    expect(wrapper.get('.cahier-comparison-note__scope').text()).toBe(contexts.epci!.scope.label)
    wrapper.unmount()
  })

  it('change la portée au clavier et expose l’explication de la densité', async () => {
    const { model, router, wrapper } = await monterNoteComparaison('epci')
    const trigger = wrapper.get('button[aria-haspopup="listbox"]')
    await trigger.trigger('keydown', { key: 'Enter' })

    const densityLabel = model.themes.mobilite!.comparisons.densite!.scope.label
    const density = wrapper.findAll('[role="option"][aria-selected="false"]')
      .find((option) => option.find('.cahier-comparison-note__option-label').text() === densityLabel)
    expect(trigger.attributes('aria-expanded')).toBe('true')
    expect(density).toBeDefined()
    expect(density!.attributes('title')).toBe(
      'Classe définie par l’Insee selon le nombre d’habitants et leur concentration sur le territoire communal.',
    )
    const descriptionId = density!.attributes('aria-describedby')
    expect(wrapper.get(`#${descriptionId}`).text()).toContain('Classe définie par l’Insee')
    await density!.trigger('focus')
    await density!.trigger('keydown', { key: 'Escape' })
    expect(trigger.attributes('aria-expanded')).toBe('false')
    await trigger.trigger('keydown', { key: 'Enter' })
    const reopenedDensity = wrapper.findAll('[role="option"][aria-selected="false"]')
      .find((option) => option.find('.cahier-comparison-note__option-label').text() === densityLabel)
    expect(reopenedDensity).toBeDefined()
    await reopenedDensity!.trigger('focus')
    await reopenedDensity!.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(router.currentRoute.value.query.comparaison).toBeUndefined()
    wrapper.unmount()
  })

  it('affiche l’erreur typée et réessaie le même endpoint', async () => {
    const charger = vi
      .fn()
      .mockRejectedValueOnce(new PayloadError('fetch', 'territoires/commune/29002.json', 'panne'))
      .mockResolvedValueOnce(modelFor('29002'))
    const { wrapper } = await monter('/territoire/commune/29002', charger)

    expect(wrapper.find('.etat-erreur').exists()).toBe(true)
    expect(wrapper.text()).toContain('Impossible de charger les données')
    expect(wrapper.text()).not.toContain('territoires/commune/29002.json')
    expect(wrapper.text()).not.toContain('panne')
    await wrapper.get('.bouton-reessayer').trigger('click')
    await flushPromises()
    expect(wrapper.find('.etat-erreur').exists()).toBe(false)
    expect(wrapper.find('.fiche-titre h1').text()).toBe('Commune C')
    expect(charger).toHaveBeenCalledTimes(2)
  })

  it('renders the approved AEDAR cahier from the normal Mobility route', async () => {
    const model = modeleAvecContextesComparaison()
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1')
    const requests: Array<Array<Record<string, any>>> = []
    const fetchApi = nativeSemanticFetch(requests)
    vi.stubGlobal('fetch', fetchApi)

    const { wrapper } = await monter('/territoire/commune/22001?theme=mobilite', vi.fn(async () => model))
    await flushPromises()

    expect(wrapper.find('.prototype-toggle').exists()).toBe(false)
    expect(wrapper.find('.aedar-state').exists()).toBe(false)
    expect(wrapper.find('[data-section="aedar-car-overview"]').exists()).toBe(true)
    expect(wrapper.find('[data-section="aedar-access"]').exists()).toBe(true)
    expect(wrapper.find('.page-heading-index').exists()).toBe(true)
    const semanticReads = fetchApi.mock.calls.filter(([url]) => String(url) === '/api/resources/read-batch')
    expect(semanticReads.length).toBeGreaterThanOrEqual(6)
    const projectedBodies = semanticReads.map(([, init]) => JSON.parse(String(init?.body)))
    const aedarItems = projectedBodies.flatMap((body) => body.items)
      .filter((item: Record<string, any>) => Array.isArray(item.coordinates?.typequ))
    expect(aedarItems.every((item: Record<string, any>) => item.fields.length <= 32)).toBe(true)
    expect(aedarItems.some((item: Record<string, any>) => item.coordinates.typequ.length === 100)).toBe(true)
    expect(fetchApi.mock.calls.some(([url]) => String(url).includes('/api/aedar/territories/'))).toBe(false)
    expect(fetchApi.mock.calls.some(([url]) => String(url).includes('/themes/'))).toBe(false)
    wrapper.unmount()
  })

  it('shows loading, not unavailable copy, while the production AEDAR read is pending', async () => {
    const model = modeleAvecContextesComparaison()
    const fetchApi = vi.fn(async (url: string) => {
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/api/resources/read-batch') return await new Promise<Response>(() => {})
      return { ok: false, status: 404, json: async () => ({}) } as Response
    })
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '1')
    vi.stubGlobal('fetch', fetchApi)

    const { wrapper } = await monter('/territoire/commune/22001?theme=mobilite', vi.fn(async () => model))
    const firstPage = wrapper.find('.cahier-page')
    const text = firstPage.text()

    expect(fetchApi.mock.calls.some(([url]) => String(url) === '/api/resources/read-batch')).toBe(true)
    expect(text).toContain('Chargement des donn\u00e9es AEDAR\u2026')
    expect(text).not.toContain('Contenu indisponible pour ce territoire.')
    expect(firstPage.find('[role="status"]').exists()).toBe(true)
    expect(wrapper.findAll('.cahier-page')[1]!.text()).toContain('Contenu indisponible pour ce territoire.')
    wrapper.unmount()
  })

})
