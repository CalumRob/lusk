import { describe, expect, it } from 'vitest'
import { applyThemeComparisonApiFacts, mobilityFactsFromThemeApi } from '@/fiche/content/mobilityThemeApiFacts'
import type { TerritoryComparisonContext } from '@/payload/territoryReadModel'
import { metadonneesThemesFixtures, histoiresMobiliteFixture } from '@/payload/fixtures'
import type { Payload } from '@/payload/types'
import { resolveMobiliteThemeContent } from '@/fiche/content/themeContent'
import CahierOffreTransportsFigure from '@/fiche/prototype/CahierOffreTransportsFigure.vue'
import { mount } from '@vue/test-utils'

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

describe('SQL Mobilité response to Variant E facts', () => {
  it('renders the supported regional network and parking facts and names the absent ratio', () => {
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
    data.indicator_metadata = ['reseaux', 'offre_cyclable'].map((indicator_id) => ({
      indicator_id, kind: 'declared_dimensions', allowed_levels: ['commune','epci','departement','region'],
      completeness: 'dense_complete', denominator_semantics: 'Producer-supported regional aggregate',
      axes: data.indicators.filter((row: any) => row.indicator_id === indicator_id).map((row: any, order: number) => ({
        name: 'detail', key: row.dimensions.detail, label: row.dimensions.detail, order, unit: 'km',
      })),
    }))
    const facts = mobilityFactsFromThemeApi(regionPayload, '53', data)
    expect(facts.mobility.indicators.filter((fact) => fact.key === 'reseaux')).toHaveLength(3)
    expect(facts.mobility.indicators.filter((fact) => fact.key === 'offre_cyclable')).toHaveLength(5)
    const content = resolveMobiliteThemeContent(facts)
    const sharing = content.units.find((unit) => unit.key === 'partage-de-lespace-public')!
    const parking = sharing.sections.find((section) => section.key === 'stationnement')!
    expect(parking.evidence?.kind).toBe('sharing-parking')
    if (parking.evidence?.kind !== 'sharing-parking') throw new Error('Regional parking facts missing')
    expect(parking.evidence.bikeSpaces.fact.value).toBe(12)
    expect(parking.evidence.carSpaces.fact.value).toBe(400)
    expect(parking.evidence.bikePerCar.fact.value).toBe(0.91)
  })

  it('consumes scalar, profile and selected-reading wire fields with SQL provenance', () => {
    const facts = mobilityFactsFromThemeApi(payload, '22001', response())
    expect(facts.mobility.indicators.find((fact) => fact.key === 'places_stationnement_velo_1000'))
      .toMatchObject({ value: 123, provenance: { source: 'SQL mobility', referenceDate: null } })
    expect(facts.mobility.indicators.find((fact) => fact.key === 'reseaux_par_habitant'))
      .toMatchObject({ detail: 't_km_1000', value: 456, unit: 'km / 1 000 habitants' })
    expect(facts.mobility.losses.diversityWalkTransit).toMatchObject({ value: 7, unit: 'types' })
    expect(facts.mobility.losses.diversityBike).toMatchObject({ value: 8, unit: 'types' })
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
    const facts = mobilityFactsFromThemeApi(regionPayload,'53',data)
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
      reference: section.evidence.reference,
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
    expect(section.evidence.reference).toEqual([])
  })
  it('rejects measured facts without source lineage instead of presenting static provenance', () => {
    const data = response()
    data.indicators[0]!.sources = []
    expect(() => mobilityFactsFromThemeApi(payload, '22001', data)).toThrow()
  })
  it('rejects unknown named-reference point statuses', () => {
    const data = response()
    data.named_reference_evidence = [{ indicator_id: 'raccordement_courbe', id: 'median',
      label: 'Median', role: 'analytical_reference', statistic: 'median_routed_communes', unit: '%',
      points: [{ axis: 't0000', observation_period: '2026-09-16', value: null,
        status: 'unexpected_status', provenance: [{ source_id: 'mobilite_snapshot', source_name: 'SQL mobility',
          version: 'sql-v1', reference_date: null, publication_date: null }] }] }]
    expect(() => mobilityFactsFromThemeApi(payload, '22001', data)).toThrow(/Point de référence nommée Mobilité/)
  })
  it('rejects malformed provided coordinates instead of silently treating them as scalars', () => {
    const data = response()
    data.indicators[1]!.dimensions.detail = 42
    expect(() => mobilityFactsFromThemeApi(payload, '22001', data)).toThrow(/Dimension SQL/)
  })
  it('retains source missingness and never fills absent SQL values from static history', () => {
    const data = response()
    data.readings = []
    data.indicators = []
    const facts = mobilityFactsFromThemeApi(payload, '22001', data)
    expect(facts.mobility.indicators).toHaveLength(0)
    expect(facts.mobility.losses.diversityWalkTransit.value).toBeNull()
    expect(mobilityFactsFromThemeApi(payload, '22001', null).mobility.losses.diversityWalkTransit.value).toBeNull()
  })
  it('accepts immutable owned-series lineage using source_name rather than scalar name', () => {
    const lineage = { revision_id: 'rev-1', source_id: 'mobilite_snapshot', vintage_id: 'v1',
      source_name: 'SQL mobility', dataset_name: 'Raccordement', version: 'sql-v1',
      reference_date: null, publication_date: null, revision_hash: 'hash-1' }
    const data = { ...response(), indicator_metadata: [{ indicator_id: 'raccordement',
      axis_kind: 'duration_minute', axis_values: ['20'], axis_numeric_values: [20],
      completeness: 'dense_complete', direction: 'low', descriptor_version: 'series-v1',
      comparison_point: '20', observation_period_kind: 'source_snapshot' }],
      indicators: [...response().indicators, { indicator_id: 'raccordement', unit: '%', value: 0.6,
        status: 'measured', sources: [{ ...lineage, name: lineage.source_name }],
        dimensions: { axis: '20', numeric_axis_value: 20, observation_period: '2026-09-16' } }] }
    expect(mobilityFactsFromThemeApi(payload, '22001', data).mobility.indicators
      .find((fact) => fact.key === 'raccordement')?.provenance?.lineage?.revision_hash).toBe('hash-1')
  })
  it('does not manufacture an exemplar for a source-defined empty BPE class', () => {
    const data = { ...response(), bpe_profile_evidence: { sources, classes:
      ['acces-pied-tc', 'velo-compense', 'voiture-requise', 'inaccessible-20-minutes'].map(
        (class_key) => ({ class_key, label: class_key, count: 0, universe_count: 0, exemplar: null }),
      ) } }
    const facts = mobilityFactsFromThemeApi(payload, '22001', data)
    expect(facts.mobility.bpeAccess.profiles[0]).toMatchObject({ count: 0, exemplar: null })
  })
  it('normalizes the deployed open-ended building bucket marker to an unbounded axis', () => {
    const data = response()
    const breadth = ['0', '1-9', '10-24', '25-39', '40-53'].map((key) =>
      ({ key, label: key, min_value: 0, max_value: 10 }))
    const depth = ['0', '1-9', '10-49', '50-199', '200-499', '500+'].map((key, index) =>
      ({ key, label: key, min_value: index * 10, max_value: index === 5 ? 'NA' : index * 10 + 9 }))
    data.building_access = {
      publication_id: 'buildings-v1', availability: 'complete',
      sources: [{ ...sources[0], name: 'SQL mobility' }],
      presentation: {
        building_grid: { mode_label: 'À pied + TC', breadth_axis_label: 'types', depth_axis_label: 'équipements', breadth, depth },
        building_ramp: { modes: { b: 'Vélo', c: 'Voiture', t: 'À pied + TC' }, x_axis_label: 'Bâtiments',
          y_axis_label: 'Types', quantile_labels: Array.from({ length: 11 }, (_, index) => `${index * 10} %`) },
      },
      distribution: breadth.flatMap((breadthBucket) => depth.map((depthBucket) => ({
        breadth_bucket: breadthBucket.key, depth_bucket: depthBucket.key, total_buildings: 10,
        building_count: 1, share: 0.1,
      }))),
      ramp: ['b', 'c', 't'].flatMap((mode) => Array.from({ length: 11 }, (_, index) => ({
        mode, quantile_index: index, quantile: index / 10, accessible_types: index, total_buildings: 10,
      }))),
    }
    const facts = mobilityFactsFromThemeApi(payload, '22001', data)
    expect(facts.mobility.buildingDistribution?.depthBins.at(-1)).toMatchObject({ key: '500+', max: null })
  })
  it('matches a profile comparison only to the same detail and sex facet', () => {
    const data = response()
    data.indicators[1]!.dimensions = { detail: 't_km_1000', sex: 'F' }
    const facts = mobilityFactsFromThemeApi(payload, '22001', data)
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
    const facts = mobilityFactsFromThemeApi(payload, '22001', response())
    const comparisons = { contract: 'theme-comparison-v1', theme_id: 'mobilite', profile_comparisons: [],
      results: [{ indicator_id: 'places_stationnement_velo_1000', status: 'available', direction: 'none', median: 12 }] }
    expect(applyThemeComparisonApiFacts(facts, comparisons, context).mobility.indicators
      .find((fact) => fact.key === 'places_stationnement_velo_1000')?.comparison).toBeNull()
  })
})
