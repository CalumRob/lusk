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

export function nativeCatalogueResponse(): Response {
  return new Response(JSON.stringify(catalogue), { status: 200 })
}

/** The declarations are loaded from the same producer catalogue served by the API. */
export function nativeResources(theme?: string): Resource[] {
  return catalogue.resources.filter((resource) => theme === undefined || resource.theme_id === theme)
}

const territories = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/territoires.json'), 'utf8')) as Array<Record<string, any>>
const mobiliteProducer = JSON.parse(readFileSync(resolve(process.cwd(),
  '../pipeline/inst/extdata/theme-metadata/theme_mobilite.json'), 'utf8'))
const raccordementRoute = mobiliteProducer.owned_series_routes.raccordement_courbe
const publishedModels = new Map<string, Record<string, any>>()

function sourceFor(resource: Resource, fact?: Record<string, any>) {
  const sourceId = resource.sources[0] ?? 'semantic_fixture_source'
  const version = typeof fact?.vintage_version === 'string' ? fact.vintage_version : 'fixture-v1'
  return { source_id: sourceId, name: fact?.vintage_source ?? `Source fixture ${sourceId}`,
    vintage_id: `${sourceId}-${version}`, version,
    reference_date: fact?.vintage_date_reference ?? null,
    publication_date: fact?.vintage_date_publication ?? null }
}

function publicationFor(resource: Resource): string {
  const dataset = resource.resource_id === 'raccordement_courbe' || resource.resource_id === 'raccordement_reference'
    ? raccordementRoute.dataset_id : resource.resource_id
  return `${dataset}-fixture-publication-v1`
}

function publishedReading(resource: Resource, target: Record<string, any>): Record<string, any> | undefined {
  if (target.kind !== 'territory' || typeof target.type !== 'string' || typeof target.id !== 'string') return undefined
  try {
    const path = resolve(process.cwd(), `../public/data/modeles-lecture/territoires/${target.type}/${target.id}.json`)
    const model = JSON.parse(readFileSync(path, 'utf8'))
    const group = resource.axis_values?.find(([axis]) => axis === 'groupe')?.[1]?.[0]
    return model.themes?.[resource.theme_id]?.histoires?.find((fact: Record<string, any>) => fact.groupe === group)
  } catch {
    return undefined
  }
}

function publishedIndicators(resource: Resource, target: Record<string, any>): Record<string, any>[] {
  if (target.kind !== 'territory' || typeof target.type !== 'string' || typeof target.id !== 'string') return []
  const key = `${target.type}/${target.id}`
  let model = publishedModels.get(key)
  if (!model) {
    try {
      model = JSON.parse(readFileSync(resolve(process.cwd(),
        `../public/data/modeles-lecture/territoires/${key}.json`), 'utf8'))
      publishedModels.set(key, model)
    } catch {
      return []
    }
  }
  return model.themes?.[resource.theme_id]?.indicateurs?.filter((fact: Record<string, any>) =>
    fact.key === resource.resource_id) ?? []
}

function readingFixture(resource: Resource, target: Record<string, any>): Record<string, any>[] {
  const themeMetadata = JSON.parse(readFileSync(resolve(process.cwd(),
    `../pipeline/inst/extdata/theme-metadata/theme_${resource.theme_id}.json`), 'utf8'))
  const group = resource.axis_values?.find(([axis]) => axis === 'groupe')?.[1]?.[0]
  const published = publishedReading(resource, target)
  const source = sourceFor(resource, published)
  const storyKey = published?.story_key ?? themeMetadata.subgroups?.find((item: Record<string, any>) =>
    item.key === group)?.reading?.story_key ?? themeMetadata.story_keys?.[0]
  const common = { groupe: group, story_key: storyKey, salience_reason: published?.salience_reason ?? 'defaut',
    status: 'measured', source_id: source.source_id, vintage_id: source.vintage_id }
  if (resource.resource_id === 'demographie_selected_reading') return []
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
  return []
}

