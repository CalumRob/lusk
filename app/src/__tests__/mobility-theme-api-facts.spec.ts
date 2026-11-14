import { describe, expect, it } from 'vitest'
import { applyThemeComparisonApiFacts, mobilityFactsFromThemeApi } from '@/fiche/content/mobilityThemeApiFacts'
import type { TerritoryComparisonContext } from '@/fiche/comparisonContext'
import { contexteMembresSelectionnes } from '@/fiche/comparisonContext'
import { metadonneesThemesFixtures, histoiresMobiliteFixture, metadonneesMobiliteRaccordementFixture } from '@/payload/fixtures'
import type { Payload } from '@/payload/types'
import { resolveMobiliteThemeContent } from '@/fiche/content/themeContent'
import CahierMobiliteRaccordementCurve from '@/fiche/prototype/CahierMobiliteRaccordementCurve.vue'
import { mount } from '@vue/test-utils'
import { nativeReadFixture, nativeResources } from './helpers/semanticApiFixtures'
import { projectRaccordementSemanticComparison } from '../payload/raccordementSemanticProjection'

// Wire fields are producer-owned indicator observations, not storage-family rows.
const sources = [{ source_id: 'mobilite_snapshot', name: 'SQL mobility', version: 'sql-v1',
  reference_date: null, publication_date: null }]
const context: TerritoryComparisonContext = { mode: 'densite', scope: {
  kind: 'communes-densite', label: 'Source-defined group' }, facts: [], buildingDistribution: null, accessRamp: null }
const payload: Payload = {
  territoires: [{ territoire: '22001', type: 'commune', nom: 'Commune', departement: '22', epci: null }],
  indicateurs: [], histoires: histoiresMobiliteFixture, runReport: null,
  vintages: [], programmes: null, themeMetadata: metadonneesThemesFixtures,
}
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

