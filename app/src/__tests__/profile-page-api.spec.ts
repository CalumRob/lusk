import { flushPromises, mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GEOMETRIE_CHARGER_KEY } from '../geo/useGeometrie'
import { territoiresFixture } from '../payload/fixtures'
import type { ThemeMetadata, TerritoireType } from '../payload/types'
import { INDICATOR_READ_MODEL_CHARGER_KEY, INDICATOR_READ_MODEL_MANIFEST_CHARGER_KEY } from '../payload/indicatorReadModel'
import { PAYLOAD_CHARGER_KEY, type ChargerFichier } from '../payload/usePayload'
import { routes } from '../router'
import IndicateurView from '../views/IndicateurView.vue'

type JsonRecord = Record<string, unknown>
type ProfileSpec = {
  theme: string
  indicator: string
  family: string
  metadata: ThemeMetadata & JsonRecord
  page: NonNullable<ThemeMetadata['indicator_pages']>[string]
  details: string[]
  sexes: string[]
  units: Record<string, string>
  scalar?: string
}

const themeNames = ['demographie', 'habitat', 'mobilite'] as const
const metadataByTheme = Object.fromEntries(themeNames.map((theme) => [theme,
  JSON.parse(readFileSync(join(process.cwd(), '..', 'public', 'data', `theme_${theme}.json`), 'utf8')) as ThemeMetadata & JsonRecord]))

function profilesFromProducerMetadata(): ProfileSpec[] {
  const profiles: ProfileSpec[] = []
  for (const theme of themeNames) {
    const metadata = metadataByTheme[theme]
    const contracts = (metadata.profile_contracts ?? {}) as Record<string, JsonRecord>
    for (const [indicator, page] of Object.entries(metadata.indicator_pages ?? {})) {
      const isProfile = Object.hasOwn(contracts, indicator) ||
        (page.family === 'pyramid' && page.pyramid.dimensions.includes('detail'))
      if (!isProfile) continue
      const contract = contracts[indicator] ?? {}
      const details = page.comparison?.details ??
        (page.family === 'distribution' ? page.distribution.signature :
          Object.keys(metadata.detail_labels[indicator] ?? {}))
      const sexes = page.comparison?.sexes ?? []
      const detailUnits = (contract.detail_units ?? {}) as Record<string, string>
      const units = Object.fromEntries(details.map((detail) => [detail,
        detailUnits[detail] ?? page.comparison?.unit ?? page.unit]))
      const scalar = page.comparison?.indicator && page.comparison.indicator !== indicator
        ? page.comparison.indicator : undefined
      profiles.push({ theme, indicator, family: page.family, metadata, page,
        details, sexes, units, scalar })
    }
  }
  return profiles
}

const profileSpecs = profilesFromProducerMetadata()
const sourceInfo = (id: string) => ({ source_id: id, name: `API source ${id}`,
  vintage_id: `${id}-api-v1`, version: 'API-2026', reference_date: '2026-05-04', publication_date: '2026-05-05' })

function resourceDeclarations(): JsonRecord[] {
  const profiles = profileSpecs.map((spec) => ({
    resource_id: spec.indicator, theme_id: spec.theme, indicator_id: spec.indicator,
    label: `API label ${spec.indicator}`, unit: spec.page.unit,
    direction: spec.page.comparison?.direction ?? spec.page.direction,
    allowed_levels: spec.page.levels, sources: spec.page.sources,
    shapes: ['declared_profile'], target_kinds: ['territory', 'territory_cohort'],
    axes: [...new Set(['detail', ...(spec.sexes.length ? ['sex'] : [])])],
    axis_values: [['detail', spec.details], ...(spec.sexes.length ? [['sex', spec.sexes]] : [])],
    dynamic_axes: [], fields: ['value'], intents: ['facts', 'fixed_comparison', 'selected_comparison'],
  }))
  const companions = profileSpecs.filter((spec) => spec.scalar).map((spec) => ({
    resource_id: spec.scalar!, theme_id: spec.theme, indicator_id: spec.scalar!,
    label: spec.page.comparison?.label ?? `API label ${spec.scalar}`,
    unit: spec.page.comparison?.unit ?? spec.page.unit,
    direction: spec.page.comparison?.direction ?? spec.page.direction,
    allowed_levels: spec.page.levels, sources: spec.page.sources,
    shapes: ['scalar'], target_kinds: ['territory', 'territory_cohort'],
    axes: [], axis_values: [], dynamic_axes: [],
    fields: ['value', 'support_count', 'denominator_count'],
    intents: ['facts', 'fixed_comparison', 'selected_comparison'],
  }))
  return [...profiles, ...companions]
}

