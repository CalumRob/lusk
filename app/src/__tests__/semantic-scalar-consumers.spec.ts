import { flushPromises, mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { maplibreMock } from './setup'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'
import { GEOMETRIE_CHARGER_KEY } from '../geo/useGeometrie'
import { chargerAvec, indicateursDemographieFixture, territoiresFixture } from '../payload/fixtures'
import { formaterRang, formaterValeur } from '../payload/selectors'
import { validerThemeMetadata } from '../payload/validate'
import { routes } from '../router'
import IndicateurView from '../views/IndicateurView.vue'
import CarteView from '../views/CarteView.vue'
import type { ChargerFichier } from '../payload/usePayload'
import type { Payload } from '../payload/types'
import { indicateursScalairesEnregistres, pagesScalairesEnregistrees } from '../payload/scalarCohort'
import { nativeBatchResponse, nativeCatalogueResponse, nativeReadFixture, nativeResources } from './helpers/semanticApiFixtures'

const metadata = (theme: string) => JSON.parse(readFileSync(join(process.cwd(), '..', 'public', 'data', `theme_${theme}.json`), 'utf8'))
const producerMetadata = (theme: string) => JSON.parse(readFileSync(join(process.cwd(), '..', 'pipeline',
  'inst', 'extdata', 'theme-metadata', `theme_${theme}.json`), 'utf8'))

const expectedOrdinaryScalarPages = [
  'demographie/densite', 'demographie/taille_menages', 'demographie/evolution_1968',
  'economie/effectifs_salaries', 'economie/chomage', 'economie/eco_activites',
  'habitat/part_passoires',
  'mobilite/surface_reseaux_routiers', 'mobilite/offre_tc', 'mobilite/bornes_recharge',
  'mobilite/places_stationnement_velo_1000', 'mobilite/places_stationnement_voiture_1000',
  'mobilite/bornes_ev_par_station_service', 'mobilite/stationnement_velo_par_voiture',
  'mobilite/raccordement_tc',
]

function ordinaryScalarPageCensus() {
  const resources = nativeResources()
  return ['demographie', 'economie', 'habitat', 'mobilite'].flatMap((theme) => {
    const raw = metadata(theme)
    const parsed = validerThemeMetadata(raw, `theme_${theme}.json`)
    const registered = indicateursScalairesEnregistres(raw)
    return pagesScalairesEnregistrees(parsed, registered).filter((indicator) => {
      const page = parsed.indicator_pages?.[indicator]
      const resource = resources.find((candidate) => candidate.resource_id === indicator &&
        candidate.indicator_id === indicator && candidate.theme_id === theme)
      return Boolean(page && resource && resource.shapes.length === 1 && resource.shapes[0] === 'scalar' &&
        resource.target_kinds.includes('territory_cohort') && resource.intents.includes('facts') &&
        page.levels.some((level) => resource.allowed_levels.includes(level)))
    }).map((indicator) => ({ theme, indicator }))
  }).sort((left, right) => `${left.theme}/${left.indicator}`.localeCompare(`${right.theme}/${right.indicator}`))
}

function resource(theme: string, indicator: string) {
  const file = metadata(theme)
  const page = file.indicator_pages[indicator]
  const contract = file.scalar_contracts[indicator]
  return {
    resource_id: indicator,
    theme_id: theme,
    indicator_id: indicator,
    label: 'Libellé source différent du libellé éditorial',
    unit: page.unit,
    direction: page.comparison?.direction ?? page.direction,
    allowed_levels: contract.allowed_levels,
    sources: page.sources,
    shapes: ['scalar'],
    axes: [],
    axis_values: [],
    target_kinds: ['territory', 'territory_cohort'],
    target_ids: [],
    dynamic_axes: [],
    fields: ['value', 'support_count', 'denominator_count'],
    intents: ['facts', 'fixed_comparison', 'selected_comparison'],
    resource_kind: 'indicator',
  }
}

function sourceFor(theme: string, indicator: string) {
  const source_id = metadata(theme).indicator_pages[indicator].sources[0]
  return { source_id, name: 'Source API mesurée', vintage_id: `${source_id}-2026`, version: '2026',
    reference_date: '2026-06-30', publication_date: '2026-07-01' }
}

function observation(theme: string, indicator: string, territory: string, status: string, value: number | null) {
  const ref = territoiresFixture.find((item) => item.territoire === territory)!
  return { territory: { id: ref.territoire, type: ref.type, name: ref.nom }, status, value,
    support_count: status === 'measured' ? 41 : 7,
    denominator_count: 100,
    sources: [sourceFor(theme, indicator)] }
}

function cohortResult(theme: string, indicator: string, target: Record<string, unknown>, memberIds: string[], observations: unknown[]) {
  const declaration = resource(theme, indicator)
  const file = metadata(theme)
  return { resource: indicator, target,
    shape: 'scalar',
    cohort: { territory_type: target.type, department_id: target.department_id ?? null,
      epci_id: target.epci_id ?? null, member_count: memberIds.length,
      members: memberIds.map((id) => {
        const ref = territoiresFixture.find((item) => item.territoire === id)!
        return { id, type: ref.type, name: ref.nom }
      }), reference_content_version: 'reference-v7' },
    content_version: 'scalar-publication-v4',
    reference_content_version: 'reference-v7',
    descriptor: { indicator_id: indicator, theme_id: theme, label: declaration.label,
      unit: declaration.unit, direction: declaration.direction, comparison_facet: file.scalar_contracts[indicator].comparison_facet,
      allowed_levels: declaration.allowed_levels, denominator_semantics: 'producer-declared denominator',
      completeness: file.scalar_contracts[indicator].completeness, descriptor_version: 'scalar-descriptor-v3' },
    observations }
}

function projectCohortFields(data: ReturnType<typeof cohortResult>, fields: string[] | undefined) {
  if (fields?.includes('support_count')) return data
  return { ...data, observations: data.observations.map((item) => {
    const candidate = { ...(item as Record<string, unknown>) }
    delete candidate.support_count
    delete candidate.denominator_count
    return candidate
  }) }
}

function scalarComparison(theme: string, item: { target: { type: string; id?: string }; intent: any }, indicator: string,
  valuesById: Map<string, { status: string; value: number | null }>) {
  const fixed = item.intent.kind === 'fixed_comparison'
  const members = fixed
    ? territoiresFixture.filter((territory) => territory.type === item.target.type)
      .map((territory) => ({ type: territory.type, id: territory.territoire }))
    : item.intent.members as Array<{ type: string; id: string }>
  const measured = members.flatMap(({ id }) => {
    const fact = valuesById.get(id)
    return fact?.status === 'measured' && fact.value !== null ? [{ id, value: fact.value }] : []
  })
  const sorted = measured.map((row) => row.value).sort((a, b) => a - b)
  const median = sorted.length === 0 ? null : sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]!
    : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2
  const focalId = item.target.id!
  const focal = valuesById.get(focalId)
  const focalInSelection = members.some((member) => member.id === focalId)
  const rankFor = (id: string) => {
    const fact = valuesById.get(id)
    if (measured.length < 1 || fact?.status !== 'measured' || fact.value === null) return null
    return { territory_id: id, rank: 1 + measured.filter((row) => row.value > fact.value!).length,
      rank_size: measured.length, rank_ties: measured.filter((row) => row.value === fact.value).length }
  }
  const focalRank = focalInSelection ? rankFor(focalId) : null
  const page = metadata(theme).indicator_pages[indicator]
  const data = {
    resource: indicator, target: item.target, contract: 'indicator-comparison-v1', indicator_id: indicator,
    shape: 'scalar', content_version: 'scalar-publication-v4', reference_content_version: 'reference-v7',
     selection: fixed ? null : members.map((member) => ({ territory_type: member.type, territory_id: member.id })),
     scope: fixed ? { kind: 'same_level', territory_type: item.target.type, member_count: members.length }
       : { kind: 'explicit_selection', member_count: members.length },
    result: { indicator_id: indicator, status: measured.length ? 'available' : 'unavailable',
      reason: measured.length ? null : 'no_selected_comparable_values', unit: page.unit, direction: 'high',
      source_facet: indicator, descriptor_version: 'scalar-descriptor-v3', selected_member_count: members.length,
      eligible_count: measured.length, missing_count: members.length - measured.length,
      focal_value: focal?.status === 'measured' ? focal.value : null, focal_in_selection: focalInSelection,
      median, rank: focalRank?.rank ?? null, rank_size: focalRank?.rank_size ?? null,
      rank_ties: focalRank?.rank_ties ?? null,
      member_ranks: members.map((member) => rankFor(member.id) ?? {
        territory_id: member.id, rank: null, rank_size: null, rank_ties: null,
      }),
      comparison_sources: [sourceFor(theme, indicator)],
    },
  }
  return data
}