function nativeRaccordementReads(territoryId = '22001', territoryType = 'commune',
  payloadModel: Payload = payload, intent: Record<string, any> = { kind: 'fixed_comparison', context: 'default' }) {
  const curve = nativeResources('mobilite').find((resource) => resource.resource_id === 'raccordement_courbe')!
  const reference = nativeResources('mobilite').find((resource) => resource.resource_id === 'raccordement_reference')!
  const target = { kind: 'territory', type: territoryType, id: territoryId }
  const factsData = nativeReadFixture({ target, intent: { kind: 'facts' } }, curve)
  const comparisonData = nativeReadFixture({ target, intent }, curve)
  const referenceData = nativeReadFixture({ target: { kind: 'named_reference', id: reference.target_ids[0] },
    intent: { kind: 'facts' } }, reference)
  const focal = { theme_id: 'mobilite', resource_reads: [{ resource: curve.resource_id,
    shapes: curve.shapes, declaration: curve, data: factsData }], named_reference_reads: [{
    resource: reference.resource_id, shapes: reference.shapes, declaration: reference, data: referenceData,
  }] }
  const comparison = { theme_id: 'mobilite',
    ...(comparisonData.selection ? { selection: comparisonData.selection } : {}),
    comparison_reads: [{ resource: curve.resource_id, shapes: curve.shapes, declaration: curve, data: comparisonData }] }
  const targetRow = payloadModel.territoires.find((territory) => territory.territoire === territoryId)
  if (!targetRow || targetRow.type !== territoryType) throw new Error(`Missing synthetic territory ${territoryType}/${territoryId}`)
  const enrichedTarget = { ...targetRow,
    ...(typeof comparisonData.scope?.density_class_code === 'string'
      ? { classe_densite_code: comparisonData.scope.density_class_code } : {}) }
  const enrichedPayload = { ...payloadModel,
    territoires: payloadModel.territoires.map((territory) => territory.territoire === territoryId
      ? enrichedTarget : territory) }
  const facts = mobilityFactsFromThemeApi(enrichedPayload, territoryId, focal)
  return { facts, focal, comparison, factsData, comparisonData, referenceData, curve, reference, enrichedPayload }
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
    expect(networks.evidence?.kind).toBe('mobilite-networks')
    if (networks.evidence?.kind !== 'mobilite-networks') throw new Error('Regional per-capita network facts missing')
    expect(networks.evidence.figure.categories.map(({ value }) => value.fact.value)).toEqual([7.5, 2.25, 7.5])
    const parking = sharing.sections.find((section) => section.key === 'stationnement-ravitaillement')!
    expect(parking.evidence?.kind).toBe('mobilite-stationnement-ravitaillement')
    if (parking.evidence?.kind !== 'mobilite-stationnement-ravitaillement') throw new Error('Regional parking facts missing')
    const parkingColumn = parking.evidence.columns[0]
    expect(parkingColumn.bars.categories[0]!.value.fact.value).toBe(12)
    expect(parkingColumn.bars.categories[1]!.value.fact.value).toBe(400)
    expect(parkingColumn.ratio.value.fact.value).toBe(0.91)

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
    const unavailableParking = incompleteSharing.sections.find((section) => section.key === 'stationnement-ravitaillement')!
    if (unavailableParking.evidence?.kind !== 'mobilite-stationnement-ravitaillement') throw new Error('Regional parking section missing')
    const unavailableColumn = unavailableParking.evidence.columns[0]
    expect(unavailableColumn.ratio.value.fact.value).toBeNull()
    expect(unavailableColumn.ratio.value.fact.availability).toBe('absent')
    expect(unavailableColumn.ratio.note).toContain('deux mesures de stationnement')
  })

  it('consumes retained scalar and profile reads with SQL provenance without reviving legacy story values', () => {
    const facts = mobilityFacts(response(), '22001')
    expect(facts.mobility.indicators.find((fact) => fact.key === 'places_stationnement_velo_1000'))
      .toMatchObject({ value: 123, provenance: { source: 'SQL mobility', referenceDate: null } })
    expect(facts.mobility.indicators.find((fact) => fact.key === 'reseaux_par_habitant'))
      .toMatchObject({ detail: 't_km_1000', value: 456, unit: 'km / 1 000 habitants' })
    // #627 - the retired div_loss readings no longer resolve: the MobilityFacts
    // seam carries no losses field to revive.
    expect('losses' in facts.mobility).toBe(false)
  })
  it('keeps the retired Mobility reading unavailable on the actual native resource catalogue', () => {
    const resources = nativeResources('mobilite')
    expect(resources.map((resource) => resource.resource_id)).not.toContain('mobilite_selected_reading')

    const facts = mobilityFactsFromThemeApi(payload, '22001', {
      theme_id: 'mobilite', resource_reads: [],
    })
    // #627 - no reading is fabricated from the retired subgroup declaration:
    // the losses seam itself is gone, and stale rows in the response never
    // revive it through the semantic path.
    expect('losses' in facts.mobility).toBe(false)
    const withStaleRows = mobilityFactsFromThemeApi(payload, '22001', {
      theme_id: 'mobilite', resource_reads: [],
      readings: [{ story_key: 'vingt-minutes-sans-voiture', groupe: 'acces-aux-services', div_loss_t: 3, div_loss_b: 1 }],
    })
    expect('losses' in withStaleRows.mobility).toBe(false)
  })

  it('combines regional motorisation with a synthetic producer-derived curve without rendering its named reference', () => {
    const regionPayload: Payload = { ...payload, territoires: [
      { territoire: '53', type: 'region', nom: 'Bretagne', departement: null, epci: null },
    ] }
    const parts = [0.118268,0.4795024,0.4022296]
    const data = response()
    data.territory = { territory_id: '53', territory_type: 'region', name: 'Bretagne' }
    data.indicators = [
      ...['sans_voiture','une_voiture','deux_plus'].map((detail,index) => ({
        indicator_id:'voitures_menage', unit:'%', status:'measured', value:parts[index],
        sources:[{...sources[0], reference_date:'2023-01-01'}], dimensions:{detail},
      })),
    ]
    data.indicator_metadata = [{indicator_id:'voitures_menage',kind:'declared_dimensions',
      allowed_levels:['commune','epci','departement','region'],denominator_semantics:'Ménages recensés',
      axes:['sans_voiture','une_voiture','deux_plus'].map((key,order)=>({name:'detail',key,label:key,order,unit:'%'}))},
    ]
    const semantic = semanticResponse(data, '53', regionPayload)
    const synthetic = nativeRaccordementReads('53', 'region', regionPayload)
    semantic.resource_reads.push(...synthetic.focal.resource_reads)
    semantic.named_reference_reads.push(...synthetic.focal.named_reference_reads)
    const facts = mobilityFactsFromThemeApi(regionPayload, '53', semantic)
    const composition = facts.mobility.indicators.filter((fact)=>fact.key==='voitures_menage')
    const curve = facts.mobility.indicators.filter((fact)=>fact.key==='raccordement_courbe')
    const axes = synthetic.factsData.axis_values as string[]
    const values = (synthetic.factsData.points as Array<{ value: number }>).map((point) => point.value)
    const reference = synthetic.referenceData.points as Array<{ axis: string; value: number }>
    expect(composition.map((fact)=>fact.detail)).toEqual(['sans_voiture','une_voiture','deux_plus'])
    expect(composition.map((fact)=>fact.value)).toEqual(parts)
    expect(curve).toHaveLength(axes.length)
    expect(curve.map((fact)=>fact.value)).toEqual(values)
    const namedReference = facts.mobility.namedTrajectoryReferences.find((item) =>
      item.id === synthetic.referenceData.reference.id)
    expect(namedReference).toMatchObject({
      id: synthetic.referenceData.reference.id,
      label: synthetic.referenceData.reference.label,
      statistic: synthetic.referenceData.reference.statistic,
      points: reference.map((point) => ({ detail: point.axis, value: point.value })),
    })
    expect(namedReference).not.toHaveProperty('territory')
    expect(curve.some((fact)=>fact.key==='raccordement_reference')).toBe(false)
    const content = resolveMobiliteThemeContent(facts, metadonneesMobiliteRaccordementFixture)
    const sharing = content.units.find((unit)=>unit.key==='partage-de-lespace-public')
    expect(sharing?.sections.map((section)=>section.key)).toEqual(['reseaux', 'stationnement-ravitaillement'])
    expect(JSON.stringify(content)).not.toContain('motorisation')
    expect(content.units.map((unit)=>unit.key)).toEqual([
      'acces-aux-services', 'partage-de-lespace-public', 'offre-transports-commun',
    ])
    const section = content.units.find((unit)=>unit.key==='offre-transports-commun')?.sections[1]
    expect(section?.evidence?.kind).toBe('mobilite-raccordement')
    if (section?.evidence?.kind !== 'mobilite-raccordement') throw new Error('Regional transport content missing')
    const rendered = mount(CahierMobiliteRaccordementCurve, { props: {
      figure: section.evidence, comparison: { status: 'idle' },
    } })
    expect(rendered.find('[data-series="territory"]').exists()).toBe(true)
    expect(rendered.find('[data-series="reference"]').exists()).toBe(false)
    // Every published point flows into the single plotted path; no dot chain.
    expect(rendered.findAll('.mobilite-raccordement-curve__point--territory')).toHaveLength(0)
    expect((((rendered.find('[data-series="territory"]').attributes('d') ?? '').match(/L/g)) ?? []))
      .toHaveLength(axes.length - 1)
    expect(section.evidence.points.map((point) => String(point.fact.value))).toEqual(values.map(String))
    expect(rendered.find('.mobilite-raccordement-curve__comparison').exists()).toBe(false)
  })
  it('renders the producer-derived synthetic mean curve separately from the focal curve and named reference', () => {
    const synthetic = nativeRaccordementReads()
    const contract = synthetic.facts.mobility.trajectoryContract!
    const axes = contract.axisValues
    const compared = applyThemeComparisonApiFacts(synthetic.facts, synthetic.comparison, context)
    const content = resolveMobiliteThemeContent(compared, metadonneesMobiliteRaccordementFixture)
    const section = content.units.find((unit) => unit.key === 'offre-transports-commun')?.sections[1]
    expect(section?.evidence?.kind).toBe('mobilite-raccordement')
    if (section?.evidence?.kind !== 'mobilite-raccordement') throw new Error('Transport trajectory missing')
    const rendered = mount(CahierMobiliteRaccordementCurve, { props: {
      figure: section.evidence, comparison: { status: 'ready' },
    } })
    // Every published point is drawn by the single path; no permanent dot chain.
    expect(rendered.findAll('.mobilite-raccordement-curve__point--territory')).toHaveLength(0)
    expect(rendered.find('.mobilite-raccordement-curve__comparison').exists()).toBe(true)
    expect(((rendered.find('[data-series="territory"]').attributes('d') ?? '').match(/L/g) ?? [])).toHaveLength(axes.length - 1)
    expect(((rendered.find('.mobilite-raccordement-curve__comparison').attributes('d') ?? '').match(/L/g) ?? [])).toHaveLength(axes.length - 1)
    expect(rendered.find('[data-series="reference"]').exists()).toBe(false)
    expect(rendered.get('.mobilite-raccordement-curve__legend').text()).toContain('Groupe comparé')
    const comparisonLegend = rendered.findAll('.mobilite-raccordement-curve__legend button')
      .find((button) => (button.attributes('aria-label') ?? '').includes('Groupe comparé'))!
    expect(comparisonLegend.attributes('aria-label')).toContain(context.scope.label)
    expect(comparisonLegend.attributes('aria-label')).toContain('Moyenne')
    expect(synthetic.factsData.synthetic_fixture).toMatchObject({ publication_parity: false })
    expect(compared.mobility.namedTrajectoryReferences.some((reference) =>
      reference.id === synthetic.referenceData.reference.id)).toBe(true)
    expect(compared.mobility.namedTrajectoryReferences.find((reference) =>
      reference.id === synthetic.referenceData.reference.id)?.label).not.toBe(context.scope.label)
  })

  it('rejects an incomplete selected mean curve rather than drawing a shrunken cohort', () => {
    const synthetic = nativeRaccordementReads()
    const incomplete = structuredClone(synthetic.comparison)
    incomplete.comparison_reads[0]!.data.result.mean_curve.points.pop()
    expect(() => applyThemeComparisonApiFacts(synthetic.facts, incomplete, context))
      .toThrow('Courbe moyenne Mobilité partielle, non mesurée ou désordonnée')
  })
  it('rejects a mean curve whose API-owned scope is absent or contradicts its envelope', () => {
    const synthetic = nativeRaccordementReads()
    for (const badScope of [{}, { kind: 'density_class', density_class_code: '4', territory_type: 'commune' }]) {
      const changed = structuredClone(synthetic.comparison)
      changed.comparison_reads[0]!.data.result.mean_curve.scope = badScope
      expect(() => applyThemeComparisonApiFacts(synthetic.facts, changed, context))
        .toThrow('Portée réelle de la courbe moyenne Mobilité invalide')
    }
  })
  it('accepts a density preset expanded to explicit commune members as an explicit selection, never a published density-class cohort', () => {
    const selection = [
      { territory_type: 'commune' as const, territory_id: '22001' },
      { territory_type: 'commune' as const, territory_id: '22106' },
      { territory_type: 'commune' as const, territory_id: '22215' },
    ]
    const synthetic = nativeRaccordementReads('22001', 'commune', payload,
      { kind: 'selected_comparison', members: selection.map(({ territory_type, territory_id }) =>
        ({ type: territory_type, id: territory_id })) })
    // The density preset resolves to these typed communes; the producer answers
    // the selected_comparison it received, not a producer-pooled density class.
    expect(synthetic.comparisonData.scope).toMatchObject({ kind: 'explicit_selection', member_count: 3 })
    const compared = applyThemeComparisonApiFacts(synthetic.facts, synthetic.comparison, context, selection)
    expect(compared.mobility.selectedTrajectoryComparison).toMatchObject({
      statistic: 'mean', selectedMemberCount: 3, eligibleCount: 3,
      scope: { kind: 'selection', territoryIds: ['22001', '22106', '22215'], label: context.scope.label },
      points: synthetic.comparisonData.result.mean_curve.points.map((point: any) =>
        expect.objectContaining({ detail: point.axis, value: point.value })),
    })
    expect(compared.mobility.selectedTrajectoryComparison?.scope.kind).not.toBe('density_class')
  })
  it('rejects an explicit density selection whose echoed membership or published scope contradicts the request', () => {
    const selection = [
      { territory_type: 'commune' as const, territory_id: '22001' },
      { territory_type: 'commune' as const, territory_id: '22106' },
      { territory_type: 'commune' as const, territory_id: '22215' },
    ]
    const synthetic = nativeRaccordementReads('22001', 'commune', payload,
      { kind: 'selected_comparison', members: selection.map(({ territory_type, territory_id }) =>
        ({ type: territory_type, id: territory_id })) })
    const wrongMember = structuredClone(synthetic.comparison)
    wrongMember.selection[1]!.territory_id = '99999'
    expect(() => applyThemeComparisonApiFacts(synthetic.facts, wrongMember, context, selection))
      .toThrow('Portée réelle de la courbe moyenne Mobilité invalide')
    const densityClaim = structuredClone(synthetic.comparison)
    densityClaim.comparison_reads[0]!.data.result.mean_curve.scope =
      { kind: 'density_class', density_class_code: '4', territory_type: 'commune' }
    expect(() => applyThemeComparisonApiFacts(synthetic.facts, densityClaim, context, selection))
      .toThrow('Portée réelle de la courbe moyenne Mobilité invalide')
    const wrongCount = structuredClone(synthetic.comparison)
    wrongCount.comparison_reads[0]!.data.result.selected_member_count = 4
    wrongCount.comparison_reads[0]!.data.result.mean_curve.selected_member_count = 4
    expect(() => applyThemeComparisonApiFacts(synthetic.facts, wrongCount, context, selection))
      .toThrow()
  })
  it('accepts the declared same-level Bretagne scope for an EPCI fixed theme comparison', () => {
    const epciPayload: Payload = { ...payload, territoires: [
      { territoire: 'E1', type: 'epci', nom: 'EPCI', departement: '22', epci: null },
    ] }
    const synthetic = nativeRaccordementReads('E1', 'epci', epciPayload)
    expect(synthetic.comparisonData.scope).toMatchObject({ kind: 'same_level', territory_type: 'epci' })
    const epciContext: TerritoryComparisonContext = { mode: 'bretagne', scope: {
      kind: 'epcis-bretagne', label: 'EPCI du périmètre de comparaison' }, facts: [],
    buildingDistribution: null, accessRamp: null }
    const compared = applyThemeComparisonApiFacts(synthetic.facts, synthetic.comparison, epciContext)
    expect(compared.mobility.selectedTrajectoryComparison).toMatchObject({
      statistic: 'mean', selectedMemberCount: synthetic.comparisonData.result.selected_member_count,
      eligibleCount: synthetic.comparisonData.result.eligible_count,
      scope: { kind: 'epcis-bretagne', label: 'EPCI du périmètre de comparaison' },
    })
  })
  it('rejects a same-level scope declared for another focal level', () => {
    const epciPayload: Payload = { ...payload, territoires: [
      { territoire: 'E1', type: 'epci', nom: 'EPCI', departement: '22', epci: null },
    ] }
    const synthetic = nativeRaccordementReads('E1', 'epci', epciPayload)
    const wrongLevel = structuredClone(synthetic.comparison)
    wrongLevel.comparison_reads[0]!.data.result.mean_curve.scope.territory_type = 'departement'
    const epciContext: TerritoryComparisonContext = { mode: 'bretagne', scope: {
      kind: 'epcis-bretagne', label: 'EPCI du périmètre de comparaison' }, facts: [],
    buildingDistribution: null, accessRamp: null }
    expect(() => applyThemeComparisonApiFacts(synthetic.facts, wrongLevel, epciContext))
      .toThrow()
  })
  it('projects a synthetic selected scope, mean statistic, membership and complete comparison curve', () => {
    const selection = [
      { territory_type: 'commune', territory_id: '22001' },
      { territory_type: 'commune', territory_id: '35238' },
    ]
    const synthetic = nativeRaccordementReads('22001', 'commune', payload,
      { kind: 'selected_comparison', members: selection.map(({ territory_type, territory_id }) =>
        ({ type: territory_type, id: territory_id })) })
    // #981 — the typed group is its own context; no preset is fabricated.
    const selectedContext = contexteMembresSelectionnes(selection)!
    expect(selectedContext).toMatchObject({ mode: 'custom',
      scope: { kind: 'selection', label: '2 communes sélectionnées' } })
    const compared = applyThemeComparisonApiFacts(synthetic.facts, synthetic.comparison, selectedContext, selection)
    expect(compared.mobility.selectedTrajectoryComparison).toMatchObject({
      statistic: 'mean', selectedMemberCount: selection.length, eligibleCount: selection.length,
      scope: { kind: 'selection', label: '2 communes sélectionnées',
        territoryIds: ['22001', '35238'] },
      points: synthetic.comparisonData.result.mean_curve.points.map((point: any) => expect.objectContaining({
        detail: point.axis, value: point.value,
      })),
    })
  })
  it('names a custom group in the scope of every served comparison without inventing a preset (#981)', () => {
    const selection = [
      { territory_type: 'commune' as const, territory_id: '22001' },
      { territory_type: 'commune' as const, territory_id: '22002' },
      { territory_type: 'commune' as const, territory_id: '22003' },
    ]
    const customContext = contexteMembresSelectionnes(selection)!
    const facts = mobilityFacts(response(), '22001')
    const comparisons = { contract: 'theme-comparison-v1', theme_id: 'mobilite', profile_comparisons: [
      { indicator: 'reseaux_par_habitant', facet: { detail: 't_km_1000', sex: null },
        status: 'available', direction: 'high', median: 12, rank: 1, rank_size: 2 },
    ], results: [{ indicator_id: 'places_stationnement_velo_1000', status: 'available', direction: 'low',
      median: 41, rank: 2, rank_size: 2, rank_ties: 1 }] }
    const compared = applyThemeComparisonApiFacts(facts, comparisons, customContext, selection, [])
    const scalar = compared.mobility.indicators
      .find((fact) => fact.key === 'places_stationnement_velo_1000')!
    expect(scalar.comparison).toMatchObject({
      direction: 'moins-est-mieux',
      scope: { mode: 'custom', kind: 'selection', label: '3 communes sélectionnées' },
      // The served rank population is eligibility (2), never the selection
      // count (3) substituted as a denominator.
      rank: { position: 2, size: 2, ties: 1 },
      reference: { kind: 'median', value: 41 },
    })
    expect(compared.mobility.indicators.find((fact) => fact.key === 'reseaux_par_habitant')?.comparison)
      .toMatchObject({ scope: { mode: 'custom', kind: 'selection', label: '3 communes sélectionnées' },
        rank: { position: 1, size: 2 } })
  })
  it('keeps the API answer for a typed selection when the caller has no presentation context (#981)', () => {
    const selection = [
      { territory_type: 'commune' as const, territory_id: '22001' },
      { territory_type: 'commune' as const, territory_id: '22002' },
    ]
    const facts = mobilityFacts(response(), '22001')
    const comparisons = { contract: 'theme-comparison-v1', theme_id: 'mobilite', profile_comparisons: [],
      results: [{ indicator_id: 'places_stationnement_velo_1000', status: 'available', direction: 'high',
        median: 41, rank: 1, rank_size: 2 }] }
    const compared = applyThemeComparisonApiFacts(facts, comparisons, undefined, selection)
    expect(compared.mobility.indicators
      .find((fact) => fact.key === 'places_stationnement_velo_1000')?.comparison)
      .toMatchObject({ scope: { mode: 'custom', kind: 'selection', label: '2 communes sélectionnées' },
        rank: { position: 1, size: 2 } })
  })
  it('retains a served eligibility smaller than the selected membership on ranked facts (#981)', () => {
    const selection = [
      { territory_type: 'commune' as const, territory_id: '22001' },
      { territory_type: 'commune' as const, territory_id: '22002' },
      { territory_type: 'commune' as const, territory_id: '22003' },
    ]
    const facts = mobilityFacts(response(), '22001')
    const comparisons = { contract: 'theme-comparison-v1', theme_id: 'mobilite', profile_comparisons: [],
      results: [{ indicator_id: 'places_stationnement_velo_1000', status: 'available', direction: 'high',
        median: 41, rank: 2, rank_size: 2 }] }
    const customContext = contexteMembresSelectionnes(selection)!
    const compared = applyThemeComparisonApiFacts(facts, comparisons, customContext, selection)
    const scalar = compared.mobility.indicators
      .find((fact) => fact.key === 'places_stationnement_velo_1000')!
    // 3 membres sélectionnés, 2 territoires éligibles servis : le rang garde
    // le dénominateur d'éligibilité servi, jamais le compte de sélection.
    expect(scalar.comparison?.rank).toEqual({ position: 2, size: 2 })
    expect(customContext.scope).toMatchObject({ label: '3 communes sélectionnées',
      territoryIds: ['22001', '22002', '22003'] })
  })
  it.each([
    {
      label: 'an EPCI and one of its communes',
      requested: [
        { territory_type: 'epci' as const, territory_id: 'synthetic-epci-1' },
        { territory_type: 'commune' as const, territory_id: '22001' },
      ],
      resolved: ['22001', '35238', '35001'],
    },
    {
      label: 'a department and one of its communes',
      requested: [
        { territory_type: 'departement' as const, territory_id: 'synthetic-department-22' },
        { territory_type: 'commune' as const, territory_id: '22001' },
      ],
      resolved: ['22001', '35238', '35001', '29001'],
    },
  ])('projects the API-resolved unique commune count for $label', ({ requested, resolved }) => {
    const synthetic = nativeRaccordementReads()
    const resolvedMembers = resolved.map((id) => ({ type: 'commune', id }))
    const data = nativeReadFixture({ target: { kind: 'territory', type: 'commune', id: '22001' },
      intent: { kind: 'selected_comparison', members: resolvedMembers } }, synthetic.curve)
    const echoedSelection = requested.map((member) => ({ territory_type: member.territory_type,
      territory_id: member.territory_id }))
    // The fake producer resolved its parent/child input to these distinct
    // communes; the API echoes the typed request but publishes the resolved
    // count and the mean calculated over the resolved members.
    data.selection = echoedSelection
    const comparison = { theme_id: 'mobilite', selection: echoedSelection,
      comparison_reads: [{ resource: synthetic.curve.resource_id, shapes: synthetic.curve.shapes,
        declaration: synthetic.curve, data }] }
    const projected = projectRaccordementSemanticComparison(synthetic.focal as any, comparison as any,
      payload.territoires[0]!, requested)

    expect(projected).toMatchObject({ selectedMemberCount: resolved.length, eligibleCount: resolved.length,
      rankSize: resolved.length, scope: { kind: 'explicit_selection', member_count: resolved.length } })
    expect(data.synthetic_fixture).toMatchObject({ kind: 'synthetic_test_fixture', publication_parity: false })
  })
  it('plots a synthetic measured zero without changing its status into an absence claim', () => {
    const synthetic = nativeRaccordementReads()
    const contract = synthetic.facts.mobility.trajectoryContract!
    const axis = contract.axisValues[0]!
    const zero = synthetic.facts.mobility.indicators.find((fact) =>
      fact.key === 'raccordement_courbe' && fact.detail === axis)!
    expect(zero).toMatchObject({ value: 0, availability: 'complete', reason: null,
      provenance: { sourceId: synthetic.curve.sources[0] } })
    const content = resolveMobiliteThemeContent(synthetic.facts, metadonneesMobiliteRaccordementFixture)
    const section = content.units.find((unit) => unit.key === 'offre-transports-commun')?.sections[1]
    expect(section?.evidence?.kind).toBe('mobilite-raccordement')
    if (section?.evidence?.kind !== 'mobilite-raccordement') throw new Error('Synthetic curve missing')
    const rendered = mount(CahierMobiliteRaccordementCurve, { props: {
      figure: section.evidence, comparison: { status: 'idle' },
    } })
    expect(rendered.findAll('.mobilite-raccordement-curve__point--territory')).toHaveLength(0)
    expect(rendered.find('[data-series="territory"]').exists()).toBe(true)
    expect(((rendered.find('[data-series="territory"]').attributes('d') ?? '').match(/L/g) ?? [])
      .length).toBe(contract.axisValues.length - 1)
    expect(rendered.text()).not.toContain('sans transport')
    expect(rendered.text()).not.toContain('absence de transport')
    expect(synthetic.factsData.synthetic_fixture).toMatchObject({ publication_parity: false })
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
      points: [{ axis: 't0000', observation_period: 'synthetic-test-period', value: null,
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
    data.indicators = []
    const facts = mobilityFacts(data, '22001')
    expect(facts.mobility.indicators).toHaveLength(0)
    // #627 - with no SQL values, nothing fills from the committed history:
    // the retired losses seam is gone entirely.
    expect('losses' in facts.mobility).toBe(false)
    expect(mobilityFactsFromThemeApi(payload, '22001', null).mobility.indicators).toHaveLength(0)
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
        dimensions: { axis: '20', numeric_axis_value: 20, observation_period: 'synthetic-test-period' } }] }
    expect(mobilityFacts(data, '22001').mobility.indicators
      .find((fact) => fact.key === 'raccordement_courbe')?.provenance?.lineage?.revision_hash).toBe('hash-1')
  })
  it('ignores excluded legacy BPE and building-access evidence on the semantic Mobilité path', () => {
    // #627 - the excluded envelopes are no longer parsed at all: even a
    // response that carries them resolves no retired evidence field.
    const data = { ...response(), bpe_profile_evidence: { sources, classes:
      ['acces-pied-tc', 'velo-compense', 'voiture-requise', 'inaccessible-20-minutes'].map(
        (class_key) => ({ class_key, label: class_key, count: 0, universe_count: 0, exemplar: null }),
      ) },
      building_access: { publication_id: 'legacy', availability: 'complete', sources,
        distribution: [], ramp: [], presentation: { building_grid: {}, building_ramp: {} } } }
    const facts = mobilityFacts(data, '22001')
    expect(facts.mobility.indicators).toHaveLength(2)
    expect('bpeAccess' in facts.mobility).toBe(false)
    expect('buildingDistribution' in facts.mobility).toBe(false)
    expect('accessRamp' in facts.mobility).toBe(false)
  })
  it('matches a profile comparison only to the same detail and sex facet', () => {
    const data = response()
    data.indicators[1]!.dimensions = { detail: 't_km_1000', sex: 'F' }
    const facts = mobilityFacts(data, '22001')
    const comparisons = { contract: 'theme-comparison-v1', theme_id: 'mobilite', results: [],
      profile_comparisons: [{ indicator: 'reseaux_par_habitant', facet: { detail: 't_km_1000', sex: 'F' },
        status: 'available', direction: 'high', median: 12 }] }
    expect(applyThemeComparisonApiFacts(facts, comparisons, context, undefined, []).mobility.indicators
      .find((fact) => fact.key === 'reseaux_par_habitant')?.comparison?.reference?.value).toBe(12)
    comparisons.profile_comparisons[0]!.facet.sex = 'M'
    expect(applyThemeComparisonApiFacts(facts, comparisons, context, undefined, []).mobility.indicators
      .find((fact) => fact.key === 'reseaux_par_habitant')?.comparison).toBeNull()
  })
  it('keeps an EPCI member group on its declared median profile comparison', () => {
    const epciSelection = [{ territory_type: 'epci' as const, territory_id: '200027027' }]
    const context = contexteMembresSelectionnes(epciSelection)!
    const comparisons = { contract: 'theme-comparison-v1', theme_id: 'mobilite', results: [],
      profile_comparisons: [{ indicator: 'reseaux_par_habitant', facet: { detail: 't_km_1000', sex: null },
        status: 'available', direction: 'high', median: 5, rank: 1, rank_size: 2 }] }
    const compared = applyThemeComparisonApiFacts(mobilityFacts(response(), '22001'), comparisons,
      context, epciSelection)
    expect(compared.mobility.indicators
      .find((fact) => fact.key === 'reseaux_par_habitant' && fact.detail === 't_km_1000')
      ?.comparison?.reference).toEqual({ kind: 'median', value: 5 })
  })

  it('never interprets an unspecified comparison direction as more-is-better', () => {
    const facts = mobilityFacts(response(), '22001')
    const comparisons = { contract: 'theme-comparison-v1', theme_id: 'mobilite', profile_comparisons: [],
      results: [{ indicator_id: 'places_stationnement_velo_1000', status: 'available', direction: 'none', median: 12 }] }
    expect(applyThemeComparisonApiFacts(facts, comparisons, context).mobility.indicators
      .find((fact) => fact.key === 'places_stationnement_velo_1000')?.comparison).toBeNull()
  })
})