function cohortMembers(type: TerritoireType, department: string | null, epci: string | null) {
  return territoiresFixture.filter((territory) => territory.type === type &&
    (!department || territory.departement === department) && (!epci || territory.epci === epci))
    .map((territory) => ({ id: territory.territoire, type: territory.type, name: territory.nom }))
}

function profileDescriptor(spec: ProfileSpec) {
  const axes = [
    ...spec.details.map((key, order) => ({ name: 'detail', key,
      label: `API axis ${key}`,
      order, unit: spec.units[key]! })),
    ...spec.sexes.map((key, order) => ({ name: 'sex', key, label: key, order, unit: null })),
  ]
  const comparisonPoint = spec.scalar ? null : {
    detail: spec.page.comparison?.detail ?? spec.details[0]!,
    sex: spec.page.comparison?.sex ?? null,
    direction: spec.page.comparison?.direction ?? spec.page.direction,
    unit: spec.units[spec.page.comparison?.detail ?? spec.details[0]!]!,
  }
  const contract = ((spec.metadata.profile_contracts ?? {}) as Record<string, JsonRecord>)[spec.indicator] ?? {}
  return {
    indicator: spec.indicator, label: `API label ${spec.indicator}`, unit: spec.page.unit,
    allowed_levels: spec.page.levels, completeness: contract.completeness ?? 'dense_complete',
    descriptor_version: `profile-descriptor-${spec.indicator}-v1`,
    denominator_semantics: contract.denominator_semantics ?? `API denominator ${spec.indicator}`,
    comparison_scalar: spec.scalar ?? null, required_scalar_version: spec.scalar ? 'scalar-content-v1' : null,
    comparison_point: comparisonPoint, axes,
  }
}

function responseEnvelope(item: JsonRecord, data: JsonRecord) {
  return { id: item.id, resource: item.resource, data }
}