function discovery(...resources: ReturnType<typeof resource>[]) {
  return { contract: 'semantic-resource-catalogue-v1', resources }
}

function batch(...entries: Array<{ id: string; resource: string; data: unknown }>) {
  return { contract: 'semantic-read-batch-v1', results: entries }
}

function readBatchCall(fetcher: ReturnType<typeof vi.fn>) {
  return fetcher.mock.calls.find(([url]) => String(url) === '/api/resources/read-batch')
}

const staticPayload: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursDemographieFixture.map((row) => row.key === 'densite'
    ? { ...row, value: 123456, rang_epci: 1, rang_epci_n: 1, rang_dep: 1, rang_dep_n: 1, rang_reg: 1, rang_reg_n: 1 }
    : row),
  histoires: [], apercu: [], runReport: null, vintages: [], programmes: null,
}
const communeMasks = {
  type: 'FeatureCollection' as const,
  features: ['22001', '22002', '29001', '29002'].map((territoire) => ({
    type: 'Feature' as const, properties: { territoire },
    geometry: { type: 'Polygon' as const, coordinates: [] as number[][][] },
  })),
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  maplibreMock.instancesCarteMaple.length = 0
  maplibreMock.instancesPopups.length = 0
})

describe('ordinary scalar consumers on semantic resources', () => {
  it('covers the producer/API/page-grammar intersection for all 15 ordinary scalar pages with switches absent', async () => {
    const census = ordinaryScalarPageCensus()
    expect(census.map(({ theme, indicator }) => `${theme}/${indicator}`)).toEqual([...expectedOrdinaryScalarPages].sort())
    expect(census.map(({ theme, indicator }) => `${theme}/${indicator}`)).not.toContain('habitat/prix_m2')
    expect(census.map(({ theme, indicator }) => `${theme}/${indicator}`)).not.toContain('programmes/subventions_annuelles')

    const scalarEnv = import.meta.env.VITE_SCALAR_COHORT_API
    const scalarProcessEnv = process.env.VITE_SCALAR_COHORT_API
    delete import.meta.env.VITE_SCALAR_COHORT_API
    delete process.env.VITE_SCALAR_COHORT_API
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '0')
    vi.stubEnv('VITE_OWNED_SERIES_API', '0')
    const readItems: Array<{ item: Record<string, any>; data: Record<string, any> }> = []
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url.startsWith('/data/theme_') && url.endsWith('.json')) {
        const theme = url.slice('/data/theme_'.length, -'.json'.length)
        const presentation = structuredClone(metadata(theme))
        if (theme === 'demographie') {
          const stalePage = presentation.indicator_pages.densite
          stalePage.unit = 'ancienne unité éditoriale'
          stalePage.direction = 'low'
          stalePage.read_model = false
          delete stalePage.family
          stalePage.sources = ['stale_editorial_source']
          presentation.sources.densite = 'stale_editorial_source'
          presentation.source_records.stale_editorial_source = {
            dataset: 'Ancienne source éditoriale', publisher: 'Ancien éditeur',
            url: 'https://example.invalid/stale', licence: 'Licence inconnue', vintage: 'ancien', freshness: 'ancienne horloge',
          }
          presentation.source_records.serie_historique.sha256 = 'editorial-stale-source-hash'
          presentation.source_records.serie_historique.clocks = [{
            name: 'Horloge éditoriale obsolète', reference: 'mercredi réel de période scolaire 1999-01-01', frequency: 'factice',
          }]
        }
        return new Response(JSON.stringify(presentation))
      }
      if (url === '/api/resources/read-batch') {
        const request = JSON.parse(init?.body as string) as { items: Array<Record<string, any>> }
        return nativeBatchResponse(request.items, (item, declaration) => {
          const data = nativeReadFixture(item, declaration, {
            territories: territoiresFixture as unknown as Array<Record<string, any>>,
          })
          readItems.push({ item, data })
          return data
        })
      }
      throw new Error(`Unexpected scalar-page request: ${url}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const router = createRouter({ history: createMemoryHistory(), routes })
    const first = census[0]!
    await router.push(`/indicateurs/${first.theme}/${first.indicator}?territoire=22001&niveau=commune`)
    await router.isReady()
    const loader: ChargerFichier = async (file) => {
      if (file === 'territoires') return territoiresFixture
      throw new Error(`Ordinary scalar page requested static facts or a legacy manifest: ${file}`)
    }
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: loader,
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
    try {
      await flushPromises()
      for (let index = 0; index < census.length; index++) {
        const current = census[index]!
        if (index > 0) {
          await router.replace(`/indicateurs/${current.theme}/${current.indicator}?territoire=22001&niveau=commune`)
          await flushPromises()
        }
        const metadataForPage = metadata(current.theme)
        const producer = producerMetadata(current.theme)
        const page = metadataForPage.indicator_pages[current.indicator]
        const scalar = producer.scalar_contracts[current.indicator]
        const pageError = wrapper.find('[role="alert"]')
        expect(pageError.exists(), `${current.indicator} page error: ${pageError.exists() ? pageError.text() : 'none'}`).toBe(false)
        const factRead = readItems.slice().reverse().find(({ item }) =>
          item.resource === current.indicator && item.intent.kind === 'facts')
        expect(factRead, `${current.theme}/${current.indicator} fact response`).toBeDefined()
        expect(factRead!.item.fields).toEqual(scalar.counts_available
          ? ['value', 'support_count', 'denominator_count'] : ['value'])
        expect(factRead!.data.descriptor.denominator_semantics).toBe(producer.indicator_pages[current.indicator].calculation)
        expect(factRead!.data.observations.some((observation: Record<string, any>) =>
          observation.territory.id === '22001')).toBe(true)
        expect(wrapper.get('h1').text()).toBe(page.label)
        if (current.indicator === 'densite') {
          expect(wrapper.text()).toContain(producer.indicator_pages.densite.unit)
          expect(wrapper.text()).not.toContain('ancienne unité éditoriale')
          expect(wrapper.text()).not.toContain('Ancienne source éditoriale')
          expect(wrapper.text()).not.toContain('Horloge éditoriale obsolète')
          expect(wrapper.text()).not.toContain('1999-01-01')
          expect(wrapper.find('[data-testid="raccordement-dates"]').exists()).toBe(false)
          expect(wrapper.text()).toContain('▲ plus = mieux')
        }
        expect(fetcher.mock.calls.some(([input]) => String(input).includes('/indicator-cohorts/') ||
          String(input).includes('/data/indicateurs_') || String(input).includes('/modeles-lecture/'))).toBe(false)

        const comparison = readItems.slice().reverse().find(({ item }) =>
          item.resource === current.indicator && item.intent.kind !== 'facts')
        expect(comparison, `${current.theme}/${current.indicator} native comparison response`).toBeDefined()
        const warmedPageReadCount = readItems.length
        const expectedMedian = comparison!.data.result.median === null ? null
          : formaterValeur({ value: comparison!.data.result.median, unit: page.unit })
        if (comparison!.data.result.status === 'available') {
          expect(wrapper.get('[data-testid="scalar-comparison-summary"]').text()).toContain('Médiane API')
          expect(wrapper.get('[data-testid="scalar-comparison-summary"]').text()).toContain(expectedMedian)
        } else expect(wrapper.find('[data-testid="scalar-comparison-unavailable"]').exists()).toBe(true)

        const peerRanks = comparison!.data.result.member_ranks as Array<Record<string, any>>
        for (const peer of peerRanks.filter((row) => row.rank !== null)) {
          const reference = territoiresFixture.find((territory) => territory.territoire === peer.territory_id)!
          const row = wrapper.findAll('tbody tr').find((candidate) => candidate.text().includes(reference.nom))
          expect(row, `${current.indicator} rank row ${peer.territory_id}`).toBeDefined()
          expect(row!.findAll('td')[2]!.text()).toBe(formaterRang(peer.rank, peer.rank_size))
        }

        const focal = factRead!.data.observations.find((observation: Record<string, any>) =>
          observation.territory.id === '22001')
        await wrapper.findAll('.vues button').find((button) => button.text() === 'Carte')!.trigger('click')
        await flushPromises()
        const mapPayload = wrapper.findComponent({ name: 'MapExplorer' }).props('payload') as Payload
        const mapFact = mapPayload.indicateurs.find((fact) => fact.key === current.indicator &&
          fact.territoire === '22001')
        expect(mapFact?.value ?? null).toBe(focal?.value ?? null)

        await wrapper.findAll('.vues button').find((button) => button.text() === 'L’indicateur')!.trigger('click')
        await flushPromises()
        if (focal?.sources?.[0]) expect(wrapper.text()).toContain(focal.sources[0].name)
        if (current.indicator === 'densite') expect(wrapper.text()).toContain('2026-06-30')
        await wrapper.findAll('.vues button').find((button) => button.text() === 'Repères')!.trigger('click')
        await flushPromises()
        expect(readItems.slice(warmedPageReadCount).map(({ item }) => ({ resource: item.resource,
          intent: item.intent.kind, target: item.target }))).toEqual([])
      }
    } finally {
      wrapper.unmount()
      if (scalarEnv === undefined) delete import.meta.env.VITE_SCALAR_COHORT_API
      else import.meta.env.VITE_SCALAR_COHORT_API = scalarEnv
      if (scalarProcessEnv === undefined) delete process.env.VITE_SCALAR_COHORT_API
      else process.env.VITE_SCALAR_COHORT_API = scalarProcessEnv
    }
  })

  it('reads one native focal fact without widening a filtered commune cohort', async () => {
    vi.stubEnv('VITE_SCALAR_COHORT_API', '0')
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '0')
    vi.stubEnv('VITE_OWNED_SERIES_API', '0')
    const requests: Array<Record<string, any>> = []
    const target = { kind: 'territory_cohort', type: 'commune', department_id: null, epci_id: '200000001' }
    const members = ['22001', '22002']
    const cohortFacts = cohortResult('demographie', 'densite', target, members, [
      observation('demographie', 'densite', '22001', 'measured', 812),
      observation('demographie', 'densite', '22002', 'measured', 318),
    ])
    const values = new Map([['22001', { status: 'measured', value: 812 }],
      ['22002', { status: 'measured', value: 318 }]])
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/data/theme_demographie.json') return new Response(JSON.stringify(metadata('demographie')))
      if (url === '/api/resources/read-batch') {
        const body = JSON.parse(init?.body as string) as { items: Array<Record<string, any>> }
        requests.push(...body.items)
        return nativeBatchResponse(body.items, (item) => {
          if (item.intent.kind === 'selected_comparison') {
            return scalarComparison('demographie', item as { target: { type: string; id?: string }; intent: any }, 'densite', values)
          }
          if (item.target.kind === 'territory_cohort') return projectCohortFields(cohortFacts, item.fields)
          return { resource: 'densite', target: item.target, indicator_id: 'densite',
            territory_id: item.target.id, territory_type: item.target.type,
            label: resource('demographie', 'densite').label, unit: resource('demographie', 'densite').unit, direction: 'high',
            content_version: 'scalar-publication-v4', reference_content_version: 'reference-v7',
            descriptor_version: 'scalar-descriptor-v3', comparison_facet: 'densite', value: 98765, status: 'measured',
            ...(item.fields.includes('support_count') ? { support_count: 91, denominator_count: 100 } : {}),
            sources: [sourceFor('demographie', 'densite')] }
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs/demographie/densite?territoire=29001&niveau=commune&epci=200000001')
    await router.isReady()
    const loader: ChargerFichier = async (file) => {
      if (file === 'territoires') return territoiresFixture
      throw new Error(`API-selected page requested static numeric facts: ${file}`)
    }
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: loader,
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
    try {
      await flushPromises()
      const cohortRead = requests.find((item) => item.intent.kind === 'facts' && item.target.kind === 'territory_cohort')
      const focalRead = requests.find((item) => item.intent.kind === 'facts' && item.target.kind === 'territory')
      const comparisonRead = requests.find((item) => item.intent.kind === 'selected_comparison')
      expect(router.currentRoute.value.query.territoire).toBe('29001')
      expect(router.currentRoute.value.query.epci).toBe('200000001')
      expect(cohortRead?.target).toEqual(target)
      expect(wrapper.find('[role="alert"]').exists()).toBe(false)
      expect(comparisonRead?.target.id).toBe('29001')
      expect(focalRead?.target).toEqual({ kind: 'territory', type: 'commune', id: '29001' })
      expect(comparisonRead?.intent.members).toEqual(members.map((id) => ({ type: 'commune', id })))
      expect(requests.filter((item) => item.intent.kind === 'facts' && item.target.kind === 'territory')).toHaveLength(1)

      await wrapper.findAll('.vues button').find((button) => button.text() === 'Carte')!.trigger('click')
      await flushPromises()
      const mapPayload = wrapper.findComponent({ name: 'MapExplorer' }).props('payload') as Payload
      expect(router.currentRoute.value.query.territoire).toBe('29001')
      expect(mapPayload.indicateurs.find((fact) => fact.key === 'densite' && fact.territoire === '29001'))
        .toMatchObject({ value: 98765, fact_status: 'measured' })
      expect(mapPayload.indicateurs.some((fact) => fact.key === 'densite' && fact.territoire === '22001')).toBe(true)
      expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    } finally {
      wrapper.unmount()
    }
  })

  it('keeps valid cohort facts when the out-of-cohort focal has no native scalar row', async () => {
    vi.stubEnv('VITE_SCALAR_COHORT_API', '0')
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '0')
    vi.stubEnv('VITE_OWNED_SERIES_API', '0')
    const target = { kind: 'territory_cohort', type: 'commune', department_id: null, epci_id: '200000001' }
    const cohortFacts = cohortResult('demographie', 'densite', target, ['22001', '22002'], [
      observation('demographie', 'densite', '22001', 'measured', 812),
      observation('demographie', 'densite', '22002', 'measured', 318),
    ])
    const values = new Map([['22001', { status: 'measured', value: 812 }],
      ['22002', { status: 'measured', value: 318 }]])
    const requests: Array<Record<string, any>> = []
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/data/theme_demographie.json') return new Response(JSON.stringify(metadata('demographie')))
      if (url === '/api/resources/read-batch') {
        const body = JSON.parse(init?.body as string) as { items: Array<Record<string, any>> }
        requests.push(...body.items)
        if (body.items.some((item) => item.target.kind === 'territory' && item.intent.kind === 'facts')) {
          return new Response('No scalar observation for focal territory', { status: 404 })
        }
        return nativeBatchResponse(body.items, (item) => item.intent.kind === 'selected_comparison'
          ? scalarComparison('demographie', item as { target: { type: string; id?: string }; intent: any }, 'densite', values)
          : projectCohortFields(cohortFacts, item.fields))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs/demographie/densite?territoire=29001&niveau=commune&epci=200000001')
    await router.isReady()
    const loader: ChargerFichier = async (file) => {
      if (file === 'territoires') return territoiresFixture
      throw new Error(`API-selected page requested static numeric facts: ${file}`)
    }
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: loader,
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
    try {
      await flushPromises()
      expect(requests.some((item) => item.target.kind === 'territory_cohort')).toBe(true)
      expect(requests.some((item) => item.target.kind === 'territory' && item.target.id === '29001')).toBe(true)
      expect(wrapper.find('[role="alert"]').exists()).toBe(false)
      expect(wrapper.get('[data-testid="scalar-comparison-summary"]').text())
        .toContain('Le territoire focal est hors de la sélection')
      await wrapper.findAll('.vues button').find((button) => button.text() === 'Carte')!.trigger('click')
      await flushPromises()
      const mapPayload = wrapper.findComponent({ name: 'MapExplorer' }).props('payload') as Payload
      expect(mapPayload.indicateurs.some((fact) => fact.key === 'densite' && fact.territoire === '29001')).toBe(false)
      expect(mapPayload.indicateurs.some((fact) => fact.key === 'densite' && fact.territoire === '22001')).toBe(true)
    } finally {
      wrapper.unmount()
    }
  })

  it('ignores a late focal fact after the URL changes back inside the filtered cohort', async () => {
    vi.stubEnv('VITE_SCALAR_COHORT_API', '0')
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '0')
    vi.stubEnv('VITE_OWNED_SERIES_API', '0')
    const target = { kind: 'territory_cohort', type: 'commune', department_id: null, epci_id: '200000001' }
    const members = ['22001', '22002']
    const cohortFacts = cohortResult('demographie', 'densite', target, members, [
      observation('demographie', 'densite', '22001', 'measured', 812),
      observation('demographie', 'densite', '22002', 'measured', 318),
    ])
    const values = new Map([['22001', { status: 'measured', value: 812 }],
      ['22002', { status: 'measured', value: 318 }]])
    let resolveFocal: (() => void) | undefined
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/data/theme_demographie.json') return new Response(JSON.stringify(metadata('demographie')))
      if (url === '/api/resources/read-batch') {
        const body = JSON.parse(init?.body as string) as { items: Array<Record<string, any>> }
        if (body.items.some((item) => item.target.kind === 'territory' && item.intent.kind === 'facts')) {
          return new Promise<Response>((resolve) => {
            resolveFocal = () => resolve(nativeBatchResponse(body.items, (item) => ({
              resource: 'densite', target: item.target, indicator_id: 'densite',
              territory_id: item.target.id, territory_type: item.target.type,
              label: resource('demographie', 'densite').label,
              unit: resource('demographie', 'densite').unit, direction: 'high',
              content_version: 'scalar-publication-v4', reference_content_version: 'reference-v7',
              descriptor_version: 'scalar-descriptor-v3', value: 98765, status: 'measured',
              sources: [sourceFor('demographie', 'densite')],
            })))
          })
        }
        return nativeBatchResponse(body.items, (item) => item.intent.kind === 'selected_comparison'
          ? scalarComparison('demographie', item as { target: { type: string; id?: string }; intent: any }, 'densite', values)
          : projectCohortFields(cohortFacts, item.fields))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs/demographie/densite?territoire=29001&niveau=commune&epci=200000001')
    await router.isReady()
    const loader: ChargerFichier = async (file) => {
      if (file === 'territoires') return territoiresFixture
      throw new Error(`API-selected page requested static numeric facts: ${file}`)
    }
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: loader,
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
    try {
      await flushPromises()
      expect(resolveFocal).toBeDefined()
      expect(wrapper.find('[data-testid="scalar-focal-pending"]').exists()).toBe(true)

      await router.replace({ query: { territoire: '22001', niveau: 'commune', epci: '200000001' } })
      await flushPromises()
      expect(router.currentRoute.value.query.territoire).toBe('22001')
      resolveFocal!()
      await flushPromises()

      await wrapper.findAll('.vues button').find((button) => button.text() === 'Carte')!.trigger('click')
      await flushPromises()
      const mapPayload = wrapper.findComponent({ name: 'MapExplorer' }).props('payload') as Payload
      expect(mapPayload.indicateurs.find((fact) => fact.key === 'densite' && fact.territoire === '22001'))
        .toMatchObject({ value: 812, fact_status: 'measured' })
      expect(mapPayload.indicateurs.some((fact) => fact.key === 'densite' && fact.territoire === '29001')).toBe(false)
    } finally {
      wrapper.unmount()
    }
  })

  it.each(['discovery', 'metadata'] as const)(
    'retries a %s failure without selecting a static numeric reader', async (failure) => {
      vi.stubEnv('VITE_SCALAR_COHORT_API', '0')
      vi.stubEnv('VITE_THEME_ACQUISITION_API', '0')
      vi.stubEnv('VITE_OWNED_SERIES_API', '0')
      let discoveryAttempts = 0
      let metadataAttempts = 0
      const requestedFiles: string[] = []
      const requests: Array<Record<string, any>> = []
      const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url === '/api/resources') {
          discoveryAttempts++
          if (failure === 'discovery' && discoveryAttempts === 1) return new Response('unavailable', { status: 503 })
          return nativeCatalogueResponse()
        }
        if (url === '/data/theme_demographie.json') {
          metadataAttempts++
          if (failure === 'metadata' && metadataAttempts === 1) return new Response('unavailable', { status: 503 })
          return new Response(JSON.stringify(metadata('demographie')))
        }
        if (url === '/api/resources/read-batch') {
          const body = JSON.parse(init?.body as string) as { items: Array<Record<string, any>> }
          requests.push(...body.items)
          return nativeBatchResponse(body.items, (item, declaration) => nativeReadFixture(item, declaration, {
            territories: territoiresFixture as unknown as Array<Record<string, any>>,
          }))
        }
        throw new Error(`Unexpected request: ${url}`)
      })
      vi.stubGlobal('fetch', fetcher)
      const router = createRouter({ history: createMemoryHistory(), routes })
      await router.push('/indicateurs/demographie/densite?territoire=22001&niveau=commune')
      await router.isReady()
      const loader: ChargerFichier = async (file) => {
        requestedFiles.push(file)
        if (file === 'territoires') return territoiresFixture
        throw new Error(`API-selected page requested static numeric facts or a legacy manifest: ${file}`)
      }
      const empty = { type: 'FeatureCollection' as const, features: [] }
      const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
        [PAYLOAD_CHARGER_KEY]: loader,
        [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
      } } })
      try {
        await flushPromises()
        expect(wrapper.find('[role="alert"]').exists()).toBe(true)
        expect(requests).toHaveLength(0)
        expect(requestedFiles).toEqual(['territoires'])
        if (failure === 'discovery') expect(metadataAttempts).toBe(0)
        else expect(metadataAttempts).toBe(1)

        await wrapper.get('[role="alert"] button').trigger('click')
        await flushPromises()

        expect(discoveryAttempts).toBe(2)
        expect(metadataAttempts).toBe(failure === 'discovery' ? 1 : 2)
        expect(wrapper.find('[role="alert"]').exists()).toBe(false)
        expect(wrapper.get('h1').text()).toBe(metadata('demographie').indicator_pages.densite.label)
        expect(requests.filter((item) => item.intent.kind === 'facts' && item.target.kind === 'territory_cohort'))
          .toHaveLength(1)
        expect(requestedFiles).toEqual(['territoires'])
        expect(fetcher.mock.calls.some(([input]) => String(input).includes('/indicator-cohorts/') ||
          String(input).includes('/data/indicateurs_') || String(input).includes('/modeles-lecture/'))).toBe(false)
      } finally {
        wrapper.unmount()
      }
    })

  it('retries only a failed page comparison while preserving validated scalar facts', async () => {
    let comparisonAttempts = 0
    let factReads = 0
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/data/theme_demographie.json') return new Response(JSON.stringify(metadata('demographie')))
      if (url === '/api/resources/read-batch') {
        const request = JSON.parse(init?.body as string) as { items: Array<Record<string, any>> }
        return nativeBatchResponse(request.items, (item, declaration) => {
          if (item.intent.kind === 'facts') factReads++
          else comparisonAttempts++
          if (item.intent.kind !== 'facts' && comparisonAttempts === 1) {
            throw new Error('comparison fixture should be returned as HTTP 503')
          }
          return nativeReadFixture(item, declaration, {
            territories: territoiresFixture as unknown as Array<Record<string, any>>,
          })
        })
      }
      throw new Error(`Unexpected scalar-page request: ${url}`)
    })
    const nativeFetch = fetcher.getMockImplementation()!
    fetcher.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/resources/read-batch') {
        const request = JSON.parse(init?.body as string) as { items: Array<Record<string, any>> }
        if (request.items.some((item) => item.intent.kind !== 'facts') && comparisonAttempts === 0) {
          comparisonAttempts++
          return new Response('comparison temporarily unavailable', { status: 503 })
        }
      }
      return nativeFetch(input, init)
    })
    vi.stubGlobal('fetch', fetcher)
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs/demographie/densite?territoire=22001&niveau=commune')
    await router.isReady()
    const loader: ChargerFichier = async (file) => {
      if (file === 'territoires') return territoiresFixture
      throw new Error(`API-selected page requested static numeric facts: ${file}`)
    }
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: loader,
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
    try {
      await flushPromises()
      expect(factReads).toBe(1)
      expect(comparisonAttempts).toBe(1)
      expect(wrapper.find('[data-testid="scalar-comparison-error"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="scalar-comparison-summary"]').exists()).toBe(false)
      expect(wrapper.get('h1').text()).toBe(metadata('demographie').indicator_pages.densite.label)
      expect(wrapper.find('[role="alert"]').text()).toContain('Les faits scalaires API restent affichés')
      await wrapper.get('[data-testid="scalar-comparison-retry"]').trigger('click')
      await flushPromises()
      expect(factReads).toBe(1)
      expect(comparisonAttempts).toBe(2)
      expect(wrapper.find('[data-testid="scalar-comparison-error"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="scalar-comparison-summary"]').exists()).toBe(true)
    } finally {
      wrapper.unmount()
    }
  })

  it('reacquires a descriptor-mismatched comparison before accepting a same-publication retry', async () => {
    let comparisonAttempts = 0
    let factReads = 0
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/data/theme_demographie.json') return new Response(JSON.stringify(metadata('demographie')))
      if (url === '/api/resources/read-batch') {
        const request = JSON.parse(init?.body as string) as { items: Array<Record<string, any>> }
        return nativeBatchResponse(request.items, (item, declaration) => {
          if (item.intent.kind === 'facts') factReads++
          else comparisonAttempts++
          const response = nativeReadFixture(item, declaration, {
            territories: territoiresFixture as unknown as Array<Record<string, any>>,
          })
          if (item.intent.kind !== 'facts' && comparisonAttempts === 1) {
            response.result.descriptor_version = 'stale-comparison-descriptor'
          }
          return response
        })
      }
      throw new Error(`Unexpected scalar-page request: ${url}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs/demographie/densite?territoire=22001&niveau=commune')
    await router.isReady()
    const loader: ChargerFichier = async (file) => {
      if (file === 'territoires') return territoiresFixture
      throw new Error(`API-selected page requested static numeric facts: ${file}`)
    }
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: loader,
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
    try {
      await flushPromises()
      expect(factReads).toBe(1)
      expect(comparisonAttempts).toBe(1)
      expect(wrapper.find('[data-testid="scalar-comparison-error"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="scalar-comparison-summary"]').exists()).toBe(false)
      await wrapper.get('[data-testid="scalar-comparison-retry"]').trigger('click')
      await flushPromises()
      expect(factReads).toBe(1)
      expect(comparisonAttempts).toBe(2)
      expect(wrapper.find('[data-testid="scalar-comparison-error"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="scalar-comparison-summary"]').exists()).toBe(true)
    } finally {
      wrapper.unmount()
    }
  })

  it('keeps EPCI page-table ranks bound to the producer-published same-level comparison', async () => {
    vi.stubEnv('VITE_SCALAR_COHORT_API', '0')
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '0')
    vi.stubEnv('VITE_OWNED_SERIES_API', '0')
    const target = { kind: 'territory_cohort', type: 'epci', department_id: null, epci_id: null }
    const memberIds = ['200000001', '200000002']
    const cohortFacts = cohortResult('demographie', 'densite', target, memberIds, [
      observation('demographie', 'densite', memberIds[0]!, 'measured', 901),
      observation('demographie', 'densite', memberIds[1]!, 'not_available', null),
    ])
    const values = new Map([[memberIds[0]!, { status: 'measured', value: 901 }],
      [memberIds[1]!, { status: 'not_available', value: null }]])
    const requests: Array<Record<string, any>> = []
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/data/theme_demographie.json') return new Response(JSON.stringify(metadata('demographie')))
      if (url === '/api/resources/read-batch') {
        const body = JSON.parse(init?.body as string) as { items: Array<Record<string, any>> }
        requests.push(...body.items)
        return nativeBatchResponse(body.items, (item) => item.intent.kind === 'fixed_comparison'
          ? scalarComparison('demographie', item as { target: { type: string; id?: string }; intent: any }, 'densite', values)
          : projectCohortFields(cohortFacts, item.fields))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs/demographie/densite?territoire=200000001&niveau=epci')
    await router.isReady()
    const loader: ChargerFichier = async (file) => {
      if (file === 'territoires') return territoiresFixture
      throw new Error(`API-selected page requested static numeric facts: ${file}`)
    }
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: loader,
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
    try {
      await flushPromises()
      const factRead = requests.find((item) => item.intent.kind === 'facts')
      const comparisonRead = requests.find((item) => item.intent.kind === 'fixed_comparison')
      expect(factRead?.target).toEqual(target)
      expect(comparisonRead).toMatchObject({ resource: 'densite',
        target: { kind: 'territory', type: 'epci', id: '200000001' }, intent: { kind: 'fixed_comparison', context: 'default' } })
      expect(comparisonRead?.intent.members).toBeUndefined()
      expect(wrapper.get('[data-testid="scalar-comparison-summary"]').text()).toContain('Médiane API')
      const rows = wrapper.findAll('tbody tr').map((row) => row.text())
      expect(rows.find((row) => row.includes('EPCI X'))).toContain('1er / 1')
      expect(wrapper.get('[data-testid="scalar-comparison-summary"]').text()).toContain('1 valeurs comparables')
      expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    } finally {
      wrapper.unmount()
    }
  })

  it('mounted indicator page sends a filtered cohort read-batch and renders API value, status and provenance', async () => {
    const body = cohortResult('economie', 'effectifs_salaries', {
      kind: 'territory_cohort', type: 'commune', department_id: '22', epci_id: '200000001',
    }, ['22001', '22002'], [
      observation('economie', 'effectifs_salaries', '22001', 'measured', 9999),
      observation('economie', 'effectifs_salaries', '22002', 'suppressed', null),
    ])
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/data/theme_economie.json') return new Response(JSON.stringify(metadata('economie')))
      if (url === '/api/resources') return new Response(JSON.stringify(discovery(resource('economie', 'effectifs_salaries'))))
      if (url === '/api/resources/read-batch') {
        const request = JSON.parse(init?.body as string)
        const item = request.items[0]
        if (item.intent.kind === 'facts') return new Response(JSON.stringify(batch({ id: item.id,
          resource: 'effectifs_salaries', data: projectCohortFields(body, item.fields) })))
        const values = new Map((body.observations as Array<Record<string, any>>).map((row) =>
          [row.territory.id, { status: row.status, value: row.value }]))
        return new Response(JSON.stringify(batch({ id: item.id, resource: 'effectifs_salaries',
          data: scalarComparison('economie', item, 'effectifs_salaries', values) })))
      }
      throw new Error(`unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs/economie/effectifs_salaries?territoire=22001&niveau=commune&departement=22&epci=200000001')
    await router.isReady()
    const loader: ChargerFichier = async (file) => {
      if (file === 'territoires') return territoiresFixture
      throw new Error(`API-selected page requested static numeric facts: ${file}`)
    }
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: loader,
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
    await flushPromises()

    const call = readBatchCall(fetcher)
    expect(call).toBeDefined()
    const request = JSON.parse((call?.[1] as RequestInit).body as string)
    expect(request.items).toHaveLength(1)
    expect(request.items[0]).toMatchObject({ resource: 'effectifs_salaries',
      target: { kind: 'territory_cohort', type: 'commune', department_id: '22', epci_id: '200000001' },
      intent: { kind: 'facts' } })
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/indicator-cohorts/') || String(url).includes('/communes/'))).toBe(false)
    expect(wrapper.text()).toContain('9 999')
    expect(wrapper.text()).toContain('Repères partiels')
    expect(wrapper.text()).not.toContain('1 234 560')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('ranks the acquired table population with ties and keeps only the newly resolved scope after navigation', async () => {
    let resolveStaleScope: (() => void) | undefined
    const targets: Array<{ kind: string; type: string; department_id?: string | null; epci_id?: string | null }> = []
    let currentValues = new Map<string, { status: string; value: number | null }>()
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/data/theme_demographie.json') return new Response(JSON.stringify(metadata('demographie')))
      if (url === '/api/resources') return new Response(JSON.stringify(discovery(resource('demographie', 'densite'))))
      if (url === '/api/resources/read-batch') {
        const request = JSON.parse(init?.body as string) as { items: Array<{
          id: string; resource: string; target: any; intent?: any; fields?: string[]
        }> }
          const item = request.items[0]!
          if (item.intent?.kind === 'selected_comparison' || item.intent?.kind === 'fixed_comparison') {
            return new Response(JSON.stringify(batch({ id: item.id, resource: 'densite',
            data: scalarComparison('demographie', { target: item.target, intent: item.intent }, 'densite', currentValues) })))
        }
        targets.push(item.target)
        const refs = territoiresFixture.filter((territory) => territory.type === item.target.type &&
          (!item.target.department_id || territory.departement === item.target.department_id) &&
          (!item.target.epci_id || territory.epci === item.target.epci_id))
        const observations = refs.map((territory, index) => {
          const missing = !item.target.epci_id && territory.territoire === '29002'
          const value = item.target.epci_id === '200000001' ? 5
            : item.target.epci_id === '200000002' ? 2 + index * 2
              : [10, 10, 3, null][index]!
          return observation('demographie', 'densite', territory.territoire,
            missing ? 'not_available' : 'measured', value)
        })
        currentValues = new Map((observations as Array<Record<string, any>>).map((row) =>
          [row.territory.id, { status: row.status, value: row.value }]))
        const data = projectCohortFields(cohortResult('demographie', 'densite', item.target,
          refs.map((territory) => territory.territoire), observations), item.fields)
        const response = new Response(JSON.stringify(batch({ id: item.id, resource: 'densite', data })))
        if (targets.length === 2) return new Promise<Response>((resolve) => { resolveStaleScope = () => resolve(response) })
        return response
      }
      throw new Error(`unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs/demographie/densite?territoire=22001&niveau=commune')
    await router.isReady()
    const loader: ChargerFichier = async (file) => {
      if (file === 'territoires') return territoiresFixture
      throw new Error(`API-selected page requested static numeric facts: ${file}`)
    }
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: loader,
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
    } } })
    await flushPromises()
    expect(targets).toHaveLength(1)
    const defaultRows = wrapper.findAll('tbody tr')
    expect(defaultRows).toHaveLength(3)
    const defaultText = defaultRows.map((row) => row.text())
    expect(defaultText.find((row) => row.includes('Commune A1'))).toContain('1er / 3')
    expect(defaultText.find((row) => row.includes('Commune D'))).toContain('1er / 3')
    expect(defaultText.find((row) => row.includes('Commune B'))).toContain('3e / 3')
    expect(defaultText.some((row) => row.includes('Commune C'))).toBe(false)

    await router.replace({ query: { territoire: '22001', niveau: 'commune', epci: '200000001' } })
    await flushPromises()
    expect(targets).toHaveLength(2)
    expect(targets[1]).toMatchObject({ epci_id: '200000001' })

    await router.replace({ query: { territoire: '29001', niveau: 'commune', epci: '200000002' } })
    await flushPromises()
    expect(targets).toHaveLength(3)
    expect(targets[2]).toMatchObject({ epci_id: '200000002' })
    expect(wrapper.findAll('tbody tr')).toHaveLength(2)
    const filteredRows = wrapper.findAll('tbody tr').map((row) => row.text())
    expect(filteredRows.find((row) => row.includes('Commune B'))).toContain('2e / 2')
    expect(filteredRows.find((row) => row.includes('Commune C'))).toContain('1er / 2')
    expect(filteredRows.some((row) => row.includes('Commune A1'))).toBe(false)

    resolveStaleScope!()
    await flushPromises()
    expect(wrapper.findAll('tbody tr')).toHaveLength(2)
    expect(wrapper.findAll('tbody tr').map((row) => row.text())).toEqual(filteredRows)
    wrapper.unmount()
  })

  it('standalone map replaces deceptive static values while one all-Bretagne cohort is pending or fails', async () => {
    vi.stubEnv('VITE_SCALAR_COHORT_API', '1')
    let failRead: ((error: Error) => void) | undefined
    const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input)
      if (url === '/data/theme_demographie.json') return new Response(JSON.stringify(metadata('demographie')))
      if (url === '/api/resources') return new Response(JSON.stringify(discovery(resource('demographie', 'densite'))))
      if (url === '/api/resources/read-batch') return new Promise<Response>((_resolve, reject) => { failRead = reject })
      throw new Error(`unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/carte?theme=demographie')
    await router.isReady()
    const wrapper = mount(CarteView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: chargerAvec(staticPayload),
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: communeMasks, epcis: null, departements: null }),
    } } })
    await flushPromises()
    maplibreMock.instancesCarteMaple.at(-1)?.fire('load')
    await flushPromises()
    await wrapper.findAll('.carte-sidebar-couche').find((button) => button.text().includes('Densité'))?.trigger('click')
    await flushPromises()

    const map = maplibreMock.instancesCarteMaple.at(-1)
    const joined = () => map?.sourcesSetData['masques-communes']?.mock.calls.at(-1)?.[0] as {
      features: { properties: { territoire: string; valeur: number | null } }[]
    }
    expect(joined().features.find((item) => item.properties.territoire === '22001')?.properties.valeur).toBeNull()
    const call = readBatchCall(fetcher)
    expect(call).toBeDefined()
    const request = JSON.parse((call?.[1] as RequestInit).body as string)
    expect(request.items).toHaveLength(1)
    expect(request.items[0]).toMatchObject({ resource: 'densite', target: {
      kind: 'territory_cohort', type: 'commune', department_id: null, epci_id: null,
    } })
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/indicator-cohorts/') || String(url).includes('/communes/'))).toBe(false)

    failRead?.(new Error('API offline'))
    await flushPromises()
    expect(joined().features.find((item) => item.properties.territoire === '22001')?.properties.valeur).toBeNull()
    expect(wrapper.find('[role="alert"]').text()).toContain('Réessayer')
    wrapper.unmount()
  })

  it('standalone map paints only native cohort values and does not trust static ranks', async () => {
    vi.stubEnv('VITE_SCALAR_COHORT_API', '1')
    const target = { kind: 'territory_cohort', type: 'commune', department_id: null, epci_id: null }
    const facts = cohortResult('demographie', 'densite', target, ['22001', '22002', '29001', '29002'], [
      observation('demographie', 'densite', '22001', 'measured', 9876),
      observation('demographie', 'densite', '22002', 'suppressed', null),
    ])
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/data/theme_demographie.json') return new Response(JSON.stringify(metadata('demographie')))
      if (url === '/api/resources') return new Response(JSON.stringify(discovery(resource('demographie', 'densite'))))
      if (url === '/api/resources/read-batch') {
        const item = JSON.parse(init?.body as string).items[0]
        if (item.intent.kind === 'selected_comparison') return new Response(JSON.stringify(batch({
          id: item.id, resource: 'densite', data: {
            resource: 'densite', target: item.target, contract: 'indicator-comparison-v1', indicator_id: 'densite', shape: 'scalar',
            content_version: 'scalar-publication-v4', reference_content_version: 'reference-v7',
            selection: item.intent.members.map((member: { type: string; id: string }) => ({ territory_type: member.type, territory_id: member.id })),
            scope: { kind: 'explicit_selection', member_count: 2 }, result: { indicator_id: 'densite', status: 'available',
              unit: metadata('demographie').indicator_pages.densite.unit, direction: 'high', source_facet: 'densite',
              descriptor_version: 'scalar-descriptor-v3', selected_member_count: 2, eligible_count: 2, missing_count: 0, rank: 2, rank_size: 2 },
          },
        })))
        return new Response(JSON.stringify(batch({ id: item.id, resource: 'densite', data: facts })))
      }
      throw new Error(`unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/carte?theme=demographie')
    await router.isReady()
    const wrapper = mount(CarteView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: chargerAvec(staticPayload),
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: { type: 'FeatureCollection', features: [
        { type: 'Feature', properties: { territoire: '22001' }, geometry: { type: 'Polygon', coordinates: [] } },
        { type: 'Feature', properties: { territoire: '22002' }, geometry: { type: 'Polygon', coordinates: [] } },
        { type: 'Feature', properties: { territoire: '29001' }, geometry: { type: 'Polygon', coordinates: [] } },
        { type: 'Feature', properties: { territoire: '29002' }, geometry: { type: 'Polygon', coordinates: [] } },
      ] }, epcis: null, departements: null }),
    } } })
    await flushPromises()
    maplibreMock.instancesCarteMaple.at(-1)?.fire('load')
    await flushPromises()
    await wrapper.findAll('.carte-sidebar-couche').find((button) => button.text().includes('Densité'))?.trigger('click')
    await flushPromises()

    const map = maplibreMock.instancesCarteMaple.at(-1)
    const joined = map?.sourcesSetData['masques-communes']?.mock.calls.at(-1)?.[0] as {
      features: { properties: { territoire: string; valeur: number | null } }[]
    }
    expect(joined.features.find((item) => item.properties.territoire === '22001')?.properties.valeur).toBe(9876)
    expect(joined.features.find((item) => item.properties.territoire === '22002')?.properties.valeur).toBeNull()
    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Densité de population')
    const call = readBatchCall(fetcher)
    expect(call).toBeDefined()
    const request = JSON.parse((call?.[1] as RequestInit).body as string)
    expect(request.items[0].target).toEqual(target)
    expect(JSON.parse((call?.[1] as RequestInit).body as string).items).toHaveLength(1)
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/indicator-cohorts/') || String(url).includes('/communes/'))).toBe(false)
    const mapClick = vi.spyOn(map!, 'queryRenderedFeatures').mockReturnValue([{ properties: { territoire: '22001' } }] as never)
    map?.fire('click', { point: { x: 1, y: 1 }, lngLat: { lng: -2, lat: 48 } })
    await flushPromises()
    expect(mapClick).toHaveBeenCalled()
    const rankRead = fetcher.mock.calls.find(([url, init]) => String(url) === '/api/resources/read-batch' &&
      JSON.parse((init as RequestInit).body as string).items[0].intent.kind === 'selected_comparison')
    expect(rankRead).toBeDefined()
    const rankItem = JSON.parse((rankRead?.[1] as RequestInit).body as string).items[0]
    expect(rankItem.intent.members).toEqual([{ type: 'commune', id: '22001' }, { type: 'commune', id: '22002' }])
    expect(maplibreMock.instancesPopups.at(-1)?.contenu).toContain('2e/2 · dans l\'EPCI')
    wrapper.unmount()
  })

  it('shows a failed map rank read and retries it without restoring a static rank', async () => {
    vi.stubEnv('VITE_SCALAR_COHORT_API', '1')
    const target = { kind: 'territory_cohort', type: 'commune', department_id: null, epci_id: null }
    const facts = cohortResult('demographie', 'densite', target, ['22001', '22002', '29001', '29002'], [
      observation('demographie', 'densite', '22001', 'measured', 9876),
      observation('demographie', 'densite', '22002', 'measured', 7654),
    ])
    let comparisonAttempts = 0
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/data/theme_demographie.json') return new Response(JSON.stringify(metadata('demographie')))
      if (url === '/api/resources') return new Response(JSON.stringify(discovery(resource('demographie', 'densite'))))
      if (url === '/api/resources/read-batch') {
        const item = JSON.parse(init?.body as string).items[0]
        if (item.intent.kind === 'selected_comparison') {
          comparisonAttempts++
          if (comparisonAttempts === 1) throw new Error('Comparison API offline')
          const members = item.intent.members.map((member: { type: string; id: string }) => ({
            territory_type: member.type, territory_id: member.id,
          }))
          return new Response(JSON.stringify(batch({ id: item.id, resource: 'densite', data: {
            resource: 'densite', target: item.target, contract: 'indicator-comparison-v1', indicator_id: 'densite',
            shape: 'scalar', content_version: 'scalar-publication-v4',
            reference_content_version: 'reference-v7', selection: members,
            scope: { kind: 'explicit_selection', member_count: members.length },
            result: { indicator_id: 'densite', status: 'available',
              unit: metadata('demographie').indicator_pages.densite.unit, direction: 'high', source_facet: 'densite',
              descriptor_version: 'scalar-descriptor-v3', selected_member_count: members.length,
              eligible_count: members.length, missing_count: 0, rank: 1, rank_size: members.length },
          } })))
        }
        return new Response(JSON.stringify(batch({ id: item.id, resource: 'densite', data: facts })))
      }
      throw new Error(`unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/carte?theme=demographie')
    await router.isReady()
    const wrapper = mount(CarteView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: chargerAvec(staticPayload),
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: communeMasks, epcis: null, departements: null }),
    } } })
    await flushPromises()
    const map = maplibreMock.instancesCarteMaple.at(-1)
    map?.fire('load')
    await flushPromises()
    await wrapper.findAll('.carte-sidebar-couche').find((button) => button.text().includes('Densité'))?.trigger('click')
    await flushPromises()
    vi.spyOn(map!, 'queryRenderedFeatures').mockReturnValue([{ properties: { territoire: '22001' } }] as never)
    map?.fire('click', { point: { x: 1, y: 1 }, lngLat: { lng: -2, lat: 48 } })
    await flushPromises()

    expect(comparisonAttempts).toBe(1)
    expect(wrapper.get('[role="alert"]').text()).toContain('Le rang de comparaison est indisponible.')
    expect(maplibreMock.instancesPopups.at(-1)?.contenu).not.toContain('1e/2')
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()

    expect(comparisonAttempts).toBe(2)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(maplibreMock.instancesPopups.at(-1)?.contenu).toContain("1er/2 · dans l'EPCI")
    wrapper.unmount()
  })

  it('ignores a pending map rank when the active scalar layer changes', async () => {
    vi.stubEnv('VITE_SCALAR_COHORT_API', '1')
    const indicators = ['densite', 'evolution_1968'] as const
    const resources = indicators.map((indicator) => resource('demographie', indicator))
    let resolveRank: (() => void) | undefined
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/data/theme_demographie.json') return new Response(JSON.stringify(metadata('demographie')))
      if (url === '/api/resources') return new Response(JSON.stringify(discovery(...resources)))
      if (url === '/api/resources/read-batch') {
        const item = JSON.parse(init?.body as string).items[0]
        if (item.intent.kind === 'selected_comparison') {
          const members = item.intent.members.map((member: { type: string; id: string }) => ({
            territory_type: member.type, territory_id: member.id,
          }))
          const response = new Response(JSON.stringify(batch({ id: item.id, resource: 'densite', data: {
            resource: 'densite', target: item.target, contract: 'indicator-comparison-v1', indicator_id: 'densite',
            shape: 'scalar', content_version: 'scalar-publication-v4',
            reference_content_version: 'reference-v7', selection: members,
            scope: { kind: 'explicit_selection', member_count: members.length },
            result: { indicator_id: 'densite', status: 'available',
              unit: metadata('demographie').indicator_pages.densite.unit, direction: 'high', source_facet: 'densite',
              descriptor_version: 'scalar-descriptor-v3', selected_member_count: members.length,
              eligible_count: members.length, missing_count: 0, rank: 2, rank_size: members.length },
          } })))
          return new Promise<Response>((resolve) => { resolveRank = () => resolve(response) })
        }
        const indicator = item.resource as typeof indicators[number]
        const facts = cohortResult('demographie', indicator, item.target, ['22001', '22002', '29001', '29002'], [
          observation('demographie', indicator, '22001', 'measured', indicator === 'densite' ? 9876 : 0.25),
          observation('demographie', indicator, '22002', 'measured', indicator === 'densite' ? 7654 : 0.15),
        ])
        return new Response(JSON.stringify(batch({ id: item.id, resource: indicator, data: facts })))
      }
      throw new Error(`unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/carte?theme=demographie')
    await router.isReady()
    const wrapper = mount(CarteView, { global: { plugins: [router], provide: {
      [PAYLOAD_CHARGER_KEY]: chargerAvec(staticPayload),
      [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: communeMasks, epcis: null, departements: null }),
    } } })
    await flushPromises()
    const map = maplibreMock.instancesCarteMaple.at(-1)
    map?.fire('load')
    await flushPromises()
    await wrapper.findAll('.carte-sidebar-couche').find((button) => button.text().includes('Densité'))?.trigger('click')
    await flushPromises()
    vi.spyOn(map!, 'queryRenderedFeatures').mockReturnValue([{ properties: { territoire: '22001' } }] as never)
    map?.fire('click', { point: { x: 1, y: 1 }, lngLat: { lng: -2, lat: 48 } })
    await flushPromises()
    expect(resolveRank).toBeDefined()

    const evolutionLayer = wrapper.findAll('.carte-sidebar-couche')
      .find((button) => button.text().includes('depuis 1968'))
    expect(evolutionLayer).toBeDefined()
    await evolutionLayer!.trigger('click')
    await flushPromises()
    resolveRank!()
    await flushPromises()

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(maplibreMock.instancesPopups.at(-1)?.contenu).not.toContain('popup-carte-rang')
    expect(maplibreMock.instancesPopups.at(-1)?.contenu).not.toContain("dans l'EPCI")
    wrapper.unmount()
  })
})
