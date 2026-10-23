import { describe, expect, it } from 'vitest'
import { histoiresDemographieNuage, histoiresMilieuxDuNuage, lignesAvecComparaisonApi, semanticComparisonForTheme,
  themeFactsEnvelopeFromSemantic, themeFactsRowsFromApi, themeFactsRowsFromSemantic, validerReponseComparaisonTheme } from '../payload/themeFactsAdapter'
import type { ThemeSelectionMember } from '../payload/themeAcquisition'

const cible = { territoire: '35238', type: 'commune' as const }

function faitsHabitat(champs: Record<string, unknown> = {}) {
  return {
    contract: 'theme-facts-v1', complete_theme: false, theme_id: 'habitat',
    territory: { territory_id: '35238', name: 'Saint-Jacques', territory_type: 'commune' },
    content_version: 'habitat-scalar-v1', reference_content_version: 'territories-v1',
    profile_content_version: 'habitat-profile-v1',
    indicator_metadata: [], named_reference_evidence: [],
    indicators: [], readings: [],
    ...champs,
  }
}

function faitsMilieux(champs: Record<string, unknown> = {}) {
  return { ...faitsHabitat(), theme_id: 'milieux', ...champs }
}

const sources = () => [{
  source_id: 'habitat_api', name: 'Source API habitat', vintage_id: 'api-v1', version: 'api-v1',
  reference_date: null, publication_date: null,
}]

