import { describe, expect, it } from 'vitest'
import { applyThemeComparisonApiFacts, mobilityFactsFromThemeApi } from '@/fiche/content/mobilityThemeApiFacts'
import type { TerritoryComparisonContext } from '@/payload/territoryReadModel'
import { metadonneesThemesFixtures, histoiresMobiliteFixture } from '@/payload/fixtures'
import type { Payload } from '@/payload/types'
import { resolveMobiliteThemeContent } from '@/fiche/content/themeContent'
import CahierOffreTransportsFigure from '@/fiche/prototype/CahierOffreTransportsFigure.vue'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { validateRaccordementIndicatorRead } from '@/payload/raccordementIndicatorApi'

// Wire fields are producer-owned indicator observations, not storage-family rows.
const sources = [{ source_id: 'mobilite_snapshot', name: 'SQL mobility', version: 'sql-v1',
  reference_date: null, publication_date: null }]
const context: TerritoryComparisonContext = { mode: 'densite', scope: {
  kind: 'communes-densite', label: 'Source-defined group' }, facts: [], buildingDistribution: null, accessRamp: null }
const payload: Payload = {
  territoires: [{ territoire: '22001', type: 'commune', nom: 'Commune', departement: '22', epci: null }],
  indicateurs: [], histoires: histoiresMobiliteFixture, apercu: null, runReport: null,
  vintages: [], programmes: null, themeMetadata: metadonneesThemesFixtures,
}
const readingGroup = metadonneesThemesFixtures.mobilite!.subgroups.find(
  (group) => group.reading?.params.includes('div_loss_t'),
)!.key
const response = (): any => ({
  contract: 'theme-facts-v1', complete_theme: false, theme_id: 'mobilite',
  territory: { territory_id: '22001', territory_type: 'commune', name: 'Commune' },
  indicators: [
    { indicator_id: 'places_stationnement_velo_1000', label: 'Stationnement',
      value: 123, status: 'measured', unit: 'places / 1 000 habitants', sources, dimensions: {} },
    { indicator_id: 'reseaux_par_habitant', label: 'Réseaux', value: 456, status: 'measured',
      unit: 'km / 1 000 habitants', sources, dimensions: { detail: 't_km_1000' } },
  ],
  indicator_metadata: [{ indicator_id: 'reseaux_par_habitant', kind: 'declared_dimensions',
    allowed_levels: ['commune'], descriptor_version: 'profile-v1', denominator_semantics: 'published denominator',
    axes: [{ name: 'detail', key: 't_km_1000', label: 'À pied', order: 0, unit: 'km / 1 000 habitants' },
      { name: 'sex', key: 'F', label: 'Femmes', order: 0, unit: null }] }],
  named_reference_evidence: [],
  series: [], bpe_profile_evidence: null,
  readings: [{ groupe: readingGroup, story_key: 'sql-story', salience_reason: 'sql',
    classification_saillance: null, div_loss_t: 7, div_loss_b: 8, status: 'measured', unit: 'types',
    provenance: { source_id: 'mobilite_snapshot', source_name: 'SQL mobility', source_version: 'sql-v1',
      source_reference_date: null, source_publication_date: null } }],
})

/** Build actual read-batch resource envelopes from the compact table used by
 * these product-model tests. Excluded BPE/building evidence and legacy story
 * fields are intentionally not carried into the semantic resource set. */