function createTransport(options: { failComparisons?: number; failProfileFacts?: number;
  emptyProfileCohort?: boolean; suppressDpeSignature?: boolean; deferFirstProfile?: boolean } = {}) {
  const calls: Array<{ url: string; body?: JsonRecord }> = []
  const staticFiles: string[] = []
  const profileFactsCalls: JsonRecord[] = []
  const scalarFactsCalls: JsonRecord[] = []
  const comparisonCalls: JsonRecord[] = []
  let comparisonFailures = options.failComparisons ?? 0
  let profileFailures = options.failProfileFacts ?? 0
  let deferredResponse: (() => void) | null = null

  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = init?.body ? JSON.parse(init.body as string) as JsonRecord : undefined
    calls.push({ url, body })
    if (url.startsWith('/data/theme_')) {
      const theme = url.slice('/data/theme_'.length).replace('.json', '')
      staticFiles.push(url)
      return new Response(JSON.stringify(metadataByTheme[theme]), { status: 200 })
    }
    if (url === '/api/resources') {
      return new Response(JSON.stringify({ contract: 'semantic-resource-catalogue-v1', resources: resourceDeclarations() }), { status: 200 })
    }
    if (url === '/api/resources/read-batch') {
      const items = body?.items as JsonRecord[]
      const results = items.map((item) => {
        const resource = String(item.resource)
        const intent = item.intent as JsonRecord
        const target = item.target as JsonRecord
        if (intent.kind === 'facts' && target.kind === 'territory_cohort') {
          const type = target.type as TerritoireType
          const department = typeof target.department_id === 'string' ? target.department_id : null
          const epci = typeof target.epci_id === 'string' ? target.epci_id : null
          const members = cohortMembers(type, department, epci)
          const spec = profileSpecs.find((candidate) => candidate.indicator === resource)
          if (spec) {
            profileFactsCalls.push(item)
            if (profileFailures > 0) {
              profileFailures -= 1
              throw new Error('simulate profile fact transport outage')
            }
            const descriptor = profileDescriptor(spec)
            const responseMembers = options.emptyProfileCohort ? [] : members
              const profiles = responseMembers.map((territory, memberIndex) => ({ territory,
                cells: spec.details.flatMap((detail, detailIndex) => (spec.sexes.length ? spec.sexes : [null]).map((sex, sexIndex) => {
                  const measured = 0.317 + memberIndex * 0.071 + detailIndex * 0.019 + sexIndex * 0.007
                  const status = options.suppressDpeSignature && spec.indicator === 'distribution_dpe' && memberIndex === 0
                    ? detail === 'F' ? 'not_available' : detail === 'G' ? 'suppressed' : 'measured'
                    : 'measured'
                  return { detail, sex, unit: spec.units[detail]!, denominator_semantics: descriptor.denominator_semantics,
                  status, value: status === 'measured' ? measured : null,
                  sources: [sourceInfo(spec.page.sources[0]!) ] }
              })) }))
            const data: JsonRecord = { resource, shape: 'declared_profile', target,
              content_version: `profile-content-${resource}-v1`, reference_content_version: 'reference-api-v1',
              descriptor, cohort: { territory_type: type, department_id: department, epci_id: epci,
                member_count: responseMembers.length, members: responseMembers, reference_content_version: 'reference-api-v1' }, profiles }
            return responseEnvelope(item, data)
          }
          const specWithScalar = profileSpecs.find((candidate) => candidate.scalar === resource)!
          scalarFactsCalls.push(item)
          const descriptorScalar = { indicator_id: resource, theme_id: specWithScalar.theme,
            label: specWithScalar.page.comparison?.label ?? resource,
            unit: specWithScalar.page.comparison?.unit ?? specWithScalar.page.unit,
            direction: specWithScalar.page.comparison?.direction ?? specWithScalar.page.direction,
            comparison_facet: resource, allowed_levels: specWithScalar.page.levels,
            completeness: 'dense_complete', denominator_semantics: 'API scalar denominator',
            descriptor_version: `scalar-descriptor-${resource}-v1` }
          const observations = members.map((territory, index) => ({ territory,
            value: 0.623 + index * 0.023, status: 'measured', support_count: 100 + index,
            denominator_count: 200 + index, sources: [sourceInfo(specWithScalar.page.sources[0]!)] }))
          const data: JsonRecord = { resource, shape: 'scalar', target,
            content_version: 'scalar-content-v1', reference_content_version: 'reference-api-v1',
            descriptor: descriptorScalar,
            cohort: { territory_type: type, department_id: department, epci_id: epci,
              member_count: members.length, members, reference_content_version: 'reference-api-v1' }, observations }
          return responseEnvelope(item, data)
        }

        comparisonCalls.push(item)
        if (comparisonFailures > 0) {
          comparisonFailures -= 1
          throw new Error('simulate comparison transport outage')
        }
        const spec = profileSpecs.find((candidate) => candidate.indicator === resource)!
        const coordinates = item.coordinates as Record<string, string[]> | undefined
        const selectedMembers = intent.members as Array<{ type: TerritoireType; id: string }>
        const selectedDetail = coordinates?.detail?.[0] ?? spec.page.comparison?.detail ?? spec.details[0]!
        const selectedSex = coordinates?.sex?.[0] ?? spec.page.comparison?.sex ?? null
        const selectedUnit = spec.units[selectedDetail] ?? spec.page.comparison?.unit ?? spec.page.unit
        const sourceFacet = spec.scalar ? spec.scalar : { detail: selectedDetail, sex: selectedSex }
        const result: JsonRecord = {
          indicator_id: resource, status: 'available', reason: null,
          source_facet: sourceFacet, unit: spec.scalar ? spec.page.comparison?.unit : selectedUnit,
          direction: spec.scalar ? spec.page.comparison?.direction : spec.page.comparison?.direction ?? spec.page.direction,
          statistic: 'median',
          profile_descriptor_version: `profile-descriptor-${resource}-v1`,
          denominator_semantics: profileDescriptor(spec).denominator_semantics,
          focal_in_selection: selectedMembers.some((member) => member.id === target.id),
          selected_member_count: selectedMembers.length, eligible_count: selectedMembers.length, missing_count: 0,
          median: 0.777, rank: 1, rank_size: selectedMembers.length, rank_ties: 1,
          comparison_sources: [sourceInfo(spec.page.sources[0]!)],
        }
        if (spec.scalar) {
          result.source_facet_indicator_id = spec.scalar
          result.source_facet_label = spec.page.comparison?.label
          result.scalar_descriptor_version = `scalar-descriptor-${spec.scalar}-v1`
          result.required_scalar_version = 'scalar-content-v1'
        }
        const data: JsonRecord = { resource, target,
          contract: 'indicator-comparison-v1', indicator_id: resource, shape: 'profile',
          content_version: `comparison-content-${resource}-v1`,
          profile_content_version: `profile-content-${resource}-v1`,
          reference_content_version: 'reference-api-v1',
          scalar_content_version: spec.scalar ? 'scalar-content-v1' : null,
          selection: selectedMembers.map((member) => ({ territory_type: member.type, territory_id: member.id })),
          scope: { kind: 'explicit_selection', territory_type: target.type, member_count: selectedMembers.length },
          result }
        return responseEnvelope(item, data)
      })
      if (options.deferFirstProfile && profileFactsCalls.length === 1 && !deferredResponse) {
        return new Promise<Response>((resolve) => {
          deferredResponse = () => resolve(new Response(JSON.stringify({
            contract: 'semantic-read-batch-v1', results,
          }), { status: 200 }))
        })
      }
      return new Response(JSON.stringify({ contract: 'semantic-read-batch-v1', results }), { status: 200 })
    }
    return new Response('unexpected request', { status: 404 })
  })

  return { fetcher, calls, staticFiles, profileFactsCalls, scalarFactsCalls, comparisonCalls,
    releaseDeferred: () => {
      deferredResponse?.()
      deferredResponse = null
    } }
}

