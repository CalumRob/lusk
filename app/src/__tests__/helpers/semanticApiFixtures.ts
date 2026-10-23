import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type Resource = {
  resource_id: string
  theme_id: string
  resource_kind: string
  indicator_id: string
  label: string
  unit: string
  direction: string
  sources: string[]
  allowed_levels: string[]
  target_kinds: string[]
  target_ids: string[]
  axes?: string[]
  axis_values?: Array<[string, string[]]>
  fields: string[]
  shapes: string[]
  intents: string[]
}

type Vintage = { id: string; source: string; version: string; date_reference: string | null; date_publication: string | null }

// Ask the API's producer-derived discovery code for the real public catalogue.
// This is database-free and deliberately avoids a second copied resource registry.
const catalogue = JSON.parse(execFileSync('python', ['-c',
  'from api.resource_catalogue import default_resource_catalogue; import json; print(json.dumps(default_resource_catalogue().discovery_payload()))',
], { cwd: resolve(process.cwd(), '..'), encoding: 'utf8' })) as {
  contract: string
  resources: Resource[]
}
const aedarMeasureKeys = JSON.parse(execFileSync('python', ['-c',
  'from api.aedar_models import AEDAR_MEASURE_KEYS; import json; print(json.dumps(sorted(AEDAR_MEASURE_KEYS)))',
], { cwd: resolve(process.cwd(), '..'), encoding: 'utf8' })) as string[]
const aedarSemanticContract = JSON.parse(readFileSync(resolve(process.cwd(),
  '../pipeline/inst/extdata/semantic-resource-contracts.json'), 'utf8'))
const aedarProducerSource = readFileSync(resolve(process.cwd(), '../pipeline/R/aedar_aggregates.R'), 'utf8')
const aedarSourceField = (pattern: RegExp, field: string) => {
  const value = aedarProducerSource.match(pattern)?.[1]
  if (!value) throw new Error(`Current AEDAR producer source contract omits ${field}`)
  return value
}
const aedarFixtureSource = {
  source_id: aedarSemanticContract.resources.find((resource: Record<string, any>) =>
    resource.resource_id === 'aedar_territorial_aggregate')?.source_id,
  name: aedarSourceField(/name="([^"]+)"/, 'name'),
  vintage_id: aedarSourceField(/AEDAR_AGGREGATE_VINTAGE\s*<-\s*"([^"]+)"/, 'vintage'),
  source_url: aedarSourceField(/url="(https?:\/\/[^\"]+)"/, 'URL'),
  licence: aedarSourceField(/licence="([^"]+)"/, 'licence'),
  attribution: aedarSourceField(/attribution="([^"]+)"/, 'attribution'),
  reference_date: null,
  publication_date: aedarSourceField(/published_on\s*=\s*rep\("(\d{4}-\d{2}-\d{2})"/, 'publication date'),
}
if (!aedarFixtureSource.source_id) throw new Error('Current AEDAR semantic resource omits its source identity')

export function nativeCatalogueResponse(): Response {
  return new Response(JSON.stringify(catalogue), { status: 200 })
}

/** The declarations are loaded from the same producer catalogue served by the API. */
export function nativeResources(theme?: string): Resource[] {
  return catalogue.resources.filter((resource) => theme === undefined || resource.theme_id === theme)
}

const territories = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/territoires.json'), 'utf8')) as Array<Record<string, any>>
const vintages = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/vintages.json'), 'utf8')) as Vintage[]
const mobiliteProducer = JSON.parse(readFileSync(resolve(process.cwd(),
  '../pipeline/inst/extdata/theme-metadata/theme_mobilite.json'), 'utf8'))
const raccordementRoute = mobiliteProducer.owned_series_routes.raccordement_courbe
const raccordementPage = mobiliteProducer.indicator_pages.raccordement_courbe
const raccordementAxisKeys = raccordementPage.comparison.details as string[]
const raccordementAxisNumericValues = raccordementRoute.axis_values.map(Number) as number[]
const raccordementScalarMinute = mobiliteProducer.source_records[raccordementRoute.source_id]
  .methodology.factors.find((factor: Record<string, any>) => factor.key === 'scalar_minute')?.value
const raccordementMeasureSource = readFileSync(resolve(process.cwd(),
  '../pipeline/R/artefact_raccordement_national.R'), 'utf8')
const raccordementMeasureDate = raccordementMeasureSource.match(/date_mesure\s*=\s*"(\d{4}-\d{2}-\d{2})"/)?.[1]
if (!raccordementMeasureDate || !raccordementAxisNumericValues.includes(raccordementScalarMinute) ||
    raccordementAxisKeys.length !== raccordementAxisNumericValues.length ||
    raccordementAxisKeys.some((axis, index) => Number(axis.slice(1)) !== raccordementAxisNumericValues[index])) {
  throw new Error('Current Mobility producer curve declaration is incomplete or inconsistent')
}
const raccordementFixtureNotice = {
  kind: 'synthetic_test_fixture',
  publication_parity: false,
  notice: 'Synthetic test-only observations; not real production data or publication parity.',
} as const
const observedMilieuxCohortFixtureIds = new Set(['22001', '35238'])
let raccordementFixtureProvenanceCache: Record<string, any> | null = null
let milieuxAbsenceSnapshotHash: string | null = null
const publishedModels = new Map<string, Record<string, any>>()
const publishedReadings = new Map<string, Record<string, any> | null>()
const producerMetadata = new Map<string, Record<string, any>>()

function metadataFor(theme: string): Record<string, any> {
  let metadata = producerMetadata.get(theme)
  if (!metadata) {
    const loaded: Record<string, any> = JSON.parse(readFileSync(resolve(process.cwd(),
      `../pipeline/inst/extdata/theme-metadata/theme_${theme}.json`), 'utf8'))
    producerMetadata.set(theme, loaded)
    metadata = loaded
  }
  return metadata
}