function semanticResponse(envelope: any, territoryId: string, payloadModel = payload): any {
  const target = payloadModel.territoires.find((territory) => territory.territoire === territoryId)
  if (!target) throw new Error(`Missing fixture territory ${territoryId}`)
  const indicators: any[] = envelope.indicators ?? []
  const metadata: any[] = envelope.indicator_metadata ?? []
  const ids = [...new Set(indicators.map((fact) => fact.indicator_id))]
  const resource_reads: any[] = ids.map((resource) => {
    const facts = indicators.filter((fact) => fact.indicator_id === resource)
    const descriptor = metadata.find((item) => item.indicator_id === resource) ?? {}
    const targetRef = { kind: 'territory', type: target.type, id: target.territoire }
    if (descriptor.axis_kind || facts.some((fact) => fact.dimensions?.axis !== undefined)) {
      const points = facts.map((fact) => ({ axis: fact.dimensions.axis,
        observation_period: fact.dimensions.observation_period ?? null,
        value: fact.value, status: fact.status, missing_reason: fact.missing_reason ?? null,
        state_role: fact.dimensions.state_role ?? null, provenance: fact.sources }))
      const axis_values = descriptor.axis_values ?? points.map((point) => point.axis)
      return { resource, shapes: ['ordered_series'], declaration: { axes: [descriptor.axis_kind].filter(Boolean),
        comparison_contract: descriptor.comparison_contract }, data: { resource, target: targetRef,
        dataset_id: resource, publication_id: descriptor.content_version ?? `${resource}-v1`,
        reference_content_version: envelope.reference_content_version ?? 'territories-v1',
        indicator_id: resource, unit: facts[0]?.unit ?? descriptor.unit ?? '', direction: descriptor.direction ?? 'none',
        axis_kind: descriptor.axis_kind ?? 'duration_minute', axis_values,
        axis_numeric_values: descriptor.axis_numeric_values ?? axis_values.map((axis: unknown) => Number(axis)),
        completeness: descriptor.completeness ?? 'dense_complete', descriptor_version: descriptor.descriptor_version ?? `${resource}-descriptor-v1`,
        comparison_point: descriptor.comparison_point ?? null, comparison_contract: descriptor.comparison_contract,
        points } }
    }
    if (Array.isArray(descriptor.axes)) {
      return { resource, shapes: ['declared_profile'], declaration: {}, data: { resource, target: targetRef,
        indicator_id: resource, content_version: descriptor.content_version ?? `${resource}-v1`,
        reference_content_version: envelope.reference_content_version ?? 'territories-v1',
        descriptor: { ...descriptor, axes: descriptor.axes, unit: descriptor.unit ?? facts[0]?.unit ?? '',
          label: descriptor.label ?? resource },
        observations: facts.map((fact) => ({ detail: fact.dimensions?.detail, sex: fact.dimensions?.sex ?? null,
          value: fact.value, status: fact.status, unit: fact.unit, sources: fact.sources })) } }
    }
    const fact = facts[0]!
    return { resource, shapes: ['scalar'], declaration: {}, data: { resource, target: targetRef,
      indicator_id: resource, unit: fact.unit, value: fact.value, status: fact.status, sources: fact.sources } }
  })
  let owner: any = resource_reads.find((read: any) => read.resource === 'raccordement_courbe')
  if (!owner && (envelope.named_reference_evidence ?? []).length) {
    const reference = envelope.named_reference_evidence[0]
    owner = { resource: 'raccordement_courbe', shapes: ['ordered_series'], declaration: { axes: ['duration_minute'] },
      data: { resource: 'raccordement_courbe', target: { kind: 'territory', type: target.type, id: target.territoire },
        dataset_id: 'raccordement_courbe', publication_id: 'raccordement_courbe-v1',
        reference_content_version: 'territories-v1', indicator_id: 'raccordement_courbe', unit: reference.unit,
        axis_kind: 'duration_minute', axis_values: [reference.points[0]?.axis],
        axis_numeric_values: [0], completeness: 'sparse_declared', points: [] } }
    resource_reads.push(owner)
  }
  const named_reference_reads = (envelope.named_reference_evidence ?? []).map((reference: any) => ({
    resource: 'raccordement_reference', shapes: ['named_reference'], declaration: { target_ids: [reference.id] },
    data: { resource: 'raccordement_reference', target: { kind: 'named_reference', id: reference.id },
      dataset_id: owner?.data.dataset_id ?? 'raccordement_courbe',
      publication_id: owner?.data.publication_id ?? 'raccordement_courbe-v1',
      reference_content_version: owner?.data.reference_content_version ?? 'territories-v1',
      indicator_id: 'raccordement_reference', unit: reference.unit,
      reference: { id: reference.id, label: reference.label, role: reference.role,
        statistic: reference.statistic, required: true },
      points: reference.points.map((point: any) => ({ ...point,
        provenance: (point.provenance ?? []).map((source: any) => ({ ...source,
          source_id: source.source_id, source_name: source.source_name ?? source.name })) })) },
  }))
  return { theme_id: 'mobilite', resource_reads, named_reference_reads }
}

function mobilityFacts(envelope: any, territoryId: string, payloadModel = payload) {
  return mobilityFactsFromThemeApi(payloadModel, territoryId, semanticResponse(envelope, territoryId, payloadModel))
}