function pageLoader(staticFiles: string[]) {
  const charger: ChargerFichier = async (file) => {
    if (file === 'territoires') return territoiresFixture
    if (file === 'territoires-metadata') return null
    staticFiles.push(file)
    if (file.startsWith('indicateurs_')) throw new Error(`static profile numerics were requested: ${file}`)
    if (file.startsWith('theme_')) return metadataByTheme[file.slice('theme_'.length)]
    throw new Error(`unexpected file ${file}`)
  }
  return charger
}

async function mountPage(theme: string, indicator: string, transport: ReturnType<typeof createTransport>, query = 'territoire=22001&niveau=commune') {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(`/indicateurs/${theme}/${indicator}?${query}`)
  await router.isReady()
  const empty = { type: 'FeatureCollection' as const, features: [] }
  const staticFiles: string[] = []
  vi.stubGlobal('fetch', transport.fetcher)
  const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
    [PAYLOAD_CHARGER_KEY]: pageLoader(staticFiles),
    [INDICATOR_READ_MODEL_MANIFEST_CHARGER_KEY]: async () => ({ schemaVersion: '1' as const, routes: {} }),
    [INDICATOR_READ_MODEL_CHARGER_KEY]: vi.fn(async () => { throw new Error('profile route must not load a static read model') }),
    [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
  }, stubs: { MapExplorer: {
    name: 'MapExplorer', props: ['payload', 'activeIds', 'theme', 'couche', 'niveau', 'territoireCible', 'requeteZoom', 'masques'],
    template: '<div data-testid="profile-map" :data-profile-facts="payload.indicateurs.map((fact) => [fact.key, fact.territoire, fact.detail || \'\', fact.sex || \'\', fact.value].join(\':\')).join(\'|\')" />',
  } } } })
  return { wrapper, router, staticFiles }
}