function sourceFor(resource: Resource, fact?: Record<string, any>, target?: Record<string, any>, ownedSeries = false) {
  if (['raccordement_tc', 'raccordement_courbe', 'raccordement_reference'].includes(resource.resource_id)) {
    const record = mobiliteProducer.source_records[raccordementRoute.source_id]
    const clock = record.vintages.find((entry: Record<string, any>) => entry.id === raccordementRoute.source_id)
    if (!clock) throw new Error('Current Mobility producer source clock is missing')
    return { source_id: raccordementRoute.source_id, name: record.publisher ?? record.dataset,
      vintage_id: ownedSeries ? clock.version : `${clock.version}/${clock.dateReference ?? 'NA'}`,
      version: String(clock.version), reference_date: clock.dateReference ?? null,
      publication_date: clock.datePublication ?? null }
  }
  const metadata = metadataFor(resource.theme_id)
  const sourceKeys = resource.shapes.includes('typed_reading') ? resource.sources.slice(0, 1) : resource.sources
  const declared = sourceKeys.flatMap((key) => {
    const record = metadata.source_records?.[key]
    const records = Array.isArray(record?.vintages) ? record.vintages : []
    const ids = records.length ? records.map((clock: Record<string, any>) => clock.id) : [key]
    const publicClocks = vintages.filter((vintage) => ids.includes(vintage.id))
    const metadataClocks = records.filter((clock: Record<string, any>) =>
      !publicClocks.some((vintage) => vintage.id === clock.id)).map((clock: Record<string, any>) => ({
      id: clock.id, source: record.publisher ?? record.dataset, version: String(clock.version),
      date_reference: clock.dateReference ?? null, date_publication: clock.datePublication ?? null,
    }))
    return [...publicClocks, ...metadataClocks]
  })
  const matchesFact = (vintage: Vintage) =>
    (typeof fact?.vintage_version !== 'string' || vintage.version === fact.vintage_version) &&
    (typeof fact?.vintage_date_reference !== 'string' || vintage.date_reference === fact.vintage_date_reference) &&
    (typeof fact?.vintage_date_publication !== 'string' || vintage.date_publication === fact.vintage_date_publication) &&
    (typeof fact?.vintage_source !== 'string' || vintage.source === fact.vintage_source)
  let candidates = declared.filter(matchesFact)
  if (candidates.length > 1 && target?.type === 'commune') {
    const territory = territories.find((item) => item.type === target.type && item.territoire === target.id)
    const department = territory?.departement
    const local = candidates.filter((vintage) => vintage.id.endsWith(`_${department}`) ||
      vintage.id.endsWith(`dep${department}`))
    if (local.length) candidates = local
  }
  if (candidates.length !== 1) {
    throw new Error(`No unique producer vintage for ${resource.resource_id} (${candidates.length} matches)`)
  }
  const vintage = candidates[0]!
  const version = fact?.vintage_version ?? vintage.version
  const referenceDate = fact && 'vintage_date_reference' in fact ? fact.vintage_date_reference : vintage.date_reference
  const publicationDate = fact && 'vintage_date_publication' in fact ? fact.vintage_date_publication : vintage.date_publication
  const vintageId = ownedSeries && ['prix_m2', 'subventions_annuelles', 'raccordement_courbe'].includes(resource.resource_id)
    ? version : `${version}/${referenceDate ?? 'NA'}`
  return { source_id: vintage.id, name: fact?.vintage_source ?? vintage.source,
    vintage_id: vintageId, version, reference_date: referenceDate, publication_date: publicationDate }
}

function publicationFor(resource: Resource): string {
  const dataset = resource.resource_id === 'raccordement_courbe' || resource.resource_id === 'raccordement_reference'
    ? raccordementRoute.dataset_id : resource.resource_id
  return `${dataset}-fixture-publication-v1`
}

function scalarFacetDescriptor(resource: Resource, descriptorVersion: string): Record<string, any> {
  const metadata = metadataFor(resource.theme_id)
  const contract = metadata.scalar_contracts?.[resource.resource_id]
  const page = metadata.indicator_pages?.[resource.resource_id]
  if (!contract || !page) throw new Error(`Missing producer scalar-facet declaration: ${resource.resource_id}`)
  return { indicator_id: resource.indicator_id, theme_id: resource.theme_id, label: page.label,
    unit: page.unit, direction: page.direction, comparison_facet: contract.comparison_facet,
    allowed_levels: contract.allowed_levels ?? page.levels,
    denominator_semantics: contract.denominator_semantics ?? null,
    completeness: contract.completeness, descriptor_version: descriptorVersion }
}

function scalarFacetVersions(resource: Resource, version: string, referenceVersion: string) {
  return { content_version: `${version}-scalar-facet-v1`, reference_content_version: referenceVersion,
    descriptor_version: `${resource.resource_id}-scalar-descriptor-fixture-v1` }
}

/** These fixed curves exercise the native contract only; they are not producer observations. */
function syntheticRaccordementValue(type: string, id: string, minute: number): number {
  return type === 'commune' && id === '22001' ? minute / 720 : 0.2 + minute / 1200
}

function syntheticRaccordementReferenceValue(minute: number): number {
  // Independently worked mean of the fixed 22001 and peer curves above.
  return (syntheticRaccordementValue('commune', '22001', minute) +
    syntheticRaccordementValue('commune', '35238', minute)) / 2
}