describe('themeFactsAdapter — le contrat theme-facts-v1 en lignes de fiche (#627)', () => {
  it('attache uniquement les rangs disponibles de la comparaison API sans modifier les valeurs focales', () => {
    const row = { territoire: '35238', type: 'commune' as const, theme: 'habitat' as const, key: 'part_passoires', detail: null,
      vintage_source: '', vintage_version: '', vintage_date_reference: null, vintage_date_publication: null,
      value: 0.2, unit: '%', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null }
    const result = lignesAvecComparaisonApi([row], { results: [{ indicator_id: 'part_passoires', status: 'available', direction: 'low', rank: 3, rank_size: 14 }], profile_comparisons: [] }, 'Densité')
    expect(result[0]).toMatchObject({ value: 0.2, rang_epci: null, comparaisonApi: { rang: 3, taille: 14, portee: 'Densité' } })
    expect(lignesAvecComparaisonApi([row], { results: [{ indicator_id: 'part_passoires', status: 'unavailable', direction: 'low', rank: 3, rank_size: 14 }], profile_comparisons: [] }, null)[0]?.comparaisonApi).toBeUndefined()
    expect(lignesAvecComparaisonApi([row], null, null)[0]?.comparaisonApi).toBeUndefined()
    expect(() => lignesAvecComparaisonApi([row], { results: {}, profile_comparisons: [] }, null)).toThrow()
  })

  it('attaches an ordered-series comparison only to its producer-declared comparison axis', () => {
    const rows = ['2024', '2025'].map((axis) => ({ territoire: cible.territoire, type: 'commune' as const,
      theme: 'programmes' as const, key: 'subventions_annuelles', detail: null, dimension: axis,
      value: axis === '2024' ? 100 : 200, unit: '€', vintage_source: 'Source', vintage_version: 'v1',
      vintage_date_reference: '2025-01-01', vintage_date_publication: null,
      rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null }))
    const result = lignesAvecComparaisonApi(rows, { results: [{ indicator_id: 'subventions_annuelles',
      source_facet: '2025', status: 'available', direction: 'high', rank: 2, rank_size: 14 }], profile_comparisons: [] }, 'Densité')
    expect(result.find((row) => row.dimension === '2024')?.comparaisonApi).toBeUndefined()
    expect(result.find((row) => row.dimension === '2025')?.comparaisonApi).toEqual({ rang: 2, taille: 14, portee: 'Densité' })
  })

  it('projects native semantic comparison results onto the fiche rank seam without replacing focal values', () => {
    const response = { theme_id: 'habitat', comparison_reads: [{
      resource: 'part_passoires', shapes: ['scalar'], data: {
        resource: 'part_passoires', target: { kind: 'territory', type: 'commune', id: cible.territoire },
        contract: 'indicator-comparison-v1', indicator_id: 'part_passoires', shape: 'scalar',
        content_version: 'scalar-v1', reference_content_version: 'territories-v1', selection: null,
        scope: { kind: 'density_class', member_count: 14 },
        result: { indicator_id: 'part_passoires', status: 'available', direction: 'low', rank: 3, rank_size: 14 },
      },
    }] }
    validerReponseComparaisonTheme('habitat', response, undefined)
    const comparison = semanticComparisonForTheme(response)
    const row = { territoire: cible.territoire, type: 'commune' as const, theme: 'habitat' as const,
      key: 'part_passoires', detail: null, value: 0.2, unit: '%', vintage_source: '', vintage_version: '',
      vintage_date_reference: null, vintage_date_publication: null, rang_epci: null, rang_epci_n: null,
      rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null }
    expect(lignesAvecComparaisonApi([row], comparison, 'Même classe de densité')[0]).toMatchObject({
      value: 0.2, rang_epci: null, comparaisonApi: { rang: 3, taille: 14, portee: 'Même classe de densité' },
    })
  })

  it('builds a typed cloud from bounded producer facts only inside the API-resolved density scope', () => {
    const focalReads = [
      { resource: 'demographie_selected_reading', shapes: ['typed_reading'], data: {
        resource: 'demographie_selected_reading', target: { kind: 'territory', type: 'commune', id: '1' },
        content_version: 'reading-v1', reference_content_version: 'reference-v1',
        facts: [{ groupe: 'producer-group', source_id: 'insee', vintage_id: '2023', status: 'measured' }],
      } },
      { resource: 'densite', shapes: ['scalar'], data: {
        resource: 'densite', target: { kind: 'territory', type: 'commune', id: '1' }, value: 42,
      } },
    ]
    const response = { theme_id: 'demographie', selection: undefined,
      comparison_reads: [{ resource: 'densite', shapes: ['scalar'], data: {
        resource: 'densite', target: { kind: 'territory', type: 'commune', id: '1' },
        contract: 'indicator-comparison-v1', indicator_id: 'densite', shape: 'scalar',
        content_version: 'scalar-v1', reference_content_version: 'reference-v1', selection: null,
        scope: { kind: 'density_class', territory_type: 'commune', density_class_code: 'D1', member_count: 2 },
        result: { indicator_id: 'densite', status: 'available', direction: 'high', rank: 1, rank_size: 2 },
      } }],
      cohort_reads: [{ resource: 'demographie_selected_reading', shapes: ['typed_reading'], data: {
        resource: 'demographie_selected_reading',
        target: { kind: 'territory_cohort', type: 'commune', department_id: null, epci_id: null },
        content_version: 'reading-v1', reference_content_version: 'reference-v1',
        cohort: { territory_type: 'commune', department_id: null, epci_id: null,
          member_count: 3, reference_content_version: 'reference-v1', members: [
            { id: '1', type: 'commune', name: 'Focal' }, { id: '2', type: 'commune', name: 'Peer' },
            { id: '3', type: 'commune', name: 'Other density' },
          ] },
        territories: [
          { territory: { id: '1', type: 'commune', name: 'Focal' }, facts: [{ groupe: 'producer-group', source_id: 'insee', vintage_id: '2023', status: 'measured', periode: '2020', taux_solde_naturel: 1, taux_solde_migratoire: -1 }] },
          { territory: { id: '2', type: 'commune', name: 'Peer' }, facts: [{ groupe: 'producer-group', source_id: 'insee', vintage_id: '2023', status: 'measured', periode: '2020', taux_solde_naturel: 2, taux_solde_migratoire: -2 }] },
          { territory: { id: '3', type: 'commune', name: 'Other density' }, facts: [{ groupe: 'producer-group', source_id: 'insee', vintage_id: '2023', status: 'measured', periode: '2020', taux_solde_naturel: 99, taux_solde_migratoire: 99 }] },
        ],
      } }],
    }
    const comparison = semanticComparisonForTheme(response, { target: {
      territoire: '1', type: 'commune', classe_densite_code: 'D1',
    }, territories: [
      { territoire: '1', type: 'commune', classe_densite_code: 'D1' },
      { territoire: '2', type: 'commune', classe_densite_code: 'D1' },
      { territoire: '3', type: 'commune', classe_densite_code: 'D2' },
    ] }, focalReads)
    expect(comparison?.scope).toMatchObject({ kind: 'density_class', density_class_code: 'D1', member_count: 2 })
    expect(histoiresDemographieNuage(comparison).map(({ territoire, taux_solde_naturel }) => [territoire, taux_solde_naturel]))
      .toEqual([['1', 1], ['2', 2]])

    const withoutSourceIdentity: any = structuredClone(response)
    delete withoutSourceIdentity.cohort_reads[0]!.data.territories[1]!.facts[0]!.source_id
    const incomplete = semanticComparisonForTheme(withoutSourceIdentity, { target: {
      territoire: '1', type: 'commune', classe_densite_code: 'D1',
    }, territories: [
      { territoire: '1', type: 'commune', classe_densite_code: 'D1' },
      { territoire: '2', type: 'commune', classe_densite_code: 'D1' },
      { territoire: '3', type: 'commune', classe_densite_code: 'D2' },
    ] }, focalReads)
    expect(incomplete?.reading_cloud).toBeUndefined()
  })

  it('does not borrow a typed-reading source label from an unrelated resource', () => {
    const response = { theme_id: 'demographie', resource_reads: [
      { resource: 'densite', shapes: ['scalar'], data: { resource: 'densite',
        target: { kind: 'territory', type: 'commune', id: cible.territoire },
        value: 20, status: 'measured', unit: 'hab/km²', sources: [{ source_id: 'insee', vintage_id: '2023',
          name: 'Unrelated density provenance', version: '2023', reference_date: null, publication_date: null }] } },
      { resource: 'demographie_selected_reading', shapes: ['typed_reading'], data: { resource: 'demographie_selected_reading',
        target: { kind: 'territory', type: 'commune', id: cible.territoire },
        content_version: 'reading-v1', reference_content_version: 'reference-v1',
        facts: [{ groupe: 'producer-group', story_key: 'trajectoire-demographique',
          salience_reason: 'defaut', status: 'measured', periode: '2020', solde_naturel: 1,
          solde_migratoire: 2, taux_solde_naturel: 0.3, taux_solde_migratoire: -0.2,
          classification: 'balanced', rate_unit: '‰/an', source_id: 'insee', vintage_id: '2023' }] } },
    ] }
    const adapted = themeFactsRowsFromSemantic('demographie', response, cible)
    expect(adapted.histoires).toEqual([])
    expect(adapted.unavailableReadings).toEqual(['demographie_selected_reading'])
  })

  it('marks a typed reading unavailable when its own resource has no source identity or evidence', () => {
    const response = { theme_id: 'demographie', resource_reads: [{ resource: 'demographie_selected_reading',
      shapes: ['typed_reading'], data: { resource: 'demographie_selected_reading',
        target: { kind: 'territory', type: 'commune', id: cible.territoire },
        content_version: 'reading-v1', reference_content_version: 'reference-v1',
        facts: [{ groupe: 'producer-group', story_key: 'trajectoire-demographique', salience_reason: 'defaut',
          status: 'measured', periode: '2020', solde_naturel: 1, solde_migratoire: 2,
          taux_solde_naturel: 0.3, taux_solde_migratoire: -0.2, classification: 'balanced', rate_unit: '‰/an' }] } }] }
    const adapted = themeFactsRowsFromSemantic('demographie', response, cible)
    expect(adapted.histoires).toEqual([])
    expect(adapted.unavailableReadings).toEqual(['demographie_selected_reading'])
  })

  it('projects native scalar, declared-profile cells, and ordered-series points with their own axes and evidence', () => {
    const source = [{ source_id: 'dpe', vintage_id: '2025', source_name: 'DPE source', version: '2025',
      reference_date: '2025-01-01', publication_date: null }]
    const adapted = themeFactsRowsFromSemantic('habitat', { resource_reads: [
      { resource: 'part_passoires', shapes: ['scalar'], data: { resource: 'part_passoires',
        target: { kind: 'territory', type: 'commune', id: cible.territoire },
        indicator_id: 'part_passoires', unit: '%', value: 0.42, status: 'measured', sources: source } },
      { resource: 'distribution_dpe', shapes: ['declared_profile'], data: { resource: 'distribution_dpe',
        target: { kind: 'territory', type: 'commune', id: cible.territoire }, content_version: 'profile-v1',
        descriptor: { indicator_id: 'distribution_dpe', unit: '%', axes: [{ name: 'detail', key: 'A' }] },
        observations: [{ detail: 'A', value: 0.25, status: 'measured', unit: '%', sources: source }] } },
      { resource: 'prix_m2', shapes: ['ordered_series'], data: { resource: 'prix_m2',
        target: { kind: 'territory', type: 'commune', id: cible.territoire }, publication_id: 'series-v1',
        reference_content_version: 'territories-v1', indicator_id: 'prix_m2', axis_kind: 'year',
        axis_values: ['2024', '2025'], axis_numeric_values: [2024, 2025], unit: '€/m²',
        points: [{ axis: '2024', observation_period: '2024', value: 3000, status: 'measured', provenance: source },
          { axis: '2025', observation_period: '2025', value: null, status: 'missing', missing_reason: 'not_published', provenance: source }] } },
    ] }, cible)
    expect(adapted.indicateurs.map((row) => [row.key, row.detail, row.value, row.observation_status])).toEqual([
      ['part_passoires', null, 0.42, 'measured'], ['distribution_dpe', 'A', 0.25, 'measured'],
      ['prix_m2', '2024', 3000, 'measured'], ['prix_m2', '2025', null, 'missing'],
    ])
    expect(adapted.indicateurs.every((row) => row.fact_sources?.[0]?.source === 'DPE source')).toBe(true)
  })

  it('retains the named-reference target and joins its publication to the matching owner series', () => {
    const source = [{ source_id: 'gtfs', vintage_id: '2026', source_name: 'GTFS source', version: '2026',
      reference_date: null, publication_date: null }]
    const response = { resource_reads: [{ resource: 'raccordement_courbe', shapes: ['ordered_series'], data: {
      resource: 'raccordement_courbe', target: { kind: 'territory', type: 'commune', id: cible.territoire },
      dataset_id: 'raccordement_courbe', publication_id: 'series-v1', reference_content_version: 'territories-v1',
      indicator_id: 'raccordement_courbe', unit: '%', axis_kind: 'duration_minute', axis_values: ['0'],
      axis_numeric_values: [0], completeness: 'dense_complete', descriptor_version: 'curve-v1',
      comparison_point: '0', comparison_contract: { statistic: 'mean', scope: 'selected_group' },
      points: [{ axis: '0', observation_period: '2026-01-01', value: 1, status: 'measured', provenance: source }],
      named_references: [],
    } }], named_reference_reads: [{ resource: 'raccordement_reference', shapes: ['named_reference'], data: {
      resource: 'raccordement_reference', target: { kind: 'named_reference', id: 'bretagne-reference' },
      dataset_id: 'raccordement_courbe', publication_id: 'series-v1', reference_content_version: 'territories-v1',
      indicator_id: 'raccordement_reference', unit: '%', reference: { id: 'bretagne-reference', label: 'Bretagne',
        role: 'analytical_reference', statistic: 'mean', required: true },
      points: [{ axis: '0', observation_period: '2026-01-01', value: 2, status: 'measured', provenance: source }],
    } }] }
    const normalized = themeFactsEnvelopeFromSemantic('mobilite', response as any, cible)
    expect(normalized.named_reference_evidence).toEqual([expect.objectContaining({
      indicator_id: 'raccordement_courbe', id: 'bretagne-reference', role: 'analytical_reference',
      points: [expect.objectContaining({ axis: '0', value: 2, provenance: [expect.objectContaining({ source_name: 'GTFS source' })] })],
    })])
    const invalid = structuredClone(response)
    invalid.named_reference_reads[0]!.data.publication_id = 'stale-series-v0'
    expect(() => themeFactsEnvelopeFromSemantic('mobilite', invalid as any, cible)).toThrow(/Dépendance.*incompatible/)
  })

  it('associe les comparaisons de profil à la même facette', () => {
    const row = { territoire: '35238', type: 'commune' as const, theme: 'habitat' as const, key: 'structure_age', detail: 'ancien', sex: 'F' as const,
      vintage_source: '', vintage_version: '', vintage_date_reference: null, vintage_date_publication: null,
      value: 0.4, unit: '%', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null }
    const comparison = { results: [], profile_comparisons: [{ indicator: 'structure_age', facet: { detail: 'ancien', sex: 'M' }, status: 'available', direction: 'high', rank: 1, rank_size: 10 }] }
    expect(lignesAvecComparaisonApi([row], comparison, null)[0]?.comparaisonApi).toBeUndefined()
  })
  it('projette les adhésions ancrées et les subventions depuis leurs collections/séries sans inventer absence', () => {
    // Trimmed served capture: E:/Temp/opencode/lusk-live-captured/programmes-facts.json;
    // period_detail omits relationships in the live theme-facts-v1 contract.
    const source = [{ source_id: 'src', name: 'Source programmes', version: '2026', reference_date: '2026-01-01', publication_date: null }]
    const rows = themeFactsRowsFromApi('programmes', {
      contract: 'theme-facts-v1', theme_id: 'programmes', territory: { territory_id: '35238', territory_type: 'commune' },
      indicators: [], indicator_metadata: [], named_reference_evidence: [], readings: [],
      collections: [
        { indicator_id: 'programme_membership', kind: 'anchored_membership', availability: 'observed',
          entries: [{ detail: 'ACV', rider: 'Aid rider', sources: source }],
          relationships: [{ detail: 'CRTE', rider: null, sources: source, anchor: { id: '243500139', type: 'epci', name: 'EPCI' }, relation: 'covering_parent' }] },
        { indicator_id: 'grants', kind: 'period_detail', availability: 'observed', unit: '€', entries: [
          { observation_period: '2025', label: 'Mobilité', value: 1234, sources: source },
        ] },
      ],
      owned_series: [{ indicator_id: 'subventions_annuelles', unit: '€', points: [
        // The live owned-series contract names this field `source_name`;
        // collection provenance uses `name`.
        { axis: '2025', value: 5678, status: 'measured', provenance: source.map(({ name, ...item }) => ({ ...item, source_name: name })) },
      ] }],
    }, cible)
    expect(rows.histoires).toEqual([])
    expect(rows.indicateurs.map((row) => [row.territoire, row.key, row.detail, row.dimension, row.value])).toEqual([
      ['35238', 'couverture_programmes', 'ACV', undefined, null],
      ['243500139', 'couverture_programmes', 'CRTE', undefined, null],
      ['35238', 'subventions_par_domaine', 'Mobilité', '2025', 1234],
      ['35238', 'subventions_annuelles', null, '2025', 5678],
    ])
    expect(rows.indicateurs[0]!.rider).toBe('convention valant ORT')
    expect(rows.indicateurs[0]!.vintage_date_reference).toBe('2026-01-01')
    const absent = themeFactsRowsFromApi('programmes', {
      contract: 'theme-facts-v1', theme_id: 'programmes', territory: { territory_id: '35238', territory_type: 'commune' },
      indicators: [], indicator_metadata: [], named_reference_evidence: [], readings: [],
      collections: [{ indicator_id: 'programme_membership', kind: 'anchored_membership', availability: 'no_record', entries: [], relationships: [] }],
      owned_series: [],
    }, cible)
    expect(absent.indicateurs).toEqual([])
  })

  it('projette le total parent de même année depuis le contexte servi (capture live programmes-facts.json)', () => {
    const provenance = [{ revision_id: 'r1', source_id: 'subventions_scdl', source_name: 'Source subventions', name: 'Source subventions',
      version: '2026-08-05', reference_date: '2026-08-05', publication_date: '2026-08-05' }]
    const response = { contract: 'theme-facts-v1', theme_id: 'programmes', territory: { territory_id: '35238', territory_type: 'commune' },
      indicators: [{ indicator_id: 'subventions_annuelles', value: 71395030.98, status: 'measured', unit: '€', sources: provenance,
        dimensions: { axis: '2025', observation_period: '2025' } }],
      indicator_metadata: [{ indicator_id: 'subventions_annuelles', unit: '€', context: { parent: { id: '243500139', type: 'epci', name: 'Rennes Métropole' },
        points: [{ axis: '2025', observation_period: '2025', value: 91260697.91, status: 'measured', provenance }] } }],
      named_reference_evidence: [], readings: [], collections: [], owned_series: [] }
    const rows = themeFactsRowsFromApi('programmes', response, cible, { epci: '243500139' }).indicateurs
    expect(rows.find((row) => row.territoire === '243500139')).toMatchObject({ type: 'epci', key: 'subventions_annuelles', dimension: '2025', value: 91260697.91, vintage_source: 'Source subventions' })
    const incoherent = themeFactsRowsFromApi('programmes', { ...response, indicator_metadata: [{ ...response.indicator_metadata[0], context: {
      parent: { id: 'other', type: 'epci' }, points: response.indicator_metadata[0]!.context.points } }] }, cible, { epci: '243500139' }).indicateurs
    expect(incoherent.some((row) => row.type === 'epci' && row.key === 'subventions_annuelles')).toBe(false)
  })

  it('échoue fermé sur date de référence absente pour une adhésion', () => {
    expect(() => themeFactsRowsFromApi('programmes', {
      contract: 'theme-facts-v1', theme_id: 'programmes', territory: { territory_id: '35238', territory_type: 'commune' },
      indicators: [], indicator_metadata: [], named_reference_evidence: [], readings: [], owned_series: [],
      collections: [{ indicator_id: 'membership', kind: 'anchored_membership', availability: 'observed', entries: [
        { detail: 'ACV', rider: null, sources: [{ source_id: 's', name: 'S', version: 'v', reference_date: null, publication_date: null }] },
      ], relationships: [] }],
    }, cible)).toThrow(/Date de référence/)
  })

  it('mappe la lecture démographique avec provenance et rejette story/salience/taux incohérents', () => {
    const response = { ...faitsHabitat({ theme_id: 'demographie' }), readings: [{
      groupe: 'trajectoire-demographique', story_key: 'trajectoire-demographique', salience_reason: 'defaut',
      periode: '2020', solde_naturel: 1, solde_migratoire: 2, taux_solde_naturel: 0.3, taux_solde_migratoire: -0.2,
      classification: 'balanced', status: 'measured', rate_unit: '‰', provenance: {
        source_id: 's', source_name: 'Insee', source_version: '2026', source_reference_date: null, source_publication_date: null,
      },
    }] }
    const histoire = themeFactsRowsFromApi('demographie', response, cible).histoires[0] as any
    expect([histoire.periode, histoire.taux_solde_naturel, histoire.vintage_source]).toEqual(['2020', 0.3, 'Insee'])
    for (const patch of [{ story_key: 'bad' }, { salience_reason: 'bad' }, { taux_solde_naturel: null }]) {
      expect(() => themeFactsRowsFromApi('demographie', { ...response, readings: [{ ...response.readings[0], ...patch }] }, cible)).toThrow()
    }
  })
  it('ne fabrique aucun point si la comparaison ne déclare pas de cloud', () => {
    expect(histoiresDemographieNuage({ reading_cloud: null })).toEqual([])
    expect(histoiresDemographieNuage({ reading_cloud: { status: 'available', story_key: 'trajectoire-demographique',
      groupe: 'g', points: [{ territory: { territory_id: '1', territory_type: 'commune', name: 'T' },
        periode: null, taux_solde_naturel: null, taux_solde_migratoire: 2 }] } })).toEqual([])
  })
  it('refuse une réponse dont le contrat, le thème ou le territoire ne correspondent pas', () => {
    expect(() => themeFactsRowsFromApi('habitat', { contract: 'autre' }, cible)).toThrow(/contrat|Réponse/i)
    expect(() => themeFactsRowsFromApi('habitat', faitsHabitat({ theme_id: 'milieux' }), cible)).toThrow()
    expect(() => themeFactsRowsFromApi('habitat',
      faitsHabitat({ territory: { territory_id: '22001', territory_type: 'commune' } }), cible)).toThrow(/Territoire/)
    expect(() => themeFactsRowsFromApi('habitat',
      faitsHabitat({ territory: { territory_id: '35238', territory_type: 'epci' } }), cible)).toThrow(/Territoire/)
  })

  it('mappe scalaire, cellule de profil et point de série en lignes du même grain que le modèle', () => {
    const rows = themeFactsRowsFromApi('habitat', faitsHabitat({
      indicators: [
        { indicator_id: 'part_passoires', label: 'part_passoires', unit: '%', value: 0.42, status: 'measured',
          dimensions: {}, sources: sources() },
        { indicator_id: 'distribution_dpe', label: 'distribution_dpe', unit: '%', value: 0.05, status: 'measured',
          dimensions: { detail: 'A' }, sources: sources() },
        { indicator_id: 'prix_m2', label: 'prix_m2', unit: '€/m²', value: 4242, status: 'measured',
          dimensions: { axis: '2025', numeric_axis_value: 2025 }, sources: sources() },
      ],
    }), cible)
    expect(rows.indicateurs.map((row) => [row.key, row.detail, row.value])).toEqual([
      ['part_passoires', null, 0.42],
      ['distribution_dpe', 'A', 0.05],
      ['prix_m2', '2025', 4242],
    ])
    // Les colonnes de rang héritées restent null : le contrat de compatibilité
    // retiré ne se repeuple jamais depuis une portée déclarée différente.
    expect(rows.indicateurs.every((row) => row.rang_epci === null && row.rang_reg === null &&
      row.rang_dep === null && row.rang_epci_n === null)).toBe(true)
    expect(rows.indicateurs.every((row) => row.vintage_source === 'Source API habitat' &&
      row.vintage_version === 'api-v1')).toBe(true)
  })

  it('projette les prix DVF publiés en détails annuels et conserve le scalaire groupé', () => {
    // Capture live : habitat-facts.json, commune de Rennes (35238). La réponse
    // live observée ne portait que le scalaire; la série jointe est le contrat servi.
    const rows = themeFactsRowsFromApi('habitat', faitsHabitat({
      indicators: [{ indicator_id: 'prix_m2', label: 'Prix au m²', unit: '€/m²', value: 3819.44,
        status: 'measured', dimensions: {}, sources: sources() }],
      owned_series: [{ indicator_id: 'prix_m2', unit: '€/m²', points: [
        { axis: '2024', value: 3700, status: 'measured', provenance: [{ source_id: 's', source_name: 'DVF', version: '2025', reference_date: null, publication_date: null }] },
        { axis: '2025', value: 3819.44, status: 'measured', provenance: [{ source_id: 's', source_name: 'DVF', version: '2025', reference_date: null, publication_date: null }] },
      ] }],
    }), cible)
    expect(rows.indicateurs.map((row) => [row.key, row.detail, row.value, row.unit])).toEqual([
      ['prix_m2', null, 3819.44, '€/m²'], ['prix_m2', '2024', 3700, '€/m²'], ['prix_m2', '2025', 3819.44, '€/m²'],
    ])
    expect(themeFactsRowsFromApi('habitat', faitsHabitat({ indicators: [{ indicator_id: 'prix_m2', label: 'Prix',
      unit: '€/m²', value: 3819.44, status: 'measured', dimensions: {}, sources: sources() }] }), cible)
      .indicateurs).toHaveLength(1)
  })

  it('refuse une coordonnée de détail non déclarée par les métadonnées du contrat', () => {
    expect(() => themeFactsRowsFromApi('habitat', faitsHabitat({
      indicator_metadata: [{ indicator_id: 'distribution_dpe', axes: [{ name: 'detail', key: 'A' }] }],
      indicators: [
        { indicator_id: 'distribution_dpe', label: 'distribution_dpe', unit: '%', value: 0.05,
          status: 'measured', dimensions: { detail: 'Z' }, sources: sources() },
      ],
    }), cible)).toThrow(/déclarée/)
  })

  it('rend l’absence déclarée honnêtement : statut non mesuré → valeur null, jamais un nombre inventé', () => {
    const rows = themeFactsRowsFromApi('habitat', faitsHabitat({
      indicators: [
        { indicator_id: 'prix_m2', label: 'prix_m2', unit: '€/m²', value: null, status: 'suppressed',
          dimensions: { axis: '2021' }, sources: sources() },
      ],
    }), cible)
    expect(rows.indicateurs[0]!.value).toBeNull()
    expect(rows.indicateurs[0]!.rider).toBe('suppressed')
    expect(rows.indicateurs[0]!.observation_status).toBe('missing')
    expect(() => themeFactsRowsFromApi('habitat', faitsHabitat({
      indicators: [
        { indicator_id: 'part_passoires', label: 'part_passoires', unit: '%', value: null, status: 'measured',
          dimensions: {}, sources: sources() },
      ],
    }), cible)).toThrow(/mesurée absente/)
  })

  it('refuse une provenance absente ou mal formée', () => {
    expect(() => themeFactsRowsFromApi('habitat', faitsHabitat({
      indicators: [
        { indicator_id: 'part_passoires', label: 'part_passoires', unit: '%', value: 0.42, status: 'measured',
          dimensions: {}, sources: [] },
      ],
    }), cible)).toThrow(/Provenance/)
    expect(() => themeFactsRowsFromApi('habitat', faitsHabitat({
      indicators: [
        { indicator_id: 'part_passoires', label: 'part_passoires', unit: '%', value: 0.42, status: 'measured',
          dimensions: {}, sources: [{ source_id: 's', name: 'S', version: '', reference_date: null, publication_date: null }] },
      ],
    }), cible)).toThrow(/Provenance/)
  })

  it('mappe la lecture Habitat typée avec sa provenance, sans jamais inventer les nulls', () => {
    const rows = themeFactsRowsFromApi('habitat', faitsHabitat({
      readings: [{
        groupe: 'etat-energetique-du-parc', story_key: 'etat-energetique-du-parc', salience_reason: 'defaut',
        classification: null, part_passoires: null, part_abc: null, n_dpe: 12,
        status: 'suppressed', source_id: 'habitat_api', vintage_id: 'api-v1',
        provenance: { source_id: 'habitat_api', source_name: 'Source API habitat', vintage_id: 'api-v1',
          source_version: 'api-v1', source_reference_date: null, source_publication_date: null },
      }],
    }), cible)
    const lecture = rows.histoires[0] as unknown as Record<string, unknown>
    expect(lecture.classification).toBeNull()
    expect(lecture.part_passoires).toBeNull()
    expect(lecture.n_dpe).toBe(12)
    expect(lecture.vintage_source).toBe('Source API habitat')
    expect(() => themeFactsRowsFromApi('habitat', faitsHabitat({
      readings: [{
        groupe: 'etat-energetique-du-parc', story_key: 'autre-lecture', salience_reason: 'defaut',
        classification: null, part_passoires: null, part_abc: null, n_dpe: 12,
        status: 'measured', source_id: 'habitat_api', vintage_id: 'api-v1', provenance: {},
      }],
    }), cible)).toThrow(/déclarée/)
    expect(() => themeFactsRowsFromApi('habitat', faitsHabitat({
      readings: [{
        groupe: 'etat-energetique-du-parc', story_key: 'etat-energetique-du-parc', salience_reason: 'defaut',
        classification: null, part_passoires: null, part_abc: null,
        status: 'measured', source_id: 'habitat_api', vintage_id: 'api-v1', provenance: {},
      }],
    }), cible)).toThrow(/Valeurs de lecture/)
  })

  it('refuse les lectures d’un thème non migré plutôt que de les perdre en silence', () => {
    // Mobilité est le seul thème hors du registre migré : sa surface de fiche
    // reste la variante E, intégration côté utilisateur.
    expect(() => themeFactsRowsFromApi('mobilite', {
      contract: 'theme-facts-v1', theme_id: 'mobilite',
      territory: { territory_id: '35238', name: 'Saint-Jacques', territory_type: 'commune' },
      content_version: 'v', reference_content_version: 'r',
      indicator_metadata: [], named_reference_evidence: [], indicators: [],
      readings: [{ groupe: 'g', story_key: 's', salience_reason: 'defaut', status: 'measured' }],
    }, cible)).toThrow(/non migré/)
  })

  it('mappe les bins de distribution Mobilité servis et garde les bins absents à null', () => {
    const reading = { groupe: 'acces-aux-services', story_key: 'vingt-minutes-sans-voiture', salience_reason: 'defaut',
      status: 'measured', div_loss_t: 8, div_loss_b: 5, classification_saillance: null, unit: 'types',
      provenance: { source_id: 'mob', source_name: 'Mobilité', source_version: 'v1', source_reference_date: null, source_publication_date: null } }
    const response = { ...faitsHabitat({ theme_id: 'mobilite', readings: [reading] }), density_distribution: {
      status: 'measured', range: { minimum: 2, maximum: 9, status: 'measured' }, points: [
        { ordinal: 0, density: 0.25, density_status: 'measured', decile: 2, decile_status: 'measured' },
        { ordinal: 1, density: null, density_status: 'not_available', decile: null, decile_status: 'not_available' },
      ] } }
    const mapped = themeFactsRowsFromApi('mobilite', response, cible).histoires[0] as unknown as Record<string, unknown>
    expect(mapped).toMatchObject({ dens_min: 2, dens_max: 9, dens_1: .25, dec_1: 2, dens_2: null, dec_2: null })
    const absent = themeFactsRowsFromApi('mobilite', { ...response, density_distribution: undefined }, cible).histoires[0]
    expect(absent).toMatchObject({ dens_min: null, dens_max: null, dens_1: null })
  })

  it('mappe la lecture Milieux et sa provenance sans convertir les absences en zéros', () => {
    const reading = {
      groupe: 'land', story_key: 'se-densifier-setaler-ou-sen-aller', salience_reason: 'defaut', status: 'measured',
      periode_pop: '2017-2023', periode_artif: '2020-2023', delta_population: 10, taux_variation_population: 1.4,
      artif_m2_par_habitant: 8, artif_m3_par_habitant: 9, trajectoire_artif_par_habitant: 1.125,
      classification: 'up', provenance: { source_id: 'rp', source_name: 'RP fixture', source_version: '2023',
        source_reference_date: null, source_publication_date: null },
    }
    const result = themeFactsRowsFromApi('milieux', faitsMilieux({ readings: [reading] }), cible)
    const row = result.histoires[0] as unknown as Record<string, unknown>
    expect(row.taux_variation_population).toBe(1.4)
    expect(row.classification).toBe('up')
    expect(row.vintage_source).toBe('RP fixture')
    expect(themeFactsRowsFromApi('milieux', faitsMilieux({ readings: [{ ...reading, status: 'unavailable',
      periode_pop: null, periode_artif: null, taux_variation_population: null, artif_m2_par_habitant: null,
      artif_m3_par_habitant: null, trajectoire_artif_par_habitant: null, classification: null }] }), cible)
      .histoires[0]).toMatchObject({ periode_artif: null, taux_variation_population: null,
        artif_m2_par_habitant: null, artif_m3_par_habitant: null, classification: null })
    expect(() => themeFactsRowsFromApi('milieux', faitsMilieux({ readings: [{ ...reading, story_key: 'wrong' }] }), cible)).toThrow(/non déclarée/)
    expect(() => themeFactsRowsFromApi('milieux', faitsMilieux({ readings: [{ ...reading, salience_reason: 'invented' }] }), cible)).toThrow(/non déclarée/)
  })

  it('projette uniquement les points du reading cloud dont toutes les coordonnées sont valides', () => {
    const points = histoiresMilieuxDuNuage({ reading_cloud: { status: 'available', groupe: 'land', points: [
      { territory: { territory_id: '35001', territory_type: 'commune' }, periode_pop: '2017-2023',
        periode_artif: '2020-2023', taux_variation_population: 0.8,
        artif_m2_par_habitant: 7, artif_m3_par_habitant: 8 },
      { territory: { territory_id: '35002', territory_type: 'commune' }, periode_pop: null,
        periode_artif: null, taux_variation_population: null,
        artif_m2_par_habitant: 6, artif_m3_par_habitant: 7 },
    ] } })
    expect(points).toHaveLength(1)
    expect(points[0]).toMatchObject({ territoire: '35001', taux_variation_population: 0.8,
      artif_m2_par_habitant: 7, artif_m3_par_habitant: 8 })
  })

  it('valide l’écho de sélection d’une réponse de comparaison dans l’ordre du demandeur', () => {
    const attendue: ThemeSelectionMember[] = [
      { territory_type: 'epci', territory_id: '200000001' },
      { territory_type: 'commune', territory_id: '35238' },
    ]
    const comparaison = (selection: unknown) => ({
      contract: 'theme-comparison-v1', theme_id: 'habitat',
      content_version: 'habitat-scalar-v1', reference_content_version: 'territories-v1',
      selection, results: [], profile_comparisons: [],
    })
    expect(() => validerReponseComparaisonTheme('habitat', comparaison(attendue), attendue)).not.toThrow()
    expect(() => validerReponseComparaisonTheme('habitat', comparaison([]), attendue)).toThrow(/sélection/)
    expect(() => validerReponseComparaisonTheme('habitat',
      comparaison([...attendue].reverse()), attendue)).toThrow(/sélection/)
    expect(() => validerReponseComparaisonTheme('habitat', comparaison(attendue), [])).toThrow(/sélection/)
    expect(() => validerReponseComparaisonTheme('milieux', comparaison(attendue), attendue)).toThrow(/comparaison/)
  })
})
