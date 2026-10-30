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
const currentReadModelManifestRoutes = JSON.parse(readFileSync(join(process.cwd(), '..', 'public', 'data',
  'modeles-lecture', 'manifest.json'), 'utf8')).routes as Record<string, string[]>

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

function createTransport(options: { failComparisons?: number; failProfileFacts?: number; failCatalogues?: number;
  emptyProfileCohort?: boolean; suppressDpeSignature?: boolean; deferFirstProfile?: boolean;
  mixedProfileVintages?: boolean; incompatibleCatalogueResource?: string;
  profileCellOverrides?: Record<string, { value: number | null; status: string }> } = {}) {
  const calls: Array<{ url: string; body?: JsonRecord }> = []
  const staticFiles: string[] = []
  const profileFactsCalls: JsonRecord[] = []
  const scalarFactsCalls: JsonRecord[] = []
  const comparisonCalls: JsonRecord[] = []
  let comparisonFailures = options.failComparisons ?? 0
  let profileFailures = options.failProfileFacts ?? 0
  let catalogueFailures = options.failCatalogues ?? 0
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
      if (catalogueFailures > 0) {
        catalogueFailures -= 1
        return new Response('temporary catalogue outage', { status: 503 })
      }
      const resources = resourceDeclarations().map((resource) => resource.resource_id === options.incompatibleCatalogueResource
        ? { ...resource, theme_id: 'mobilite' } : resource)
      return new Response(JSON.stringify({ contract: 'semantic-resource-catalogue-v1', resources }), { status: 200 })
    }
    if (url === '/api/resources/read-batch') {
      const items = body?.items as JsonRecord[]
      const results = items.map((item) => {
        const resource = String(item.resource)
        const intent = item.intent as JsonRecord
        const target = item.target as JsonRecord
        if (intent.kind === 'facts' && target.kind === 'territory') {
          const spec = profileSpecs.find((candidate) => candidate.indicator === resource)!
          profileFactsCalls.push(item)
          const territory = territoiresFixture.find((candidate) => candidate.territoire === target.id && candidate.type === target.type)!
          const memberIndex = cohortMembers(target.type as TerritoireType, null, null).findIndex((candidate) => candidate.id === territory.territoire)
          const descriptor = profileDescriptor(spec)
          const observations = spec.details.flatMap((detail, detailIndex) => (spec.sexes.length ? spec.sexes : [null]).map((sex, sexIndex) => {
            const override = options.profileCellOverrides?.[`${resource}:${territory.territoire}:${detail}:${sex ?? ''}`]
            const status = override?.status ?? 'measured'
            const value = override?.value ?? 0.317 + memberIndex * 0.071 + detailIndex * 0.019 + sexIndex * 0.007
            return { detail, sex, unit: spec.units[detail]!, denominator_semantics: descriptor.denominator_semantics,
              status, value: status === 'measured' ? value : null, sources: [sourceInfo(spec.page.sources[0]!)] }
          }))
          const data: JsonRecord = { resource, target, content_version: `profile-content-${resource}-v1`,
            reference_content_version: 'reference-api-v1',
            descriptor: Object.fromEntries(Object.entries(descriptor).filter(([key]) => key !== 'completeness')),
            observations }
          return responseEnvelope(item, data)
        }
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
                  const fallbackValue = 0.317 + memberIndex * 0.071 + detailIndex * 0.019 + sexIndex * 0.007
                  const override = options.profileCellOverrides?.[`${resource}:${territory.id}:${detail}:${sex ?? ''}`]
                  const measured = override?.value ?? fallbackValue
                  const status = override?.status ?? (options.suppressDpeSignature && spec.indicator === 'distribution_dpe' && memberIndex === 0
                    ? detail === 'F' ? 'not_available' : detail === 'G' ? 'suppressed' : 'measured'
                    : 'measured')
                  const source = options.mixedProfileVintages && detailIndex % 2 === 1
                    ? { ...sourceInfo(spec.page.sources[0]!), vintage_id: `${spec.page.sources[0]}-v2025`, version: '2025', reference_date: '2025-01-01', publication_date: '2025-02-01' }
                    : options.mixedProfileVintages
                      ? { ...sourceInfo(spec.page.sources[0]!), vintage_id: `${spec.page.sources[0]}-v2023`, version: '2023', reference_date: '2023-01-01', publication_date: '2023-02-01' }
                      : sourceInfo(spec.page.sources[0]!)
                  return { detail, sex, unit: spec.units[detail]!, denominator_semantics: descriptor.denominator_semantics,
                  status, value: status === 'measured' ? measured : null,
                  sources: [source] }
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
        const matchingMembers = cohortMembers(target.type as TerritoireType,
          typeof (item.target as JsonRecord).department_id === 'string' ? (item.target as JsonRecord).department_id as string : null,
          typeof (item.target as JsonRecord).epci_id === 'string' ? (item.target as JsonRecord).epci_id as string : null)
        const memberValues = selectedMembers.map((member) => {
          if (spec.scalar) {
            const index = matchingMembers.findIndex((territory) => territory.id === member.id)
            return { id: member.id, value: index < 0 ? null : 0.623 + index * 0.023 }
          }
          const index = matchingMembers.findIndex((territory) => territory.id === member.id)
          const override = options.profileCellOverrides?.[`${resource}:${member.id}:${selectedDetail}:${selectedSex ?? ''}`]
          return { id: member.id, value: index < 0 ? null : (override?.status && override.status !== 'measured'
            ? null : override?.value ?? 0.317 + index * 0.071 + spec.details.indexOf(selectedDetail) * 0.019 +
              (selectedSex ? spec.sexes.indexOf(selectedSex) : 0) * 0.007) }
        }).filter((member): member is { id: string; value: number } => member.value !== null)
        const sortedValues = memberValues.map(({ value }) => value).sort((left, right) => left - right)
        const middle = Math.floor(sortedValues.length / 2)
        const median = sortedValues.length === 0 ? null : sortedValues.length % 2
          ? sortedValues[middle]! : (sortedValues[middle - 1]! + sortedValues[middle]!) / 2
        const focalOverride = options.profileCellOverrides?.[`${resource}:${target.id}:${selectedDetail}:${selectedSex ?? ''}`]
        const focalIndex = matchingMembers.findIndex((territory) => territory.id === target.id)
        const focalValue = spec.scalar
          ? (focalIndex < 0 ? null : 0.623 + focalIndex * 0.023)
          : (focalIndex < 0 || focalOverride?.status && focalOverride.status !== 'measured' ? null
            : focalOverride?.value ?? 0.317 + focalIndex * 0.071 + spec.details.indexOf(selectedDetail) * 0.019 +
              (selectedSex ? spec.sexes.indexOf(selectedSex) : 0) * 0.007)
        const direction = spec.scalar ? spec.page.comparison?.direction ?? spec.page.direction
          : spec.page.comparison?.direction ?? spec.page.direction
        const eligibleCount = memberValues.length
        const enough = eligibleCount >= 2
        const rank = focalValue === null || !selectedMembers.some((member) => member.id === target.id)
          ? null : 1 + memberValues.filter(({ value }) => direction === 'high' ? value > focalValue : value < focalValue).length
        const rankTies = rank === null ? null : memberValues.filter(({ value }) => value === focalValue).length
        const memberRanks = selectedMembers.map((member) => {
          const value = memberValues.find((candidate) => candidate.id === member.id)?.value
          return { territory_id: member.id,
            rank: !enough || value === undefined ? null : 1 + memberValues.filter(({ value: candidate }) => direction === 'high' ? candidate > value : candidate < value).length,
            rank_size: !enough || value === undefined ? null : eligibleCount,
            rank_ties: !enough || value === undefined ? null : memberValues.filter(({ value: candidate }) => candidate === value).length }
        })
        const result: JsonRecord = {
          indicator_id: resource, status: enough ? 'available' : 'unavailable',
          reason: enough ? null : 'fewer_than_two_comparable_values',
          source_facet: sourceFacet, unit: spec.scalar ? spec.page.comparison?.unit : selectedUnit,
          direction,
          statistic: 'median',
          profile_descriptor_version: `profile-descriptor-${resource}-v1`,
          denominator_semantics: profileDescriptor(spec).denominator_semantics,
          focal_in_selection: selectedMembers.some((member) => member.id === target.id),
          selected_member_count: selectedMembers.length, eligible_count: eligibleCount, missing_count: selectedMembers.length - eligibleCount,
          median: enough ? median : null, rank: enough ? rank : null,
          rank_size: enough && rank !== null ? eligibleCount : null,
          rank_ties: enough ? rankTies : null, member_ranks: memberRanks,
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
          content_version: null,
          profile_content_version: `profile-content-${resource}-v1`,
          reference_content_version: 'reference-api-v1',
          scalar_content_version: spec.scalar ? 'scalar-content-v1' : null,
          selection: selectedMembers.map((member) => ({ territory_type: member.type, territory_id: member.id })),
          scope: { kind: 'explicit_selection', member_count: selectedMembers.length },
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

function pageLoader(staticFiles: string[], options: { failThemeMetadata?: number; invalidThemeMetadata?: number } = {}) {
  let metadataFailures = options.failThemeMetadata ?? 0
  let invalidMetadata = options.invalidThemeMetadata ?? 0
  const charger: ChargerFichier = async (file) => {
    if (file === 'territoires') return territoiresFixture
    if (file === 'territoires-metadata') return null
    staticFiles.push(file)
    if (file.startsWith('indicateurs_')) throw new Error(`static profile numerics were requested: ${file}`)
    if (file.startsWith('theme_')) {
      if (metadataFailures > 0) {
        metadataFailures -= 1
        throw new Error('temporary theme metadata outage')
      }
      const metadata = metadataByTheme[file.slice('theme_'.length)]
      if (invalidMetadata > 0) {
        invalidMetadata -= 1
        return { ...metadata, theme: 'wrong-theme' }
      }
      return metadata
    }
    throw new Error(`unexpected file ${file}`)
  }
  return charger
}

async function mountPage(theme: string, indicator: string, transport: ReturnType<typeof createTransport>, query = 'territoire=22001&niveau=commune',
  options: { manifestRoutes?: Record<string, string[]>; failThemeMetadata?: number; invalidThemeMetadata?: number } = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(`/indicateurs/${theme}/${indicator}?${query}`)
  await router.isReady()
  const empty = { type: 'FeatureCollection' as const, features: [] }
  const staticFiles: string[] = []
  vi.stubGlobal('fetch', transport.fetcher)
  const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
     [PAYLOAD_CHARGER_KEY]: pageLoader(staticFiles, options),
     [INDICATOR_READ_MODEL_MANIFEST_CHARGER_KEY]: async () => ({ schemaVersion: '1' as const, routes: options.manifestRoutes ?? {} }),
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
          expect(wrapper.get('.median strong').text()).toContain('42 %')
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
    expect(wrapper.get('.median strong').text()).toContain('0,44 km / 1 000 hab')
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
    expect(wrapper.get('.median strong').text()).toContain('42 %')
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

  it('découvre le profil avant le manifeste courant si famille et marqueur éditoriaux manquent', async () => {
    const spec = profileSpecs.find((candidate) => candidate.indicator === 'mix_logements')!
    const saved = spec.metadata.profile_contracts
    const savedPage = spec.metadata.indicator_pages?.[spec.indicator]
    delete spec.metadata.profile_contracts
    delete spec.metadata.indicator_pages?.[spec.indicator]
    const transport = createTransport()
    try {
      const mounted = await mountPage(spec.theme, spec.indicator, transport,
        'territoire=22001&niveau=commune', { manifestRoutes: currentReadModelManifestRoutes })
      await flushPromises()
      expect(transport.calls.some(({ url }) => url === '/api/resources')).toBe(true)
      expect(transport.profileFactsCalls).toHaveLength(0)
      expect(mounted.wrapper.find('[role="alert"]').exists()).toBe(true)
      expect(mounted.wrapper.find('[role="alert"] button').text()).toContain('Réessayer')
      expect(mounted.staticFiles.some((file) => file.startsWith('indicateurs_'))).toBe(false)
      expect(transport.calls.some(({ url }) => url.startsWith('/data/indicateurs_'))).toBe(false)
      expect(transport.calls.some(({ url }) => url.includes('modeles-lecture/indicateurs'))).toBe(false)
      mounted.wrapper.unmount()
    } finally {
      spec.metadata.profile_contracts = saved
      if (savedPage) spec.metadata.indicator_pages![spec.indicator] = savedPage
    }
  })

  it('refuse une déclaration de profil dont le thème API ne correspond pas à la route', async () => {
    const spec = profileSpecs.find((candidate) => candidate.indicator === 'mix_logements')!
    const transport = createTransport({ incompatibleCatalogueResource: spec.indicator })
    const mounted = await mountPage(spec.theme, spec.indicator, transport,
      'territoire=22001&niveau=commune')
    await flushPromises()
    expect(transport.calls.some(({ url }) => url === '/api/resources')).toBe(true)
    expect(transport.profileFactsCalls).toHaveLength(0)
    expect(mounted.wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(mounted.wrapper.find('[role="alert"] button').text()).toContain('Réessayer')
    expect(transport.staticFiles.some((file) => file.startsWith('indicateurs_'))).toBe(false)
    expect(transport.calls.some(({ url }) => url.startsWith('/data/indicateurs_'))).toBe(false)
    mounted.wrapper.unmount()
  })

  it('réessaie la découverte du catalogue et les échecs transport/validation des métadonnées via le bouton réel', async () => {
    const spec = profileSpecs.find((candidate) => candidate.indicator === 'mix_logements')!
    const catalogue = createTransport({ failCatalogues: 1 })
    const cataloguePage = await mountPage(spec.theme, spec.indicator, catalogue)
    await flushPromises()
    expect(cataloguePage.wrapper.find('[role="alert"] button').exists()).toBe(true)
    expect(catalogue.calls.filter(({ url }) => url === '/api/resources')).toHaveLength(1)
    await cataloguePage.wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(catalogue.calls.filter(({ url }) => url === '/api/resources')).toHaveLength(2)
    expect(catalogue.profileFactsCalls).toHaveLength(1)
    expect(cataloguePage.staticFiles.some((file) => file.startsWith('indicateurs_'))).toBe(false)
    cataloguePage.wrapper.unmount()

    for (const failure of ['transport', 'validation'] as const) {
      const transport = createTransport()
      const metadataPage = await mountPage(spec.theme, spec.indicator, transport, undefined,
        failure === 'transport' ? { failThemeMetadata: 1 } : { invalidThemeMetadata: 1 })
      await flushPromises()
      expect(metadataPage.wrapper.find('[role="alert"] button').exists(), failure).toBe(true)
      expect(metadataPage.staticFiles.some((file) => file.startsWith('indicateurs_'))).toBe(false)
      await metadataPage.wrapper.get('[role="alert"] button').trigger('click')
      await flushPromises()
      expect(transport.profileFactsCalls, failure).toHaveLength(1)
      expect(metadataPage.staticFiles.some((file) => file.startsWith('indicateurs_'))).toBe(false)
      metadataPage.wrapper.unmount()
    }
  })

  it('conserve le territoire focal hors cohort sans altérer les filtres de comparaison', async () => {
    const spec = profileSpecs.find((candidate) => candidate.indicator === 'mix_logements')!
    const transport = createTransport()
    const { wrapper } = await mountPage(spec.theme, spec.indicator, transport,
      'territoire=29001&niveau=commune&departement=22')
    await flushPromises()

    expect(transport.profileFactsCalls[0]?.target).toMatchObject({
      kind: 'territory_cohort', type: 'commune', department_id: '22', epci_id: null,
    })
    expect(transport.profileFactsCalls.some((item) => {
      const target = item.target as JsonRecord
      return target.kind === 'territory' && target.id === '29001'
    })).toBe(true)
    const comparisonCall = transport.comparisonCalls.at(-1)
    expect(comparisonCall?.target).toMatchObject({ kind: 'territory', id: '29001' })
    expect(comparisonCall?.intent).toMatchObject({ kind: 'selected_comparison', members: [
      { type: 'commune', id: '22001' }, { type: 'commune', id: '22002' },
    ] })
    expect((comparisonCall?.target as JsonRecord).id).not.toBe((transport.profileFactsCalls[0]?.target as JsonRecord).id)
    expect(transport.calls.some(({ url }) => url.startsWith('/data/indicateurs_'))).toBe(false)
    wrapper.unmount()
  })

  it('affiche les rangs des pairs du cohort API, avec ex-aequo, tri et absence selon la facette', async () => {
    const spec = profileSpecs.find((candidate) => candidate.indicator === 'mix_logements')!
    const detail = spec.page.comparison?.detail ?? spec.details[0]!
    const transport = createTransport({ profileCellOverrides: {
      [`mix_logements:22001:${detail}:`]: { value: 0.42, status: 'measured' },
      [`mix_logements:22002:${detail}:`]: { value: 0.31, status: 'measured' },
      [`mix_logements:29001:${detail}:`]: { value: 0.31, status: 'measured' },
      [`mix_logements:29002:${detail}:`]: { value: 0.58, status: 'measured' },
    } })
    const { wrapper } = await mountPage(spec.theme, spec.indicator, transport)
    await flushPromises()

    const ranks = () => wrapper.findAll('.comparison-table-scroll tbody tr').map((row) => row.findAll('td')[2]?.text().trim())
    expect(ranks()).toEqual(['2e / 4', '3e / 4', '1er / 4', '3e / 4'])
    expect(wrapper.get('.median strong').text()).toContain('37 %')
    await wrapper.get('.comparison-table-scroll thead button').trigger('click')
    await wrapper.get('.comparison-table-scroll thead button').trigger('click')
    await wrapper.findAll('.comparison-table-scroll thead button')[2]!.trigger('click')
    await flushPromises()
    expect(ranks()).toEqual(['1er / 4', '2e / 4', '3e / 4', '3e / 4'])
    const sortedNames = wrapper.findAll('.comparison-table-scroll tbody tr')
      .map((row) => row.findAll('td')[0]?.text().trim())
    expect(sortedNames.slice(0, 2)).toEqual(['Commune C', 'Commune A1'])
    expect(new Set(sortedNames.slice(2))).toEqual(new Set(['Commune B', 'Commune D']))
    const search = wrapper.findAll('label').find((label) => label.text().startsWith('Rechercher'))!.get('input')
    await search.setValue('Commune B')
    await flushPromises()
    expect(wrapper.findAll('.comparison-table-scroll tbody tr')).toHaveLength(1)
    expect(ranks()).toEqual(['3e / 4'])
    await search.setValue('')
    await flushPromises()
    expect(wrapper.findAll('.comparison-table-scroll tbody tr')).toHaveLength(4)
    wrapper.unmount()

    const missing = createTransport({ profileCellOverrides: {
      [`mix_logements:22002:${detail}:`]: { value: null, status: 'not_available' },
    } })
    const missingPage = await mountPage(spec.theme, spec.indicator, missing)
    await flushPromises()
    expect(missingPage.wrapper.findAll('.comparison-table-scroll tbody tr')).toHaveLength(3)
    expect(missingPage.wrapper.findAll('.comparison-table-scroll tbody tr').every((row) =>
      row.findAll('td')[2]?.text().trim().length > 0)).toBe(true)
    expect(missing.comparisonCalls.at(-1)?.intent).toMatchObject({ kind: 'selected_comparison', members: [
      { type: 'commune', id: '22001' }, { type: 'commune', id: '22002' },
      { type: 'commune', id: '29001' }, { type: 'commune', id: '29002' },
    ] })
    missingPage.wrapper.unmount()
  })

  it('présente honnêtement plusieurs millésimes de cellules sans choisir la première comme fraîcheur', async () => {
    const spec = profileSpecs.find((candidate) => candidate.indicator === 'mix_logements')!
    const transport = createTransport({ mixedProfileVintages: true })
    const { wrapper } = await mountPage(spec.theme, spec.indicator, transport,
      'territoire=22001&niveau=commune&vue=indicateur')
    await flushPromises()

    expect(wrapper.text()).toContain('Millésime : Plusieurs millésimes')
    expect(wrapper.text()).toContain(`${spec.page.sources[0]}-v2023`)
    expect(wrapper.text()).toContain(`${spec.page.sources[0]}-v2025`)
    expect(wrapper.text()).toContain('2023-01-01')
    expect(wrapper.text()).toContain('2025-01-01')
    expect(wrapper.text()).not.toContain('Fraîcheur : 2023-02-01')
    wrapper.unmount()
  })
})