function raccordementFixtureProvenance(resource: Resource): Record<string, any> {
  if (raccordementFixtureProvenanceCache) return raccordementFixtureProvenanceCache
  const source = sourceFor(resource, undefined, undefined, true)
  const fixtureRows = ['22001', '35238'].map((id) => ['commune', id,
    ...raccordementAxisNumericValues.map((minute) =>
      syntheticRaccordementValue('commune', id, minute))])
  const revisionHash = createHash('sha256').update(JSON.stringify({
    fixture: raccordementFixtureNotice,
    source: { source_id: source.source_id, version: source.version,
      reference_date: source.reference_date, publication_date: source.publication_date },
    observation_period: raccordementMeasureDate,
    axes: raccordementAxisKeys,
    observations: fixtureRows,
    named_reference: raccordementAxisNumericValues.map(syntheticRaccordementReferenceValue),
  })).digest('hex')
  raccordementFixtureProvenanceCache = { revision_id: `synthetic-test-${revisionHash.slice(0, 16)}`,
    source_id: source.source_id, vintage_id: source.vintage_id, source_name: source.name,
    dataset_name: raccordementRoute.dataset_id, version: source.version,
    reference_date: source.reference_date, publication_date: source.publication_date,
    revision_hash: revisionHash }
  return raccordementFixtureProvenanceCache
}

function syntheticRaccordementPoints(type: string, id: string,
  provenance: Record<string, any>): Record<string, any>[] {
  return raccordementAxisKeys.map((axis, index) => ({ axis,
    observation_period: raccordementMeasureDate,
    value: syntheticRaccordementValue(type, id, raccordementAxisNumericValues[index]!),
    status: 'measured', missing_reason: null, provenance: [provenance] }))
}

function syntheticRaccordementReference(resource: Resource, version: string, referenceVersion: string) {
  const provenance = raccordementFixtureProvenance(resource)
  const reference = raccordementRoute.reference
  const points = raccordementAxisKeys.map((axis, index) => ({ axis,
    observation_period: raccordementMeasureDate,
    value: syntheticRaccordementReferenceValue(raccordementAxisNumericValues[index]!),
    status: 'measured', missing_reason: null, provenance: [provenance] }))
  return { dataset_id: raccordementRoute.dataset_id, publication_id: version,
    content_version: version, reference_content_version: referenceVersion,
    indicator_id: resource.indicator_id, theme_id: resource.theme_id,
    reference: { ...reference, required: true }, axis_kind: raccordementRoute.axis_kind,
    axis_values: raccordementAxisKeys, unit: resource.unit,
    observation_period_kind: raccordementRoute.observation_period_contract.kind,
    points, availability: 'complete', synthetic_fixture: raccordementFixtureNotice }
}

function syntheticRaccordementSeries(item: Record<string, any>, resource: Resource,
  version: string, referenceVersion: string, descriptorVersion: string): Record<string, any> {
  const target = item.target as { type: string; id: string }
  const provenance = raccordementFixtureProvenance(resource)
  const reference = syntheticRaccordementReference(resource, version, referenceVersion)
  return { indicator_id: resource.indicator_id, theme_id: resource.theme_id,
    dataset_id: raccordementRoute.dataset_id, publication_id: version,
    content_version: version, reference_content_version: referenceVersion,
    territory: { id: target.id, type: target.type,
      name: territories.find((territory) => territory.type === target.type && territory.territoire === target.id)?.nom },
    descriptor_version: descriptorVersion, axis_kind: raccordementRoute.axis_kind,
    axis_values: raccordementAxisKeys, axis_numeric_values: raccordementAxisNumericValues,
    completeness: 'dense_complete', label: resource.label, unit: resource.unit,
    direction: resource.direction, comparison_point: raccordementPage.comparison.detail,
    observation_period_kind: raccordementRoute.observation_period_contract.kind,
    comparison_contract: raccordementRoute.comparison_contract,
    points: syntheticRaccordementPoints(target.type, target.id, provenance),
    scope_series: [], context: null,
    named_references: [{ ...reference.reference, unit: resource.unit,
      observation_period_kind: reference.observation_period_kind, points: reference.points }],
    availability: 'complete', synthetic_fixture: raccordementFixtureNotice }
}

function syntheticRaccordementScalar(item: Record<string, any>, resource: Resource,
  version: string, referenceVersion: string, descriptorVersion: string): Record<string, any> {
  const target = item.target as { type: string; id: string }
  const source = sourceFor(resource, undefined, target)
  const value = syntheticRaccordementValue(target.type, target.id, raccordementScalarMinute)
  return { indicator_id: resource.indicator_id, territory_id: target.id, territory_type: target.type,
    label: resource.label, unit: resource.unit, direction: resource.direction,
    content_version: version, reference_content_version: referenceVersion,
    descriptor_version: descriptorVersion, value, status: 'measured',
    sources: [{ source_id: source.source_id, name: source.name, vintage_id: source.vintage_id,
      version: source.version, reference_date: source.reference_date,
      publication_date: source.publication_date }],
    synthetic_fixture: raccordementFixtureNotice }
}

