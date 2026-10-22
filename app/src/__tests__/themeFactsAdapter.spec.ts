import { describe, expect, it } from 'vitest'
import { demographieComparisonForFiche, demographieRowsFromSemantic, histoiresDemographieNuage, histoiresMilieuxDuNuage, lignesAvecComparaisonApi, themeFactsRowsFromApi, validerReponseComparaisonTheme } from '../payload/themeFactsAdapter'
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
  it('uses the discovered typed-reading resource and its declared source for exact registered provenance', () => {
    const sourceRecords = {
      legacy_evolution_source: { dataset: 'Wrong legacy source', vintages: [{ id: 'legacy-vintage', version: 'old', dateReference: '1900', datePublication: null }] },
      story_source_v2: { dataset: 'Declared story dataset', vintages: [{ id: 'story-vintage-v2', version: '2026', dateReference: '2026-01-01', datePublication: '2026-02-01' }] },
    }
    const declaration = { resource_id: 'story_resource_v2', sources: ['story_source_v2'] }
    const response = { contract: 'semantic-demographie-v1', theme_id: 'demographie', reading_resource: declaration, resource_results: [
      { resource: 'densite', target: { type: 'commune', id: cible.territoire }, value: 30, status: 'measured', unit: 'hab/km²', sources: [{
        source_id: 'story_source_v2', name: 'Declared story dataset', version: '2026', reference_date: '2026-01-01', publication_date: '2026-02-01' }] },
      { resource: 'structure_age', target: { type: 'commune', id: cible.territoire }, descriptor: { unit: '%', axes: [] }, observations: [] },
      { resource: 'taille_menages', target: { type: 'commune', id: cible.territoire }, value: 2, status: 'measured', unit: 'personnes', sources: [{
        source_id: 'story_source_v2', name: 'Declared story dataset', version: '2026', reference_date: '2026-01-01', publication_date: '2026-02-01' }] },
      { resource: 'evolution_1968', target: { type: 'commune', id: cible.territoire }, value: 1, status: 'measured', unit: '%', sources: [{
        source_id: 'story_source_v2', name: 'Declared story dataset', version: '2026', reference_date: '2026-01-01', publication_date: '2026-02-01' }] },
      { resource: 'story_resource_v2', target: { type: 'commune', id: cible.territoire }, facts: [{ groupe: 'trajectoire-demographique',
        story_key: 'trajectoire-demographique', salience_reason: 'defaut', periode: '2017-2023', solde_naturel: 1,
        solde_migratoire: 2, taux_solde_naturel: 0.3, taux_solde_migratoire: -0.1, classification: 'stable',
        status: 'measured', source_id: 'story_source_v2', vintage_id: 'story-vintage-v2' }] },
    ] }
    const metadata = { sources: { evolution_1968: 'legacy_evolution_source' }, source_records: sourceRecords }
    const rows = demographieRowsFromSemantic(response, cible, metadata)
    expect(rows.histoires[0]).toMatchObject({ vintage_source: 'Declared story dataset', vintage_version: '2026',
      vintage_date_reference: '2026-01-01', vintage_date_publication: '2026-02-01' })
  })

  it('fails closed when typed-reading identity or returned source is not producer-declared', () => {
    const metadata = { sources: { evolution_1968: 'legacy' }, source_records: {
      declared: { dataset: 'Declared', vintages: [{ id: 'v2', version: '2026', dateReference: null, datePublication: null }] },
      legacy: { dataset: 'Legacy', vintages: [{ id: 'v1', version: 'old', dateReference: null, datePublication: null }] },
    } }
    const declaration = { resource_id: 'declared_story', sources: ['declared'] }
    const read = (resource: string, source_id: string) => ({ contract: 'semantic-demographie-v1', theme_id: 'demographie',
      reading_resource: declaration, resource_results: [
      ...['densite', 'structure_age', 'taille_menages', 'evolution_1968'].map((id) => ({ resource: id,
        target: { type: 'commune', id: cible.territoire }, value: 1, status: 'measured', unit: 'x', sources: [{
          source_id: 'declared', name: 'Declared', version: '2026', reference_date: null, publication_date: null }] })),
      { resource, target: { type: 'commune', id: cible.territoire }, facts: [{ groupe: 'trajectoire-demographique',
        story_key: 'trajectoire-demographique', salience_reason: 'defaut', periode: null, solde_naturel: 0,
        solde_migratoire: 0, taux_solde_naturel: 0, taux_solde_migratoire: 0, classification: 'stable',
        status: 'measured', source_id, vintage_id: 'v2' }] },
    ] })
    expect(() => demographieRowsFromSemantic(read('wrong_story', 'declared'), cible, metadata)).toThrow(/ressource/i)
    expect(() => demographieRowsFromSemantic(read('declared_story', 'legacy'), cible, metadata)).toThrow(/source/i)
  })

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

  it('associe les comparaisons de profil à la même facette', () => {
    const row = { territoire: '35238', type: 'commune' as const, theme: 'habitat' as const, key: 'structure_age', detail: 'ancien', sex: 'F' as const,
      vintage_source: '', vintage_version: '', vintage_date_reference: null, vintage_date_publication: null,
      value: 0.4, unit: '%', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null }
    const comparison = { results: [], profile_comparisons: [{ indicator: 'structure_age', facet: { detail: 'ancien', sex: 'M' }, status: 'available', direction: 'high', rank: 1, rank_size: 10 }] }
    expect(lignesAvecComparaisonApi([row], comparison, null)[0]?.comparaisonApi).toBeUndefined()
  })
  it('adapte les comparaisons sémantiques Démographie sans perdre rang, portée, facette ou nuage', () => {
    const comparison = demographieComparisonForFiche({ resource_results: [
      { resource: 'densite', result: { status: 'available', direction: 'high', rank: 2, rank_size: 8 } },
      { resource: 'structure_age', shape: 'profile', result: { status: 'available', direction: 'low', rank: 4,
        rank_size: 8, source_facet: { detail: '<15', sex: 'F' } } },
    ], selection: [{ type: 'commune', id: '35238' }], reading_cloud: { status: 'available', points: [] } }, 'communes EPCI')
    expect(comparison).toMatchObject({ results: [{ indicator_id: 'densite', rank: 2, rank_size: 8 }],
      profile_comparisons: [{ indicator: 'structure_age', facet: { detail: '<15', sex: 'F' }, rank: 4 }],
      selection: [{ territory_type: 'commune', territory_id: '35238' }], portee: 'communes EPCI',
      reading_cloud: { status: 'available' } })
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
    expect(histoiresDemographieNuage({ reading_cloud: null }, {})).toEqual([])
  })
  it('keeps cloud reading status and registered provenance without inventing numeric zeros', () => {
    const metadata = { source_records: { story_source: { dataset: 'INSEE story', vintages: [
      { id: 'story-v2', version: '2026', dateReference: '2023-01-01', datePublication: '2026-06-30' },
    ] } } }
    const response = { reading_resource: { resource_id: 'story_resource_v2', sources: ['story_source'] },
      reading_cloud: { points: [
        { territory: { territory_id: '1', territory_type: 'commune' }, status: 'measured', periode: '2017-2023',
          taux_solde_naturel: 0, taux_solde_migratoire: -0.2, classification: 'stable',
          source_id: 'story_source', vintage_id: 'story-v2' },
        { territory: { territory_id: '2', territory_type: 'commune' }, status: 'suppressed', periode: null,
          taux_solde_naturel: null, taux_solde_migratoire: null, classification: null, source_id: null, vintage_id: null },
      ] } }
    expect(histoiresDemographieNuage(response, metadata)).toEqual([
      { territoire: '1', type: 'commune', status: 'measured', periode: '2017-2023', taux_solde_naturel: 0,
        taux_solde_migratoire: -0.2, classification: 'stable', provenance: { source_id: 'story_source',
          vintage_id: 'story-v2', source_name: 'INSEE story', source_version: '2026',
          source_reference_date: '2023-01-01', source_publication_date: '2026-06-30' } },
      { territoire: '2', type: 'commune', status: 'suppressed', periode: null, taux_solde_naturel: null,
        taux_solde_migratoire: null, classification: null, provenance: null },
    ])
  })
  it('rejects a cloud source identity outside the declared typed-reading sources', () => {
    expect(() => histoiresDemographieNuage({ reading_resource: { resource_id: 'story', sources: ['known'] },
      reading_cloud: { points: [{ territory: { territory_id: '1', territory_type: 'commune' }, status: 'measured',
        periode: null, taux_solde_naturel: 0, taux_solde_migratoire: 0, classification: null,
        source_id: 'unknown', vintage_id: 'v1' }] } }, { source_records: {} })).toThrow(/not declared|non déclarée/i)
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
    const points = histoiresMilieuxDuNuage({ reading_cloud: { points: [
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