beforeEach(() => localStorage.clear())
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('les dix pages de profils déclarés utilisent le lecteur sémantique commun', () => {
  it('découvre la famille par le catalogue producteur et couvre le census exact, sans charger de numérics statiques', async () => {
    vi.stubEnv('VITE_THEME_ACQUISITION_API', '0')
    vi.stubEnv('VITE_SCALAR_COHORT_API', '0')
    expect(profileSpecs.map(({ theme, indicator, family }) => [theme, indicator, family])).toEqual([
      ['demographie', 'structure_age', 'pyramid'],
      ['habitat', 'mix_logements', 'composition'], ['habitat', 'statut', 'composition'],
      ['habitat', 'age_du_bati', 'composition'], ['habitat', 'type', 'composition'],
      ['habitat', 'distribution_dpe', 'distribution'],
      ['mobilite', 'voitures_menage', 'composition'], ['mobilite', 'offre_cyclable', 'composition'],
      ['mobilite', 'reseaux', 'list'], ['mobilite', 'reseaux_par_habitant', 'list'],
    ])
    for (const spec of profileSpecs) {
      const transport = createTransport()
      const { wrapper, staticFiles } = await mountPage(spec.theme, spec.indicator, transport,
        'territoire=22001&niveau=commune&vue=indicateur')
      await flushPromises()

      expect(wrapper.text(), `${spec.theme}/${spec.indicator}`).toContain(`API source ${spec.page.sources[0]}`)
      expect(wrapper.text(), `${spec.theme}/${spec.indicator}`).toContain('API-2026')
      expect(transport.profileFactsCalls.filter((item) => item.resource === spec.indicator)).toHaveLength(1)
      expect(transport.profileFactsCalls[0]).toMatchObject({ resource: spec.indicator,
        target: { kind: 'territory_cohort', type: 'commune' },
        fields: ['value'], intent: { kind: 'facts' } })
      expect(transport.comparisonCalls.filter((item) => item.resource === spec.indicator)).toHaveLength(1)
      expect(staticFiles.some((file) => file.startsWith('indicateurs_'))).toBe(false)
      expect(transport.calls.some(({ url }) => url.includes('/profiles/'))).toBe(false)
      expect(transport.calls.some(({ url }) => url.startsWith('/api/territories/'))).toBe(false)
      expect(transport.calls.some(({ url }) => url.startsWith('/data/indicateurs_'))).toBe(false)
      expect(transport.calls.some(({ url }) => url === '/api/resources')).toBe(true)
      if (spec.scalar) {
        expect(transport.scalarFactsCalls.some((item) => item.resource === spec.scalar)).toBe(true)
        expect(transport.comparisonCalls.some((item) => item.resource === spec.indicator)).toBe(true)
      }
      wrapper.unmount()
    }
  })

  it('rend les quatre présentations à partir des cellules API, dont les unités mixtes et les deux sexes', async () => {
    const representatives = [
      profileSpecs.find((spec) => spec.family === 'pyramid')!,
      profileSpecs.find((spec) => spec.family === 'composition')!,
      profileSpecs.find((spec) => spec.family === 'distribution')!,
      profileSpecs.find((spec) => spec.family === 'list')!,
    ]
    for (const spec of representatives) {
      const transport = createTransport()
      const { wrapper } = await mountPage(spec.theme, spec.indicator, transport)
      await flushPromises()
      expect(wrapper.find(`[data-renderer="${spec.family}"]`).exists(), spec.indicator).toBe(true)
      expect(wrapper.text()).toContain(`API label ${spec.indicator}`)
      expect(wrapper.text()).toContain('API source')
      if (spec.family === 'composition' && spec.page.family === 'composition') {
        const part = spec.page.composition.parts[0]!
        expect(wrapper.text()).toContain(`API axis ${part}`)
        expect(wrapper.text()).not.toContain(spec.metadata.detail_labels[spec.indicator]?.[part] ?? '\u0000')
        if (spec.indicator === 'mix_logements') {
          expect(wrapper.get('[data-testid="composition-contextualisee"]').text()).toContain('32%')
          expect(wrapper.get('.median strong').text()).toContain('78 %')
          expect(wrapper.get('.comparison-table-scroll').attributes('role')).toBe('region')
          expect(wrapper.get('.comparison-table-scroll').attributes('aria-label')).toBe('Tableau des territoires comparables')
        }
      }
      if (spec.indicator === 'structure_age') {
        expect(wrapper.find('[aria-label="Sexe comparé"]').exists()).toBe(true)
        expect(wrapper.text()).toContain('Femmes')
        expect(wrapper.text()).toContain('Hommes')
      }
      if (spec.indicator === 'offre_cyclable') {
        const facts = transport.profileFactsCalls[0]!
        expect(facts.resource).toBe('offre_cyclable')
        expect(spec.details).toHaveLength(5)
        expect(new Set(Object.values(spec.units)).size).toBeGreaterThan(1)
      }
      wrapper.unmount()
    }
  })

  it('sélectionne un détail × sexe natif, garde les cellules factuelles chaudes et relit seulement la comparaison', async () => {
    const spec = profileSpecs.find((candidate) => candidate.indicator === 'structure_age')!
    const transport = createTransport()
    const { wrapper } = await mountPage(spec.theme, spec.indicator, transport)
    await flushPromises()
    const factsBefore = transport.profileFactsCalls.length
    const comparisonBefore = transport.comparisonCalls.length

    await wrapper.get('select[aria-label="Catégorie comparée"]').setValue('15-24')
    await flushPromises()
    await wrapper.get('select[aria-label="Sexe comparé"]').setValue('M')
    await flushPromises()

    expect(transport.profileFactsCalls).toHaveLength(factsBefore)
    expect(transport.comparisonCalls.length).toBeGreaterThan(comparisonBefore)
    const selected = transport.comparisonCalls.at(-1)!
    expect(selected.coordinates).toEqual({ detail: ['15-24'], sex: ['M'] })
    expect(selected.intent).toMatchObject({ kind: 'selected_comparison', members: [
      { type: 'commune', id: '22001' }, { type: 'commune', id: '22002' },
      { type: 'commune', id: '29001' }, { type: 'commune', id: '29002' },
    ] })
    expect(wrapper.text()).toContain('API axis 15-24')
    expect(wrapper.text()).toContain('Hommes')
    wrapper.unmount()
  })

  it('honore les niveaux non-commune et l’intersection exacte département × EPCI', async () => {
    const spec = profileSpecs.find((candidate) => candidate.indicator === 'mix_logements')!
    const epciTransport = createTransport()
    const epciPage = await mountPage(spec.theme, spec.indicator, epciTransport,
      'territoire=200000001&niveau=epci')
    await flushPromises()
    expect(epciTransport.profileFactsCalls[0]).toMatchObject({ target: {
      kind: 'territory_cohort', type: 'epci', department_id: null, epci_id: null,
    } })
    expect(epciTransport.comparisonCalls[0]?.intent).toMatchObject({ members: [
      { type: 'epci', id: '200000001' }, { type: 'epci', id: '200000002' },
    ] })
    epciPage.wrapper.unmount()

    const filteredTransport = createTransport()
    const filteredPage = await mountPage(spec.theme, spec.indicator, filteredTransport,
      'territoire=22001&niveau=commune&departement=22&epci=200000001')
    await flushPromises()
    expect(filteredTransport.profileFactsCalls[0]?.target).toMatchObject({
      department_id: '22', epci_id: '200000001',
    })
    expect(filteredTransport.comparisonCalls[0]?.intent).toMatchObject({ members: [
      { type: 'commune', id: '22001' }, { type: 'commune', id: '22002' },
    ] })
    filteredPage.wrapper.unmount()
  })

  it('utilise l’unité native de la facette mixte sélectionnée pour sa médiane', async () => {
    const spec = profileSpecs.find((candidate) => candidate.indicator === 'offre_cyclable')!
    const transport = createTransport()
    const { wrapper } = await mountPage(spec.theme, spec.indicator, transport)
    await flushPromises()
    await wrapper.get('[aria-label="Catégorie comparée"]').setValue('protege_km_1000')
    await flushPromises()

    expect(transport.comparisonCalls.at(-1)?.coordinates).toEqual({ detail: ['protege_km_1000'] })
    expect(wrapper.text()).toContain('API axis protege_km_1000')
    expect(wrapper.get('.median strong').text()).toContain('0,78 km / 1 000 hab')
    wrapper.unmount()
  })

  it('préserve les états absent et supprimé du profil DPE dense sans inventer une signature complète', async () => {
    const spec = profileSpecs.find((candidate) => candidate.indicator === 'distribution_dpe')!
    const transport = createTransport({ suppressDpeSignature: true })
    const { wrapper } = await mountPage(spec.theme, spec.indicator, transport)
    await flushPromises()

    const signatureStatus = wrapper.get('[data-testid="signature-distribution"] [role="status"]')
    expect(signatureStatus.text()).toContain('distribution incomplète ou supprimée')
    expect(wrapper.find('[data-testid="signature-distribution"] .signature-barres').exists()).toBe(false)
    expect(transport.profileFactsCalls[0]).toMatchObject({ resource: 'distribution_dpe', fields: ['value'] })
    wrapper.unmount()
  })

  it('rejette un cohort API vide incohérent, puis permet de réessayer les faits sans fallback statique', async () => {
    const spec = profileSpecs.find((candidate) => candidate.indicator === 'mix_logements')!
    const emptyTransport = createTransport({ emptyProfileCohort: true })
    const emptyPage = await mountPage(spec.theme, spec.indicator, emptyTransport)
    await flushPromises()
    expect(emptyTransport.profileFactsCalls.length).toBeGreaterThan(0)
    expect(emptyTransport.comparisonCalls).toHaveLength(0)
    expect(emptyPage.wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(emptyPage.staticFiles.some((file) => file.startsWith('indicateurs_'))).toBe(false)
    emptyPage.wrapper.unmount()

    const retryTransport = createTransport({ failProfileFacts: 1 })
    const retryPage = await mountPage(spec.theme, spec.indicator, retryTransport)
    await flushPromises()
    expect(retryPage.wrapper.find('[role="alert"] button').exists()).toBe(true)
    await retryPage.wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(retryTransport.profileFactsCalls).toHaveLength(2)
    expect(retryTransport.calls.some(({ url }) => url.startsWith('/data/indicateurs_'))).toBe(false)
    expect(retryPage.wrapper.text()).toContain('API label mix_logements')
    retryPage.wrapper.unmount()
  })

  it('alimente la Carte avec le facet API sélectionné, en conservant les deux cellules de sexe et le comparateur DPE séparé', async () => {
    const age = profileSpecs.find((spec) => spec.indicator === 'structure_age')!
    const ageTransport = createTransport()
    const agePage = await mountPage(age.theme, age.indicator, ageTransport,
      'territoire=22001&niveau=commune&detail=15-24&sex=F&vue=carte')
    await flushPromises()
    const ageMap = agePage.wrapper.get('[data-testid="profile-map"]')
    const ageFacts = ageMap.attributes('data-profile-facts')
    expect(ageFacts).toContain('structure_age:22001:15-24:F:')
    expect(ageFacts).toContain('structure_age:22001:15-24:M:')
    expect(ageFacts).not.toContain('structure_age:22001:<15:')
    expect(agePage.staticFiles.some((file) => file.startsWith('indicateurs_'))).toBe(false)
    agePage.wrapper.unmount()

    const dpe = profileSpecs.find((spec) => spec.indicator === 'distribution_dpe')!
    const dpeTransport = createTransport()
    const dpePage = await mountPage(dpe.theme, dpe.indicator, dpeTransport,
      'territoire=22001&niveau=commune&vue=carte')
    await flushPromises()
    const dpeFacts = dpePage.wrapper.get('[data-testid="profile-map"]').attributes('data-profile-facts')
    expect(dpeFacts).toContain('part_passoires:22001::')
    expect(dpeFacts).not.toContain('distribution_dpe:')
    expect(dpeTransport.scalarFactsCalls.some((item) => item.resource === 'part_passoires')).toBe(true)
    dpePage.wrapper.unmount()
  })

  it('réessaie une comparaison en échec sans relire les faits API du profil', async () => {
    const spec = profileSpecs.find((candidate) => candidate.indicator === 'mix_logements')!
    const transport = createTransport({ failComparisons: 1 })
    const { wrapper } = await mountPage(spec.theme, spec.indicator, transport)
    await flushPromises()
    expect(wrapper.find('[data-testid="profile-comparison-error"]').exists()).toBe(true)
    const factsBefore = transport.profileFactsCalls.length
    const comparisonsBefore = transport.comparisonCalls.length

    await wrapper.get('[data-testid="profile-comparison-retry"]').trigger('click')
    await flushPromises()

    expect(transport.profileFactsCalls).toHaveLength(factsBefore)
    expect(transport.comparisonCalls.length).toBe(comparisonsBefore + 1)
    expect(wrapper.get('.median strong').text()).toContain('78 %')
    wrapper.unmount()
  })

  it('ignore une cohorte tardive après changement rapide de page profil', async () => {
    const transport = createTransport({ deferFirstProfile: true })
    const { wrapper, router } = await mountPage('demographie', 'structure_age', transport)
    await flushPromises()
    await router.push('/indicateurs/habitat/mix_logements?territoire=22001&niveau=commune')
    await flushPromises()
    transport.releaseDeferred()
    await flushPromises()

    expect(wrapper.text()).toContain('API label mix_logements')
    expect(transport.profileFactsCalls.map((item) => item.resource)).toContain('mix_logements')
    expect(wrapper.text()).not.toContain('API label structure_age')
    expect(transport.calls.some(({ url }) => url.startsWith('/data/indicateurs_'))).toBe(false)
    wrapper.unmount()
  })

  it('affiche le fait régional d’une page qui le déclare, sans fabriquer de pairs ni une carte régionale', async () => {
    const spec = profileSpecs.find((candidate) => candidate.indicator === 'offre_cyclable')!
    const transport = createTransport()
    const { wrapper, staticFiles } = await mountPage(spec.theme, spec.indicator, transport,
      'territoire=53&vue=carte')
    await flushPromises()

    expect(transport.profileFactsCalls).toHaveLength(1)
    expect(transport.profileFactsCalls[0]).toMatchObject({ target: {
      kind: 'territory_cohort', type: 'region', department_id: null, epci_id: null,
    } })
    expect(transport.comparisonCalls).toHaveLength(0)
    expect(wrapper.find('[data-testid="profile-regional-facts-only"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="note-contexte"]').text()).toContain('sans comparaison entre territoires')
    expect(wrapper.find('[data-testid="profile-regional-map-unavailable"]').exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'MapExplorer' }).exists()).toBe(false)
    expect(staticFiles.some((file) => file.startsWith('indicateurs_'))).toBe(false)
    wrapper.unmount()
  })
})