function syntheticRaccordementComparison(item: Record<string, any>, resource: Resource,
  version: string, referenceVersion: string, descriptorVersion: string): Record<string, any> {
  const target = item.target as { type: string; id: string }
  const focal = territories.find((territory) => territory.type === target.type && territory.territoire === target.id)
  const selected = item.intent.kind === 'selected_comparison'
    ? item.intent.members.map((member: { type: string; id: string }) => ({
      territory_type: member.type, territory_id: member.id,
    })) : null
  const cohort = selected ?? (target.type === 'commune'
    ? territories.filter((territory) => territory.type === 'commune' &&
      territory.classe_densite_code === focal?.classe_densite_code)
    : territories.filter((territory) => territory.type === target.type))
  const scope = selected
    ? { kind: 'explicit_selection', member_count: cohort.length }
    : { kind: target.type === 'commune' ? 'density_class' : 'same_level',
      territory_type: target.type, density_class_code: focal?.classe_densite_code ?? null,
      member_count: cohort.length }
  const curves = cohort.map((member: { territory_type?: string; territory_id?: string; type?: string; territoire?: string }) => {
    const type = member.territory_type ?? member.type!
    const id = member.territory_id ?? member.territoire!
    return raccordementAxisNumericValues.map((minute) => syntheticRaccordementValue(type, id, minute))
  })
  const meanPoints = raccordementAxisKeys.map((axis, index) => ({ axis,
    value: cohort.length ? curves.reduce((sum: number, curve: number[]) => sum + curve[index]!, 0) / cohort.length : null,
    status: cohort.length >= 2 ? 'measured' : 'unavailable' }))
  const comparisonPointIndex = raccordementAxisKeys.indexOf(raccordementPage.comparison.detail)
  const focalValue = syntheticRaccordementValue(target.type, target.id,
    raccordementAxisNumericValues[comparisonPointIndex]!)
  const focalIsSelected = cohort.some((member: { territory_type?: string; territory_id?: string; type?: string; territoire?: string }) =>
    (member.territory_type ?? member.type) === target.type &&
    (member.territory_id ?? member.territoire) === target.id)
  const selectedValues = curves.map((curve: number[]) => curve[comparisonPointIndex]!)
  const available = cohort.length >= 2
  const provenance = raccordementFixtureProvenance(resource)
  const result = { indicator_id: resource.indicator_id, theme_id: resource.theme_id,
    label: resource.label, unit: resource.unit, direction: resource.direction,
    descriptor_version: descriptorVersion, source_facet: raccordementPage.comparison.detail,
    statistic: raccordementRoute.comparison_contract.statistic,
    status: available ? 'available' : 'unavailable',
    reason: available ? null : 'fewer_than_two_comparable_values',
    selected_member_count: cohort.length, eligible_count: cohort.length,
    missing_count: 0, rank: available && focalIsSelected
      ? 1 + selectedValues.filter((value: number) => value > focalValue).length : null,
    rank_size: available && focalIsSelected ? cohort.length : null,
    comparison_sources: cohort.length ? [{ ...provenance, source_name: provenance.source_name }] : [],
    owned_content_version: version,
    mean: available ? meanPoints[comparisonPointIndex]!.value : null,
    mean_curve: available ? { statistic: raccordementRoute.comparison_contract.statistic,
      axis_kind: raccordementRoute.axis_kind, points: meanPoints,
      selected_member_count: cohort.length, eligible_count: cohort.length,
      model_zero_reason_counts: {}, scope } : null }
  return { contract: 'indicator-comparison-v1', complete_theme: false,
    indicator_id: resource.indicator_id, theme_id: resource.theme_id, shape: 'series',
    content_version: version, reference_content_version: referenceVersion,
    selection: selected, scope, result, synthetic_fixture: raccordementFixtureNotice }
}

function publishedReading(resource: Resource, target: Record<string, any>): Record<string, any> | undefined {
  if (target.kind !== 'territory' || typeof target.type !== 'string' || typeof target.id !== 'string') return undefined
  const key = `${resource.resource_id}/${target.type}/${target.id}`
  if (publishedReadings.has(key)) return publishedReadings.get(key) ?? undefined
  try {
    const path = resolve(process.cwd(), `../public/data/modeles-lecture/territoires/${target.type}/${target.id}.json`)
    const model = JSON.parse(readFileSync(path, 'utf8'))
    const group = resource.axis_values?.find(([axis]) => axis === 'groupe')?.[1]?.[0]
    const reading = model.themes?.[resource.theme_id]?.histoires?.find((fact: Record<string, any>) => fact.groupe === group)
    publishedReadings.set(key, reading ?? null)
    return reading
  } catch {
    publishedReadings.set(key, null)
    return undefined
  }
}

function publishedIndicators(resource: Resource, target: Record<string, any>): Record<string, any>[] {
  if (target.kind !== 'territory' || typeof target.type !== 'string' || typeof target.id !== 'string') return []
  const key = `${target.type}/${target.id}`
  let model = publishedModels.get(key)
  if (!model) {
    try {
      const loaded: Record<string, any> = JSON.parse(readFileSync(resolve(process.cwd(),
        `../public/data/modeles-lecture/territoires/${key}.json`), 'utf8'))
      publishedModels.set(key, loaded)
      model = loaded
    } catch {
      return []
    }
  }
  return model.themes?.[resource.theme_id]?.indicateurs?.filter((fact: Record<string, any>) =>
    fact.key === resource.resource_id) ?? []
}

function readingFixture(resource: Resource, target: Record<string, any>): Record<string, any>[] {
  const themeMetadata = metadataFor(resource.theme_id)
  const group = resource.axis_values?.find(([axis]) => axis === 'groupe')?.[1]?.[0]
  const published = publishedReading(resource, target)
  const source = sourceFor(resource, published, target)
  const storyKey = published?.story_key ?? themeMetadata.subgroups?.find((item: Record<string, any>) =>
    item.key === group)?.reading?.story_key ?? themeMetadata.story_keys?.[0]
  const common = { groupe: group, story_key: storyKey, salience_reason: published?.salience_reason ?? 'defaut',
    status: 'measured', source_id: source.source_id, vintage_id: source.vintage_id, source }
  if (resource.resource_id === 'habitat_selected_reading') return published ? [{ ...common,
    classification: published.classification,
    part_passoires: published.part_passoires,
    part_abc: published.part_abc,
    n_dpe: published.n_dpe }] : []
  if (resource.resource_id === 'milieux_selected_reading') return published ? [{ ...common,
    periode_pop: published.periode_pop, periode_artif: published.periode_artif,
    delta_population: published.delta_population, taux_variation_population: published.taux_variation_population,
    artif_m2_par_habitant: published.artif_m2_par_habitant,
    artif_m3_par_habitant: published.artif_m3_par_habitant,
    trajectoire_artif_par_habitant: published.trajectoire_artif_par_habitant,
    classification: published.classification }] : []
  if (resource.resource_id === 'economie_selected_reading') return published ? [{ ...common }] : []
  if (resource.resource_id === 'demographie_selected_reading') return published ? [{ ...common,
    periode: published.periode, solde_naturel: published.solde_naturel,
    solde_migratoire: published.solde_migratoire,
    taux_solde_naturel: published.taux_solde_naturel,
    taux_solde_migratoire: published.taux_solde_migratoire,
    classification: published.classification }] : []
  return []
}