/** Return one response-shaped payload using only fields declared by the producer catalogue. */
export function nativeReadFixture(item: Record<string, any>, resource: Resource): Record<string, any> {
  const target = item.target
  const source = sourceFor(resource)
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
        source_id: source.source_id, vintage_id: source.vintage_id, source_url: 'https://example.test/fixture',
        licence: 'Fixture', attribution: source.name, reference_date: null, publication_date: null })) }
  }

  if (target.kind === 'named_reference') {
    const reference = raccordementRoute.reference
    return { ...shared, indicator_id: resource.indicator_id, dataset_id: raccordementRoute.dataset_id,
      publication_id: version, content_version: version, reference_content_version: referenceVersion,
      unit: resource.unit, reference, availability: 'unavailable', points: [] }
  }

  if (item.intent.kind !== 'facts') {
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
    return { ...shared, contract: 'indicator-comparison-v1', indicator_id: resource.indicator_id, shape,
      content_version: version, reference_content_version: referenceVersion, selection: selected,
      scope: selected ? { kind: 'explicit_selection', member_count: selected.length }
        : { kind: target.type === 'commune' ? 'density_class' : 'same_level',
          territory_type: target.type, density_class_code: focal?.classe_densite_code ?? null,
          member_count: cohort.length },
      result: { indicator_id: resource.indicator_id, status: 'unavailable', reason: 'fixture_unavailable',
        unit: resource.unit, direction: resource.direction,
        source_facet: isProfile ? undefined : isSeries ? null : resource.indicator_id,
        descriptor_version: descriptorVersion,
        ...(isProfile ? { profile_descriptor_version: descriptorVersion } : {}),
        selected_member_count: cohort.length, eligible_count: 0, missing_count: cohort.length,
        rank: null, rank_size: null } }
  }

  if (shapes.includes('typed_reading')) {
    const facts = readingFixture(resource, target)
    const readingSource = facts[0] ? sourceFor(resource, publishedReading(resource, target)) : source
    const binding = { source_id: readingSource.source_id, source_name: readingSource.name,
      source_version: readingSource.version, vintage_id: readingSource.vintage_id,
      reference_date: readingSource.reference_date, publication_date: readingSource.publication_date }
    if (target.kind === 'territory_cohort') {
      const members = territories.filter((territory) => territory.type === target.type &&
        (!target.epci_id || territory.epci === target.epci_id) &&
        (!target.department_id || territory.departement === target.department_id))
      return { ...shared, shape: 'typed_reading', cohort: { territory_type: target.type,
        epci_id: target.epci_id ?? null, department_id: target.department_id ?? null,
        member_count: members.length, members: members.map((member) => ({ id: member.territoire,
          type: member.type, name: member.nom })), reference_content_version: referenceVersion },
        content_version: version, reference_content_version: referenceVersion,
        territories: members.map((member) => ({ territory: { id: member.territoire, type: member.type, name: member.nom },
          // Peer observations are intentionally absent: this fixture validates
          // the cohort envelope without manufacturing a synthetic peer cloud.
          facts: [], ...(resource.resource_id === 'milieux_selected_reading'
            ? { source_absences: [] } : {}) })) }
    }
    const reading = facts[0]
    if (resource.resource_id === 'economie_selected_reading' && reading) {
      const published = publishedReading(resource, target)
      const rankedActivities = [1, 2, 3, 4, 5].flatMap((rank) => {
        const activityCode = published?.[`top${rank}_activity_code`]
        const activityLabel = published?.[`top${rank}_activity_label`]
        if (typeof activityCode !== 'string' || typeof activityLabel !== 'string') return []
        return [{ groupe: reading.groupe, activity_code: activityCode, activity_label: activityLabel,
          lq: published[`top${rank}_lq`] ?? null, establishment_count: published[`top${rank}_n`],
          park_share: published[`top${rank}_part_parc`] ?? null }]
      })
      return { ...shared, content_version: version, reference_content_version: referenceVersion,
        facts: [reading], source_bindings: [{ ...binding, groupe: reading.groupe }],
        ranked_activities: rankedActivities }
    }
    return { ...shared, content_version: version, reference_content_version: referenceVersion,
      facts: reading ? [reading] : [], source_bindings: reading ? [{ ...binding, groupe: reading.groupe }] : [],
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
      const provenance = sourceFor(resource, fact)
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
    const axis = resource.axis_values?.[0]
    const axisKind = axis?.[0] ?? resource.axes?.[0] ?? 'axis'
    const axisValue = (fact: Record<string, any>) => String(fact.detail ?? fact.dimension ?? '')
    const seriesFacts = facts.filter((fact) => fact.detail !== null && fact.detail !== undefined ||
      fact.dimension !== null && fact.dimension !== undefined)
    const scalarFact = facts.find((fact) => fact.detail === null && fact.dimension === null)
    const axisValues = seriesFacts.map(axisValue)
    const points = seriesFacts.map((fact) => {
      const provenance = sourceFor(resource, fact)
      return { axis: axisValue(fact), observation_period: String(fact.dimension ?? fact.detail ?? ''),
        value: fact.value, status: fact.value === null ? 'missing' : 'measured', missing_reason: fact.value === null ? 'missing' : null,
        provenance: [{ source_id: provenance.source_id, source_name: provenance.name,
          vintage_id: provenance.vintage_id, version: provenance.version,
          reference_date: provenance.reference_date, publication_date: provenance.publication_date,
          revision_id: 'fixture-revision', dataset_name: resource.resource_id,
          revision_hash: 'fixture-revision-hash' }] }
    })
    return { ...shared, indicator_id: resource.indicator_id, theme_id: resource.theme_id,
      dataset_id: resource.resource_id === 'raccordement_courbe' ? raccordementRoute.dataset_id : resource.resource_id,
      publication_id: version, content_version: version, reference_content_version: referenceVersion,
      descriptor_version: descriptorVersion, axis_kind: axisKind, axis_values: axisValues,
      axis_numeric_values: axisValues.map((value) => {
        const numeric = Number(value.startsWith('t') ? value.slice(1) : value)
        return Number.isFinite(numeric) ? numeric : null
      }),
      completeness: facts.length ? 'observed_sparse' : 'no_record', label: resource.label,
      unit: resource.unit, direction: resource.direction, comparison_point: null,
      points, scope_series: [], context: null, named_references: [], availability: facts.length ? 'observed' : 'no_record',
      ...(scalarFact ? { value: scalarFact.value,
        status: scalarFact.value === null ? 'missing' : 'measured', sources: [sourceFor(resource, scalarFact)] } : {}) }
  }

  if (shapes.includes('period_detail')) {
    const entries = facts.filter((fact) => fact.value !== null).map((fact) => ({
      detail: fact.detail, label: fact.detail, observation_period: String(fact.dimension ?? ''),
      value: fact.value, status: 'measured', sources: [sourceFor(resource, fact)],
    }))
    return { ...shared, indicator_id: resource.indicator_id, theme_id: resource.theme_id,
      kind: 'period_detail', content_version: version, descriptor_version: descriptorVersion,
      reference_content_version: referenceVersion, completeness: 'observed_sparse',
      availability: entries.length ? 'observed' : 'no_record', unit: resource.unit, entries }
  }

  const fact = facts[0]
  const provenance = fact ? sourceFor(resource, fact) : null
  return { ...shared, indicator_id: resource.indicator_id, territory_id: target.id,
    territory_type: target.type, label: resource.label, unit: resource.unit, direction: resource.direction,
    content_version: version, reference_content_version: referenceVersion,
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
