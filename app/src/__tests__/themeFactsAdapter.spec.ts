import { describe, expect, it } from 'vitest'
import { histoiresDemographieNuage, histoiresMilieuxDuNuage, themeFactsRowsFromApi, validerReponseComparaisonTheme } from '../payload/themeFactsAdapter'
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
  it('projette les adhésions ancrées et les subventions depuis leurs collections/séries sans inventer absence', () => {
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
        ], relationships: [] },
      ],
      owned_series: [{ indicator_id: 'subventions_annuelles', unit: '€', points: [
        { axis: '2025', value: 5678, status: 'measured', provenance: source },
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