function syntheticMilieuxSourceAbsence(resource: Resource, territoryId: string): Record<string, any> {
  const metadata = metadataFor(resource.theme_id)
  const sourceKey = metadata.sources.conso_enaf_annuel
  const absenceResource = { ...resource, sources: [sourceKey], shapes: [] } as Resource
  const source = sourceFor(absenceResource)
  if (!milieuxAbsenceSnapshotHash) {
    milieuxAbsenceSnapshotHash = createHash('sha256').update(JSON.stringify({
      fixture: raccordementFixtureNotice,
      source: { source_id: source.source_id, vintage_id: source.vintage_id,
        reference_date: source.reference_date, publication_date: source.publication_date },
      // This is a synthetic source snapshot whose coverage rule says the two
      // named communes are present and all other commune members are absent.
      // Hash the compact declaration once; this is not a digest of production data.
      source_present_communes: [...observedMilieuxCohortFixtureIds].sort(),
      other_commune_members: 'source_record_absent',
    })).digest('hex')
  }
  return { territory_id: territoryId, territory_type: 'commune', reason: 'source_record_absent',
    source_id: source.source_id, vintage_id: source.vintage_id,
    source_snapshot_sha256: milieuxAbsenceSnapshotHash,
    source: { source_id: source.source_id, name: source.name, vintage_id: source.vintage_id,
      version: source.version, reference_date: source.reference_date,
      publication_date: source.publication_date } }
}

function syntheticMilieuxSourceBindings(target: Record<string, any>,
  reading: Record<string, any>): Record<string, any>[] {
  const population = reading.source as Record<string, any>
  const populationRevision = createHash('sha256').update(JSON.stringify({
    fixture: raccordementFixtureNotice, source: population, territory: target.id,
    observation_period: reading.periode_pop,
  })).digest('hex')
  const bindings: Record<string, any>[] = [{
    territory_id: target.id, territory_type: target.type, groupe: reading.groupe, field_key: 'population',
    source_id: population.source_id, vintage_id: population.vintage_id,
    source_name: population.name, source_version: population.version,
    reference_date: population.reference_date, publication_date: population.publication_date,
    observation_period: reading.periode_pop, dataset_id: null, dataset_content_version: null,
    state_role: null, axis_value: null, provenance_revision_id: null,
    population_revision_id: `synthetic-test-${populationRevision.slice(0, 16)}`,
    source: population,
  }]
  const stateResource = nativeResources('milieux').find((candidate) => candidate.resource_id === 'artif_par_habitant')
  if (!stateResource) return bindings
  const stateRows = publishedIndicators(stateResource, target).filter((fact) => fact.value !== null)
    .sort((left, right) => Number(left.vintage_version) - Number(right.vintage_version))
  const metadata = metadataFor('milieux')
  const stateDataset = metadata.indicator_pages.artif_par_habitant.series_dataset_id
  stateRows.slice(0, 2).forEach((fact, index) => {
    // The owner publishes exactly two role bindings (M2 then M3). The static
    // presentation rows carry the producer-owned source clock and observation.
    const clockFact = { ...fact }
    delete clockFact.vintage_source
    const resolved = sourceFor(stateResource, clockFact, target)
    const source = { ...resolved, name: fact.vintage_source ?? resolved.name }
    const role = index === 0 ? 'M2' : 'M3'
    const fieldKey = role === 'M2' ? 'artif_m2_par_habitant' : 'artif_m3_par_habitant'
    const revisionHash = createHash('sha256').update(JSON.stringify({
      fixture: raccordementFixtureNotice, source, territory: target.id,
      state_role: role, axis_value: fact.detail, observation_period: fact.dimension ?? fact.detail,
    })).digest('hex')
    bindings.push({ territory_id: target.id, territory_type: target.type, groupe: reading.groupe,
      field_key: fieldKey, source_id: source.source_id, vintage_id: source.vintage_id,
      source_name: source.name, source_version: source.version,
      reference_date: source.reference_date, publication_date: source.publication_date,
      dataset_id: stateDataset, dataset_content_version: publicationFor(stateResource),
      state_role: role, observation_period: fact.dimension ?? fact.detail,
      axis_value: fact.detail, provenance_revision_id: `synthetic-test-${revisionHash.slice(0, 16)}`,
      population_revision_id: null, source: { source_id: source.source_id, name: source.name,
        vintage_id: source.vintage_id, version: source.version,
        reference_date: source.reference_date, publication_date: source.publication_date } })
  })
  return bindings
}

