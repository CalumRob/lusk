import { describe, expect, it } from 'vitest'
import { themeFactsRowsFromApi, validerReponseComparaisonTheme } from '../payload/themeFactsAdapter'
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

const sources = () => [{
  source_id: 'habitat_api', name: 'Source API habitat', vintage_id: 'api-v1', version: 'api-v1',
  reference_date: null, publication_date: null,
}]

describe('themeFactsAdapter — le contrat theme-facts-v1 en lignes de fiche (#627)', () => {
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
    expect(() => themeFactsRowsFromApi('milieux', {
      contract: 'theme-facts-v1', theme_id: 'milieux',
      territory: { territory_id: '35238', name: 'Saint-Jacques', territory_type: 'commune' },
      content_version: 'v', reference_content_version: 'r',
      indicator_metadata: [], named_reference_evidence: [], indicators: [],
      readings: [{ groupe: 'g', story_key: 's', salience_reason: 'defaut', status: 'measured' }],
    }, cible)).toThrow(/non migré/)
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