describe('SQL Mobilité response to Variant E facts', () => {
  it('adapts a native semantic scalar resource without a theme-facts envelope', () => {
    const native = { theme_id: 'mobilite', resource_reads: [{ resource: 'places_stationnement_voiture_1000',
      shapes: ['scalar'], data: { resource: 'places_stationnement_voiture_1000',
        target: { kind: 'territory', type: 'commune', id: '22001' }, indicator_id: 'places_stationnement_voiture_1000',
        unit: 'places / 1 000 habitants', value: 321, status: 'measured', sources } }] }
    const facts = mobilityFactsFromThemeApi(payload, '22001', native)
    expect(facts.mobility.indicators.find((fact) => fact.key === 'places_stationnement_voiture_1000'))
      .toMatchObject({ value: 321, unit: 'places / 1 000 habitants',
        provenance: { source: 'SQL mobility', version: 'sql-v1' } })
  })

  it('renders regional network profiles and canonical parking facts, including a supported ratio', () => {
    const regionPayload: Payload = { ...payload, territoires: [
      { territoire: '53', type: 'region', nom: 'Bretagne', departement: null, epci: null },
    ] }
    const data = response()
    data.territory = { territory_id: '53', territory_type: 'region', name: 'Bretagne' }
    const profile = (indicator_id: string, detail: string, value: number) => ({ indicator_id,
      label: indicator_id, value, status: 'measured', unit: 'km', dimensions: { detail }, sources })
    data.indicators = [
      profile('reseaux', 't_longueur', 11000), profile('reseaux', 'b_longueur', 2500),
      profile('reseaux', 'c_longueur', 17000),
      { indicator_id: 'reseaux_par_habitant', label: 'R?seau par habitant', value: 7.5,
        status: 'measured', unit: 'km / 1 000 hab.', sources, dimensions: { detail: 't_km_1000' } },
      { indicator_id: 'reseaux_par_habitant', label: 'R?seau par habitant', value: 2.25,
        status: 'measured', unit: 'km / 1 000 hab.', sources, dimensions: { detail: 'b_km_1000' } },
      { indicator_id: 'reseaux_par_habitant', label: 'R?seau par habitant', value: 7.5,
        status: 'measured', unit: 'km / 1 000 hab.', sources, dimensions: { detail: 'c_km_1000' } },
      profile('offre_cyclable', 'protege_longueur', 1000),
      profile('offre_cyclable', 'protege_km_1000', 0.3),
      profile('offre_cyclable', 'partage_longueur', 1500),
      profile('offre_cyclable', 'partage_km_1000', 0.4),
      profile('offre_cyclable', 'total_longueur', 2500),
      { indicator_id: 'places_stationnement_velo_1000', label: 'Vélo', value: 12,
        status: 'measured', unit: 'places / 1 000 hab', sources, dimensions: {} },
      { indicator_id: 'places_stationnement_voiture_1000', label: 'Voiture', value: 400,
        status: 'measured', unit: 'places / 1 000 hab', sources, dimensions: {} },
      { indicator_id: 'stationnement_velo_par_voiture', label: 'Ratio vélo/voiture', value: 0.91,
        status: 'measured', unit: 'places vélo / place voiture', sources, dimensions: {} },
    ]
    data.indicator_metadata = ['reseaux', 'reseaux_par_habitant', 'offre_cyclable'].map((indicator_id) => ({
      indicator_id, kind: 'declared_dimensions', allowed_levels: ['commune','epci','departement','region'],
      completeness: 'dense_complete', denominator_semantics: 'Producer-supported regional aggregate',
      axes: data.indicators.filter((row: any) => row.indicator_id === indicator_id).map((row: any, order: number) => ({
        name: 'detail', key: row.dimensions.detail, label: row.dimensions.detail, order,
        unit: indicator_id === 'reseaux_par_habitant' ? 'km / 1 000 hab.' : 'km',
      })),
    }))
    const facts = mobilityFacts(data, '53', regionPayload)
    expect(facts.mobility.indicators.filter((fact) => fact.key === 'reseaux')).toHaveLength(3)
    expect(facts.mobility.indicators.filter((fact) => fact.key === 'reseaux_par_habitant')).toHaveLength(3)
    expect(facts.mobility.indicators.filter((fact) => fact.key === 'offre_cyclable')).toHaveLength(5)
    const content = resolveMobiliteThemeContent(facts)
    const sharing = content.units.find((unit) => unit.key === 'partage-de-lespace-public')!
    const networks = sharing.sections.find((section) => section.key === 'reseaux')!
    expect(networks.evidence?.kind).toBe('sharing-networks')
    if (networks.evidence?.kind !== 'sharing-networks') throw new Error('Regional per-capita network facts missing')
    expect(networks.evidence.networks.map(({ length }) => length.fact.value)).toEqual([7.5, 2.25, 7.5])
    const parking = sharing.sections.find((section) => section.key === 'stationnement')!
    expect(parking.evidence?.kind).toBe('sharing-parking')
    if (parking.evidence?.kind !== 'sharing-parking') throw new Error('Regional parking facts missing')
    expect(parking.evidence.bikeSpaces.fact.value).toBe(12)
    expect(parking.evidence.carSpaces.fact.value).toBe(400)
    expect(parking.evidence.bikePerCar.fact.value).toBe(0.91)

    // Invalid/missing canonical bike counts cannot leave a measured ratio in
    // the API payload; the page surfaces that ratio as unavailable.
    const incomplete = structuredClone(data)
    incomplete.indicators = incomplete.indicators
      .filter((row: any) => row.indicator_id !== 'stationnement_velo_par_voiture')
    const bike = incomplete.indicators.find((row: any) => row.indicator_id === 'places_stationnement_velo_1000')
    bike.value = null
    bike.status = 'not_available'
    const incompleteFacts = mobilityFacts(incomplete, '53', regionPayload)
    const incompleteContent = resolveMobiliteThemeContent(incompleteFacts)
    const incompleteSharing = incompleteContent.units.find((unit) => unit.key === 'partage-de-lespace-public')!
    const unavailableParking = incompleteSharing.sections.find((section) => section.key === 'stationnement')!
    if (unavailableParking.evidence?.kind !== 'sharing-parking') throw new Error('Regional parking section missing')
    expect(unavailableParking.evidence.bikePerCar.fact.value).toBeNull()
    expect(unavailableParking.evidence.bikePerCar.fact.availability).toBe('absent')
    expect(unavailableParking.evidence.ratioNote).toContain('deux mesures de stationnement')
  })

  it('consumes retained scalar and profile reads with SQL provenance without reviving legacy story values', () => {
    const facts = mobilityFacts(response(), '22001')
    expect(facts.mobility.indicators.find((fact) => fact.key === 'places_stationnement_velo_1000'))
      .toMatchObject({ value: 123, provenance: { source: 'SQL mobility', referenceDate: null } })
    expect(facts.mobility.indicators.find((fact) => fact.key === 'reseaux_par_habitant'))
      .toMatchObject({ detail: 't_km_1000', value: 456, unit: 'km / 1 000 habitants' })
    expect(facts.mobility.losses.diversityWalkTransit.value).toBeNull()
    expect(facts.mobility.losses.diversityBike.value).toBeNull()
  })
  it('projects regional motorisation and raccordement but renders only the selected curve', () => {
    const regionPayload: Payload = { ...payload, territoires: [
      { territoire: '53', type: 'region', nom: 'Bretagne', departement: null, epci: null },
    ] }
    const axes = ['t0000','t0015','t0030','t0045','t0060','t0090','t0120','t0180','t0240','t0300','t0360']
    const parts = [0.118268,0.4795024,0.4022296]
    const values = [0.985199,1,1,1,1,1,1,1,1,1,1]
    const reference = [0.000399,0.000476,0.001036,0.002318,0.004568,0.014585,
      0.043124,0.114126,0.214321,0.249159,0.268105]
    const data = response()
    data.territory = { territory_id: '53', territory_type: 'region', name: 'Bretagne' }
    data.indicators = [
      ...['sans_voiture','une_voiture','deux_plus'].map((detail,index) => ({
        indicator_id:'voitures_menage', unit:'%', status:'measured', value:parts[index],
        sources:[{...sources[0], reference_date:'2023-01-01'}], dimensions:{detail},
      })),
      ...axes.map((axis,index) => ({ indicator_id:'raccordement_courbe', unit:'%', status:'measured',
        value:values[index], sources:[{...sources[0], reference_date:'2026-08-25'}],
        dimensions:{axis,numeric_axis_value:index===0?0:index===1?15:index===2?30:index===3?45:index===4?60:index===5?90:index===6?120:index===7?180:index===8?240:index===9?300:360,
          observation_period:'2026-09-16'} })),
    ]
    data.indicator_metadata = [{indicator_id:'voitures_menage',kind:'declared_dimensions',
      allowed_levels:['commune','epci','departement','region'],denominator_semantics:'Ménages recensés',
      axes:['sans_voiture','une_voiture','deux_plus'].map((key,order)=>({name:'detail',key,label:key,order,unit:'%'}))},
      {indicator_id:'raccordement_courbe',axis_kind:'duration_minute',axis_values:axes,
        axis_numeric_values:[0,15,30,45,60,90,120,180,240,300,360],completeness:'dense_complete'}]
    data.named_reference_evidence = [{indicator_id:'raccordement_courbe',id:'commune_bretonne_mediane',
      label:'Commune bretonne médiane',role:'analytical_reference',statistic:'median_routed_communes',unit:'%',
      points:axes.map((axis,index)=>({axis,value:reference[index],observation_period:'2026-09-16',
        status:'measured',provenance:[{...sources[0],source_name:'SQL mobility',revision_hash:'ref-v1'}]}))}]
    const facts = mobilityFacts(data, '53', regionPayload)
    const composition = facts.mobility.indicators.filter((fact)=>fact.key==='voitures_menage')
    const curve = facts.mobility.indicators.filter((fact)=>fact.key==='raccordement_courbe')
    expect(composition.map((fact)=>fact.detail)).toEqual(['sans_voiture','une_voiture','deux_plus'])
    expect(composition.map((fact)=>fact.value)).toEqual(parts)
    expect(curve).toHaveLength(11)
    expect(curve.map((fact)=>fact.value)).toEqual(values)
    expect(facts.mobility.namedTrajectoryReferences).toMatchObject([{
      id:'commune_bretonne_mediane', label:'Commune bretonne médiane',
      statistic:'median_routed_communes', points:axes.map((detail,index)=>({detail,value:reference[index]})),
    }])
    expect(facts.mobility.namedTrajectoryReferences[0]).not.toHaveProperty('territory')
    expect(curve.some((fact)=>fact.key==='raccordement_reference')).toBe(false)
    const content = resolveMobiliteThemeContent(facts)
    const motorisation = content.units.find((unit)=>unit.key==='motorisation')?.sections[0]
    expect(motorisation?.evidence?.kind).toBe('motorisation')
    if (motorisation?.evidence?.kind === 'motorisation') {
      expect(motorisation.evidence.composition.map((item)=>item.fact.detail))
        .toEqual(['sans_voiture','une_voiture','deux_plus'])
      expect(motorisation.evidence.composition.map((item)=>item.fact.value)).toEqual(parts)
    }
    const section = content.units.find((unit)=>unit.key==='offre-transports-commun')?.sections[0]
    expect(section?.evidence?.kind).toBe('public-transport')
    if (section?.evidence?.kind !== 'public-transport') throw new Error('Regional transport content missing')
    const rendered = mount(CahierOffreTransportsFigure, { props: {
      offer: section.evidence.offer, trajectory: section.evidence.trajectory,
      metadata: { axis:'numeric',axisLabels:{x:'Temps (minutes)',y:'Population joignable (%)'},
        ticks:axes.map((detail,index)=>({detail,label:String(index*15)})),
        endpoints:['t0000','t0360'],
        reference:{indicator:'raccordement_reference',territoire:'53',label:'Commune bretonne médiane'},
        marker:{detail:'t0090',label:'90 minutes'} },
    } })
    expect(rendered.find('[data-series="territory"]').exists()).toBe(true)
    expect(rendered.find('[data-series="reference"]').exists()).toBe(false)
    expect(rendered.findAll('.transit-point--territory')).toHaveLength(11)
    expect(rendered.findAll('.transit-point--reference')).toHaveLength(0)
    expect(rendered.find('.transit-legend-reference').exists()).toBe(false)
    expect(rendered.findAll('.transit-point--territory').map((point)=>point.attributes('data-value')))
      .toEqual(values.map(String))
  })
  it('renders the API-selected 73-point mean curve separately from the focal curve and national reference', () => {
    const data = JSON.parse(readFileSync('src/__tests__/fixtures/raccordement-theme-facts-guarded.json', 'utf8'))
    const target = data.territory
    const sourceFactsPayload: Payload = { ...payload, territoires: [{
      territoire: target.territory_id, type: target.territory_type, nom: target.name,
      departement: '35', epci: '243500139', classe_densite_code: data.default_comparison.scope.density_class_code,
    }] }
    const numericAxes = data.indicator_metadata.find((item: any) => item.indicator_id === 'raccordement_courbe').axis_numeric_values
    const facts = mobilityFacts(data, target.territory_id, sourceFactsPayload)
    const compared = applyThemeComparisonApiFacts(facts, data.default_comparison, context)
    const content = resolveMobiliteThemeContent(compared)
    const section = content.units.find((unit) => unit.key === 'offre-transports-commun')?.sections[0]
    expect(section?.evidence?.kind).toBe('public-transport')
    if (section?.evidence?.kind !== 'public-transport') throw new Error('Transport trajectory missing')
    const rendered = mount(CahierOffreTransportsFigure, { props: {
      offer: section.evidence.offer, trajectory: section.evidence.trajectory,
      comparisonTrajectory: section.evidence.comparisonTrajectory,
      metadata: { axis: 'numeric', axisLabels: { x: 'Temps (minutes)', y: 'Population joignable (%)' },
        ticks: numericAxes.filter((minute: number) => minute % 30 === 0).map((minute: number) => ({
          detail: `t${String(minute).padStart(4, '0')}`, label: String(minute),
        })), endpoints: ['t0000', 't0360'], marker: { detail: 't0090', label: '90 minutes' } },
    } })
    expect(rendered.findAll('.transit-point--territory')).toHaveLength(73)
    expect(rendered.findAll('.transit-point--comparison')).toHaveLength(73)
    expect(((rendered.find('[data-series="territory"]').attributes('d') ?? '').match(/L/g) ?? [])).toHaveLength(72)
    expect(((rendered.find('[data-series="comparison"]').attributes('d') ?? '').match(/L/g) ?? [])).toHaveLength(72)
    expect(rendered.find('[data-series="reference"]').exists()).toBe(false)
    expect(rendered.findAll('.transit-point--comparison').map((point) => point.attributes('data-value')))
      .toEqual(data.default_comparison.results[0].mean_curve.points.map((point: any) => String(point.value)))
    expect(rendered.find('.transit-legend-comparison').text()).toContain(context.scope.label)
    expect(rendered.find('.transit-legend-comparison').text()).toContain('Moyenne')
    expect(compared.mobility.namedTrajectoryReferences).toHaveLength(1)
    expect(compared.mobility.namedTrajectoryReferences[0]?.label).not.toBe(context.scope.label)
  })

  it('rejects an incomplete selected mean curve rather than drawing a shrunken cohort', () => {
    const data = JSON.parse(readFileSync('src/__tests__/fixtures/raccordement-theme-facts-guarded.json', 'utf8'))
    const target = data.territory
    const sourceFactsPayload: Payload = { ...payload, territoires: [{
      territoire: target.territory_id, type: target.territory_type, nom: target.name,
      departement: '35', epci: '243500139', classe_densite_code: data.default_comparison.scope.density_class_code,
    }] }
    const facts = mobilityFacts(data, target.territory_id, sourceFactsPayload)
    const incomplete = structuredClone(data.default_comparison)
    incomplete.results.find((item: any) => item.indicator_id === 'raccordement_courbe').mean_curve.points.pop()
    expect(() => applyThemeComparisonApiFacts(facts, incomplete, context))
      .toThrow('Courbe moyenne Mobilité partielle, non mesurée ou désordonnée')
  })
  it('rejects a mean curve whose API-owned scope is absent or contradicts its envelope', () => {
    const data = JSON.parse(readFileSync('src/__tests__/fixtures/raccordement-theme-facts-guarded.json', 'utf8'))
    const target = data.territory
    const sourceFactsPayload: Payload = { ...payload, territoires: [{
      territoire: target.territory_id, type: target.territory_type, nom: target.name,
      departement: '35', epci: '243500139', classe_densite_code: data.default_comparison.scope.density_class_code,
    }] }
    const facts = mobilityFacts(data, target.territory_id, sourceFactsPayload)
    for (const badScope of [{}, { kind: 'density_class', density_class_code: '4', territory_type: 'commune' }]) {
      const changed = structuredClone(data.default_comparison)
      changed.results.find((item: any) => item.indicator_id === 'raccordement_courbe').mean_curve.scope = badScope
      expect(() => applyThemeComparisonApiFacts(facts, changed, context))
        .toThrow('Portée réelle de la courbe moyenne Mobilité invalide')
    }
  })
  it('accepts and preserves a current guarded API scope, statistic, members and all mean points', () => {
    const comparison = JSON.parse(readFileSync('src/__tests__/fixtures/raccordement-indicator-rennes-comparison-guarded.json', 'utf8'))
    const factsFixture = JSON.parse(readFileSync('src/__tests__/fixtures/raccordement-theme-facts-guarded.json', 'utf8'))
    const target = factsFixture.territory
    const sourceFactsPayload: Payload = { ...payload, territoires: [{
      territoire: target.territory_id, type: target.territory_type, nom: target.name,
      departement: '35', epci: '243500139',
      classe_densite_code: comparison.result.mean_curve.scope.density_class_code,
    }] }
    const facts = mobilityFacts(factsFixture, target.territory_id, sourceFactsPayload)
    const compared = applyThemeComparisonApiFacts(facts, comparison, context)
    expect(compared.mobility.selectedTrajectoryComparison).toMatchObject({
      statistic: 'mean', selectedMemberCount: 14, eligibleCount: 14,
      points: comparison.result.mean_curve.points.map((point: any) => expect.objectContaining({
        detail: point.axis, value: point.value,
      })),
    })
  })
  it('adapts actual guarded indicator reads to the production trajectory facts without a static grid', () => {
    const read = JSON.parse(readFileSync('src/__tests__/fixtures/raccordement-indicator-rennes-guarded.json', 'utf8'))
    const comparison = JSON.parse(readFileSync('src/__tests__/fixtures/raccordement-indicator-rennes-comparison-guarded.json', 'utf8'))
    const target = { territoire: '35238', type: 'commune' as const, nom: 'Rennes', departement: '35', epci: null,
      classe_densite_code: comparison.result.mean_curve.scope.density_class_code,
      classe_densite_libelle_public: 'Classe source Rennes' }
    const adapted = validateRaccordementIndicatorRead(read, comparison, target)
    expect(adapted.facts).toHaveLength(read.axis_values.length)
    expect(adapted.referenceFacts).toHaveLength(read.axis_values.length)
    expect(adapted.metadata.axis_values).toEqual(read.axis_values)
    expect(adapted.facts.find((fact) => fact.detail === read.comparison_point)?.value)
      .toBe(read.points.find((point: any) => point.axis === read.comparison_point).value)
    expect(adapted.comparison).toMatchObject({ statistic: 'mean', selectedMemberCount: 14,
      valueAtComparisonPoint: comparison.result.mean, rank: 1, rankSize: 14 })
    const malformed = structuredClone(comparison)
    malformed.result.mean_curve.scope = {}
    expect(() => validateRaccordementIndicatorRead(read, malformed, target))
      .toThrow('Portée ou courbe moyenne raccordement incohérente avec la réponse API')
  })
  it('keeps the API-proven all-zero measured commune curve distinct from missing data', () => {
    const read = JSON.parse(readFileSync('src/__tests__/fixtures/raccordement-indicator-zero-22001-guarded.json', 'utf8'))
    const comparison = JSON.parse(readFileSync('src/__tests__/fixtures/raccordement-indicator-zero-22001-comparison-guarded.json', 'utf8'))
    const target = { territoire: read.territory.id, type: 'commune' as const, nom: read.territory.name,
      departement: '22', epci: null, classe_densite_code: comparison.scope.density_class_code,
      classe_densite_libelle_public: 'Classe publiée' }
    const adapted = validateRaccordementIndicatorRead(read, comparison, target)
    expect(adapted.facts).toHaveLength(73)
    expect(adapted.facts.every((fact) => fact.value === 0 && fact.observation_status === 'measured' &&
      fact.provenance_revisions?.length)).toBe(true)
  })

  it('plots all 73 source-proven model zeros as measured zero facts without an absence claim', () => {
    const response = JSON.parse(readFileSync('src/__tests__/fixtures/raccordement-zero-commune-guarded.json', 'utf8'))
    expect(response.points).toHaveLength(73)
    expect(response.points.every((point: any) => point.status === 'measured' && point.value === 0 &&
      point.missing_reason === 'no_modeled_endpoint_stops' && point.provenance.length > 0)).toBe(true)
    const axisValues = response.axis_numeric_values
    const trajectory = response.points.map((point: any, index: number) => ({ label: point.axis,
      fact: { key: 'raccordement_courbe', detail: point.axis, axisValue: axisValues[index], value: point.value,
        unit: '%', availability: 'complete' as const, provenance: null, comparison: null,
        comparisonBasis: 'territory-mean' as const, reason: null } }))
    const rendered = mount(CahierOffreTransportsFigure, { props: { offer: null, trajectory,
      comparisonTrajectory: null, metadata: { axis: 'numeric', axisLabels: { x: 'Temps (minutes)', y: 'Population joignable (%)' },
        ticks: axisValues.filter((minute: number) => minute % 30 === 0).map((minute: number) => ({
          detail: `t${String(minute).padStart(4, '0')}`, label: String(minute),
        })), endpoints: ['t0000', 't0360'] } } })
    expect(rendered.findAll('.transit-point--territory')).toHaveLength(73)
    expect(((rendered.find('[data-series="territory"]').attributes('d') ?? '').match(/L/g) ?? [])).toHaveLength(72)
    expect(rendered.text()).not.toContain('sans transport')
    expect(rendered.text()).not.toContain('absence de transport')
  })
  it('rejects measured facts without source lineage instead of presenting static provenance', () => {
    const data = response()
    data.indicators[0]!.sources = []
    expect(() => mobilityFacts(data, '22001')).toThrow()
  })
  it('rejects unknown named-reference point statuses', () => {
    const data = response()
    data.named_reference_evidence = [{ indicator_id: 'raccordement_courbe', id: 'median',
      label: 'Median', role: 'analytical_reference', statistic: 'median_routed_communes', unit: '%',
      points: [{ axis: 't0000', observation_period: '2026-09-16', value: null,
        status: 'unexpected_status', provenance: [{ source_id: 'mobilite_snapshot', source_name: 'SQL mobility',
          version: 'sql-v1', reference_date: null, publication_date: null }] }] }]
    expect(() => mobilityFacts(data, '22001')).toThrow(/Point de référence nommée Mobilité/)
  })
  it('rejects malformed provided coordinates instead of silently treating them as scalars', () => {
    const data = response()
    data.indicators[1]!.dimensions.detail = 42
    expect(() => mobilityFacts(data, '22001')).toThrow(/Dimension SQL/)
  })
  it('retains source missingness and never fills absent SQL values from static history', () => {
    const data = response()
    data.readings = []
    data.indicators = []
    const facts = mobilityFacts(data, '22001')
    expect(facts.mobility.indicators).toHaveLength(0)
    expect(facts.mobility.losses.diversityWalkTransit.value).toBeNull()
    expect(mobilityFactsFromThemeApi(payload, '22001', null).mobility.losses.diversityWalkTransit.value).toBeNull()
  })
  it('accepts immutable owned-series lineage using source_name rather than scalar name', () => {
    const lineage = { revision_id: 'rev-1', source_id: 'mobilite_snapshot', vintage_id: 'v1',
      source_name: 'SQL mobility', dataset_name: 'Raccordement', version: 'sql-v1',
      reference_date: null, publication_date: null, revision_hash: 'hash-1' }
    const data = { ...response(), indicator_metadata: [{ indicator_id: 'raccordement_courbe',
      axis_kind: 'duration_minute', axis_values: ['20'], axis_numeric_values: [20],
      completeness: 'dense_complete', direction: 'low', descriptor_version: 'series-v1',
      comparison_point: '20', observation_period_kind: 'source_snapshot' }],
      indicators: [...response().indicators, { indicator_id: 'raccordement_courbe', unit: '%', value: 0.6,
        status: 'measured', sources: [{ ...lineage, name: lineage.source_name }],
        dimensions: { axis: '20', numeric_axis_value: 20, observation_period: '2026-09-16' } }] }
    expect(mobilityFacts(data, '22001').mobility.indicators
      .find((fact) => fact.key === 'raccordement_courbe')?.provenance?.lineage?.revision_hash).toBe('hash-1')
  })
  it('ignores excluded legacy BPE and building-access evidence on the semantic Mobilité path', () => {
    const data = { ...response(), bpe_profile_evidence: { sources, classes:
      ['acces-pied-tc', 'velo-compense', 'voiture-requise', 'inaccessible-20-minutes'].map(
        (class_key) => ({ class_key, label: class_key, count: 0, universe_count: 0, exemplar: null }),
      ) } }
    const facts = mobilityFacts(data, '22001')
    expect(facts.mobility.bpeAccess).toMatchObject({ availability: 'absent', profiles: [] })
    expect(facts.mobility.buildingDistribution).toBeNull()
    expect(facts.mobility.accessRamp).toBeNull()
  })
  it('matches a profile comparison only to the same detail and sex facet', () => {
    const data = response()
    data.indicators[1]!.dimensions = { detail: 't_km_1000', sex: 'F' }
    const facts = mobilityFacts(data, '22001')
    const comparisons = { contract: 'theme-comparison-v1', theme_id: 'mobilite', results: [],
      profile_comparisons: [{ indicator: 'reseaux_par_habitant', facet: { detail: 't_km_1000', sex: 'F' },
        status: 'available', direction: 'high', median: 12 }] }
    expect(applyThemeComparisonApiFacts(facts, comparisons, context).mobility.indicators
      .find((fact) => fact.key === 'reseaux_par_habitant')?.comparison?.reference?.value).toBe(12)
    comparisons.profile_comparisons[0]!.facet.sex = 'M'
    expect(applyThemeComparisonApiFacts(facts, comparisons, context).mobility.indicators
      .find((fact) => fact.key === 'reseaux_par_habitant')?.comparison).toBeNull()
  })
  it('never interprets an unspecified comparison direction as more-is-better', () => {
    const facts = mobilityFacts(response(), '22001')
    const comparisons = { contract: 'theme-comparison-v1', theme_id: 'mobilite', profile_comparisons: [],
      results: [{ indicator_id: 'places_stationnement_velo_1000', status: 'available', direction: 'none', median: 12 }] }
    expect(applyThemeComparisonApiFacts(facts, comparisons, context).mobility.indicators
      .find((fact) => fact.key === 'places_stationnement_velo_1000')?.comparison).toBeNull()
  })
})