/** Return one response-shaped payload using only fields declared by the producer catalogue. */
export function nativeReadFixture(item: Record<string, any>, resource: Resource): Record<string, any> {
  const target = item.target
  const version = publicationFor(resource)
  const referenceVersion = 'semantic-reference-fixture-v1'
  const descriptorVersion = `${resource.resource_id}-fixture-descriptor-v1`
  const shapes = resource.shapes
  const shared = { resource: resource.resource_id, target }

  if (resource.resource_kind === 'aedar_source_grain') {
    const typequ = item.coordinates?.typequ ?? []
    const fields = item.fields?.map((field: string) => field.replace(/^measures\./, ''))
    const measureKeys = fields ?? aedarMeasureKeys
    return { ...shared, territory: { territory_type: target.type, territory_id: target.id },
      content_version: version, reference_content_version: referenceVersion, limit: 100, offset: 0,
      facts: typequ.map((code: string) => ({ territory_id: target.id, territory_type: target.type,
         typequ: code, typequ_label: code, identity: {}, n_addresses: 1, n_observed: 1,
         coverage_status: 'covered', measures: Object.fromEntries(measureKeys.map((key: string) => [key, 1])),
         ...aedarFixtureSource })) , synthetic_fixture: raccordementFixtureNotice }
  }

  if (target.kind === 'named_reference') {
    return { ...shared, ...syntheticRaccordementReference(resource, version, referenceVersion) }
  }

  if (item.intent.kind !== 'facts') {
    if (resource.resource_id === 'raccordement_courbe') {
      return { ...shared, ...syntheticRaccordementComparison(item, resource, version, referenceVersion, descriptorVersion) }
    }
    const isProfile = shapes.includes('declared_profile')
    const isSeries = shapes.includes('ordered_series')
    const isCollection = shapes.includes('period_detail')
    const selected = item.intent.kind === 'selected_comparison'
      ? item.intent.members.map((member: { type: string; id: string }) => ({
        territory_type: member.type, territory_id: member.id,
      })) : null
    const focal = territories.find((territory) => territory.type === target.type && territory.territoire === target.id)
    const cohort = selected ?? (target.type === 'commune'
      ? territories.filter((territory) => territory.type === 'commune' &&
        territory.classe_densite_code === focal?.classe_densite_code)
      : territories.filter((territory) => territory.type === target.type))
    const shape = isProfile ? 'declared_profile' : isSeries ? 'ordered_series'
      : isCollection ? 'period_detail' : 'scalar'
    const result = { indicator_id: resource.indicator_id, status: 'unavailable', reason: 'fixture_unavailable',
      unit: resource.unit, direction: resource.direction,
      source_facet: isProfile ? undefined : isSeries ? null : resource.indicator_id,
      descriptor_version: descriptorVersion,
      ...(isProfile ? { profile_descriptor_version: descriptorVersion } : {}),
      selected_member_count: cohort.length, eligible_count: 0, missing_count: cohort.length,
      rank: null, rank_size: null }
    const dualScalarSeries = shapes.includes('scalar') && isSeries
    const scalarVersions = scalarFacetVersions(resource, version, referenceVersion)
    const scalarFacet = dualScalarSeries ? { shape: 'scalar', source_facet: resource.indicator_id,
      ...scalarVersions, descriptor: scalarFacetDescriptor(resource, scalarVersions.descriptor_version),
      ...(selected ? {} : { comparison_content_version: `${resource.resource_id}-scalar-comparison-fixture-v1` }),
      selection: selected, scope: selected ? { kind: 'explicit_selection', member_count: selected.length }
        : { kind: target.type === 'commune' ? 'density_class' : 'same_level',
          territory_type: target.type, density_class_code: focal?.classe_densite_code ?? null,
          member_count: cohort.length },
      result: { indicator_id: resource.indicator_id, source_facet: resource.indicator_id,
        status: 'unavailable', reason: 'fixture_unavailable', direction: resource.direction,
        descriptor_version: scalarVersions.descriptor_version, selected_member_count: cohort.length,
        eligible_count: 0, missing_count: cohort.length, rank: null, rank_size: null } } : undefined
    return { ...shared, contract: 'indicator-comparison-v1', indicator_id: resource.indicator_id, shape,
      content_version: version, reference_content_version: referenceVersion, selection: selected,
      scope: selected ? { kind: 'explicit_selection', member_count: selected.length }
        : { kind: target.type === 'commune' ? 'density_class' : 'same_level',
          territory_type: target.type, density_class_code: focal?.classe_densite_code ?? null,
          member_count: cohort.length },
      result, ...(scalarFacet ? { scalar_facet: scalarFacet } : {}) }
  }

  if (resource.resource_id === 'raccordement_tc') {
    return { ...shared, ...syntheticRaccordementScalar(item, resource, version, referenceVersion, descriptorVersion) }
  }

  if (shapes.includes('typed_reading')) {
    const cohortMembers = target.kind === 'territory_cohort' ? territories.filter((territory) =>
      territory.type === target.type && (!target.epci_id || territory.epci === target.epci_id) &&
      (!target.department_id || territory.departement === target.department_id)) : []
    const firstMember = cohortMembers[0]
    const readingTarget = target.kind === 'territory_cohort' && firstMember
      ? { kind: 'territory', type: firstMember.type, id: firstMember.territoire } : target
    const published = publishedReading(resource, readingTarget)
    const readingSource = sourceFor(resource, published, readingTarget)
    if (target.kind === 'territory_cohort') {
      const rateLabel = metadataFor(resource.theme_id).param_labels?.taux_solde_naturel ?? ''
      const rateUnit = rateLabel.match(/\(([^()]*)\)$/)?.[1]
      return { ...shared, shape: 'typed_reading', cohort: { territory_type: target.type,
        epci_id: target.epci_id ?? null, department_id: target.department_id ?? null,
        member_count: cohortMembers.length, members: cohortMembers.map((member) => ({ id: member.territoire,
          type: member.type, name: member.nom })), reference_content_version: referenceVersion },
        content_version: version, reference_content_version: referenceVersion,
        descriptor: { descriptor_version: version, source: readingSource,
          ...(resource.resource_id === 'demographie_selected_reading' ? { rate_unit: rateUnit } : {}) },
        territories: cohortMembers.map((member) => {
          const memberTarget = { kind: 'territory', type: member.type, id: member.territoire }
          const facts = readingFixture(resource, memberTarget)
          if (resource.resource_id !== 'milieux_selected_reading') {
            return { territory: { id: member.territoire, type: member.type, name: member.nom }, facts }
          }
          const sourceAbsences = facts.length ? [] : [syntheticMilieuxSourceAbsence(resource, member.territoire)]
          const sourceBindings = facts.length
            ? syntheticMilieuxSourceBindings(memberTarget, facts[0]!) : []
          return { territory: { id: member.territoire, type: member.type, name: member.nom }, facts,
            source_absences: sourceAbsences, source_bindings: sourceBindings }
        }) }
    }
    const facts = readingFixture(resource, target)
    const binding = { source_id: readingSource.source_id, source_name: readingSource.name,
      source_version: readingSource.version, vintage_id: readingSource.vintage_id,
      reference_date: readingSource.reference_date, publication_date: readingSource.publication_date }
    const reading = facts[0]
    if (resource.resource_id === 'economie_selected_reading' && reading) {
      const published = publishedReading(resource, target)
      if (!published) throw new Error('Published economy reading evidence is missing')
      const rankedActivities = [1, 2, 3, 4, 5].flatMap((rank) => {
        const activityCode = published?.[`top${rank}_activity_code`]
        const activityLabel = published?.[`top${rank}_activity_label`]
        if (typeof activityCode !== 'string' || typeof activityLabel !== 'string') return []
        return [{ groupe: reading.groupe, activity_code: activityCode, activity_label: activityLabel,
          lq: published[`top${rank}_lq`] ?? null, establishment_count: published[`top${rank}_n`],
          park_share: published[`top${rank}_part_parc`] ?? null }]
      })
      return { ...shared, content_version: version, reference_content_version: referenceVersion,
        descriptor: { descriptor_version: version, source: readingSource },
        facts: [{ ...reading, source: readingSource }], source_bindings: [{ ...binding, groupe: reading.groupe }],
        ranked_activities: rankedActivities }
    }
    const rateLabel = metadataFor(resource.theme_id).param_labels?.taux_solde_naturel ?? ''
    const rateUnit = rateLabel.match(/\(([^()]*)\)$/)?.[1]
    return { ...shared, content_version: version, reference_content_version: referenceVersion,
      descriptor: { descriptor_version: version, source: readingSource,
        ...(resource.resource_id === 'demographie_selected_reading' ? { rate_unit: rateUnit } : {}) },
      facts: reading ? [{ ...reading, source: readingSource }] : [],
      source_bindings: reading ? [{ ...binding, groupe: reading.groupe }] : [],
      ...(resource.resource_id === 'milieux_selected_reading' ? { source_absences: [] } : {}) }
  }

  if (shapes.includes('anchored_membership')) {
    return { ...shared, indicator_id: resource.indicator_id, theme_id: resource.theme_id,
      kind: 'anchored_membership', content_version: version, reference_content_version: referenceVersion,
      completeness: 'observed_sparse', availability: 'no_record', entries: [], relationships: [], summaries: [] }
  }

  const facts = publishedIndicators(resource, target)

  if (shapes.includes('declared_profile')) {
    const axes = (resource.axis_values ?? []).flatMap(([name, values]) => values.map((key, order) => ({
      name, key, label: key, order, unit: resource.unit,
    })))
    const details = axes.filter((axis) => axis.name === 'detail')
    const sexes = axes.filter((axis) => axis.name === 'sex')
    const observations = facts.map((fact) => {
        const provenance = sourceFor(resource, fact, target)
      return { detail: fact.detail, sex: fact.sex ?? null, unit: fact.unit ?? resource.unit,
        status: fact.value === null ? 'missing' : 'measured', value: fact.value,
        sources: [provenance] }
    })
    return { ...shared, content_version: version, reference_content_version: referenceVersion,
      descriptor: { indicator: resource.indicator_id,
      label: resource.label, unit: resource.unit, descriptor_version: descriptorVersion,
      comparison_scalar: null, required_scalar_version: null, denominator_semantics: 'Fixture',
      comparison_point: { detail: details[0]?.key ?? null, sex: sexes[0]?.key ?? null,
        direction: resource.direction, unit: resource.unit }, axes }, observations }
  }

  if (shapes.includes('ordered_series')) {
    if (resource.resource_id === 'raccordement_courbe') {
      return { ...shared, ...syntheticRaccordementSeries(item, resource, version, referenceVersion, descriptorVersion) }
    }
    const axis = resource.axis_values?.[0]
    const axisKind = axis?.[0] ?? resource.axes?.[0] ?? 'axis'
    const axisValue = (fact: Record<string, any>) => String(fact.detail ?? fact.dimension ?? '')
    const seriesFacts = facts.filter((fact) => fact.detail !== null && fact.detail !== undefined ||
      fact.dimension !== null && fact.dimension !== undefined)
    const axisValues = seriesFacts.map(axisValue)
    const points = seriesFacts.map((fact) => {
      const provenance = sourceFor(resource, fact, target, true)
      return { axis: axisValue(fact), observation_period: String(fact.dimension ?? fact.detail ?? ''),
        value: fact.value, status: fact.value === null ? 'missing' : 'measured', missing_reason: fact.value === null ? 'missing' : null,
        provenance: [{ source_id: provenance.source_id, source_name: provenance.name,
          vintage_id: provenance.vintage_id, version: provenance.version,
          reference_date: provenance.reference_date, publication_date: provenance.publication_date,
          revision_id: 'fixture-revision', dataset_name: resource.resource_id,
          revision_hash: 'fixture-revision-hash' }] }
    })
    const response: Record<string, any> = { ...shared, indicator_id: resource.indicator_id, theme_id: resource.theme_id,
      dataset_id: resource.resource_id === 'raccordement_courbe' ? raccordementRoute.dataset_id : resource.resource_id,
      publication_id: version, content_version: version, reference_content_version: referenceVersion,
      descriptor_version: descriptorVersion, axis_kind: axisKind, axis_values: axisValues,
      axis_numeric_values: axisValues.map((value) => {
        const numeric = Number(value.startsWith('t') ? value.slice(1) : value)
        return Number.isFinite(numeric) ? numeric : null
      }),
      completeness: facts.length ? 'observed_sparse' : 'no_record', label: resource.label,
      unit: resource.unit, direction: resource.direction, comparison_point: null,
       points, scope_series: [], context: null, named_references: [], availability: facts.length ? 'observed' : 'no_record' }
    if (shapes.includes('scalar')) {
      // Emit a deterministic synthetic pooled observation with producer-owned
      // source identity/clock. It is not copied from a checked-in curve and is
      // not evidence of a live publication or frontend publication parity.
      const pooledSourceFact = facts.find((fact) => fact.detail === null || fact.detail === undefined)
      const scalarSource = pooledSourceFact ? sourceFor(resource, pooledSourceFact, target) : null
      const scalarVersions = scalarFacetVersions(resource, version, referenceVersion)
      response.scalar_facet = { shape: 'scalar', source_facet: resource.indicator_id, ...scalarVersions,
        descriptor: scalarFacetDescriptor(resource, scalarVersions.descriptor_version),
        observation: { territory_id: target.id, territory_type: target.type,
          status: scalarSource ? 'measured' : 'unavailable', value: scalarSource ? 700 : null,
          support_count: scalarSource ? 12 : null, denominator_count: scalarSource ? 20 : null,
          sources: scalarSource ? [{ source_id: scalarSource.source_id, name: scalarSource.name,
            vintage_id: scalarSource.vintage_id, version: scalarSource.version,
            reference_date: scalarSource.reference_date, publication_date: scalarSource.publication_date }] : [] } }
    }
    return response
  }

  if (shapes.includes('period_detail')) {
    const entries = facts.filter((fact) => fact.value !== null).map((fact) => ({
      detail: fact.detail, label: fact.detail, observation_period: String(fact.dimension ?? ''),
      value: fact.value, status: 'measured', sources: [sourceFor(resource, fact, target)],
    }))
    return { ...shared, indicator_id: resource.indicator_id, theme_id: resource.theme_id,
      kind: 'period_detail', content_version: version, descriptor_version: descriptorVersion,
      reference_content_version: referenceVersion, completeness: 'observed_sparse',
      availability: entries.length ? 'observed' : 'no_record', unit: resource.unit, entries }
  }

  const fact = facts[0]
  const provenance = fact ? sourceFor(resource, fact, target) : null
  return { ...shared, indicator_id: resource.indicator_id, territory_id: target.id,
    territory_type: target.type, label: resource.label, unit: resource.unit, direction: resource.direction,
    content_version: version, reference_content_version: referenceVersion,
    descriptor_version: descriptorVersion,
    value: fact?.value ?? null, status: fact ? fact.value === null ? 'missing' : 'measured' : 'no_record',
    sources: provenance ? [provenance] : [] }
}

/** Wrap item-specific native API envelopes, while validating the real request contract. */
export function nativeBatchResponse<T extends Record<string, any>>(
  items: Array<Record<string, any>>,
  read: (item: Record<string, any>, resource: Resource) => T,
): Response {
  if (!Array.isArray(items) || items.length < 1 || items.length > 12) {
    throw new Error('Native semantic fixture batch must contain 1–12 items')
  }
  const ids = items.map((item) => item.id)
  if (new Set(ids).size !== ids.length || ids.some((id) => typeof id !== 'string' || !id)) {
    throw new Error('Native semantic fixture requires unique item IDs')
  }
  const byId = new Map(catalogue.resources.map((resource) => [resource.resource_id, resource]))
  const results = items.map((item) => {
    const resource = byId.get(item.resource)
    const invalidCoordinates = Boolean(resource && item.coordinates &&
      Object.entries(item.coordinates).some(([axis, values]) => {
        if (!(resource.axes ?? []).includes(axis)) return true
        const declared = resource.axis_values?.find(([name]) => name === axis)?.[1]
        return Array.isArray(declared) && declared.length > 0 &&
          (values as unknown[]).some((value) => !declared.includes(String(value)))
      }))
    const invalidFields = Boolean(resource && item.fields &&
      (resource.resource_kind === 'aedar_source_grain'
        ? item.fields.some((field: string) => {
          if (resource.fields.includes(field)) return false
          const measure = field.match(/^measures\.([a-z0-9_]+)$/)?.[1]
          return !measure || !aedarMeasureKeys.includes(measure)
        })
        : item.fields.some((field: string) => !resource.fields.includes(field))))
    if (!resource || typeof item.id !== 'string' || !item.id ||
        !resource.target_kinds.includes(item.target?.kind) ||
        !resource.intents.includes(item.intent?.kind) ||
        (item.target.kind !== 'named_reference' && !resource.allowed_levels.includes(item.target.type)) ||
        (item.target.kind === 'named_reference' && !resource.target_ids.includes(item.target.id)) ||
        invalidCoordinates || invalidFields) {
      throw new Error(`Undeclared native semantic request: ${JSON.stringify(item)}`)
    }
    const data = read(item, resource)
    if (data.resource !== item.resource || !data.target ||
        JSON.stringify(data.target) !== JSON.stringify(item.target)) {
      throw new Error(`Native read fixture did not echo resource/target identity: ${item.resource}`)
    }
    return { id: item.id, resource: item.resource, data }
  }).reverse()
  return new Response(JSON.stringify({ contract: 'semantic-read-batch-v1', results }), { status: 200 })
}
