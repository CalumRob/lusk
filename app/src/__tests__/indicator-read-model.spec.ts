import { describe, expect, it } from 'vitest'

import { indicateursDemographieFixture, metadonneesThemesFixtures, territoiresFixture } from '../payload/fixtures'
import { payloadDepuisModeleIndicateur, validerModeleIndicateur } from '../payload/indicatorReadModel'

describe("le modèle de lecture d'une Page d'indicateur", () => {
  it('valide une projection densité autonome à partir de son contrat public', () => {
    const densite = indicateursDemographieFixture.filter(
      (fact) => fact.key === 'densite' && fact.type !== 'region',
    )
    const modele = validerModeleIndicateur(
      {
        schema_version: '1',
        snapshot_id: '2026-09-15',
        theme: 'demographie',
        indicator: 'densite',
        theme_label: 'Démographie',
        page: {
          indicator: 'densite',
          label: 'Densité de population',
          definition: "Nombre d'habitants par kilomètre carré.",
          unit: 'hab./km²',
          calculation: 'Population divisée par la superficie.',
          direction: 'high',
          caveats: 'La superficie est celle du territoire.',
          levels: ['commune', 'epci', 'departement'],
          sources: ['serie_historique'],
        },
        detail_labels: {},
        source_records: metadonneesThemesFixtures.demographie.source_records,
        facts: densite,
      },
      'densite.json',
      territoiresFixture,
    )

    expect(modele.theme).toBe('demographie')
    expect(modele.indicator).toBe('densite')
    expect(modele.facts).toHaveLength(densite.length)
    expect(modele.facts.map(({ territoire, value }) => ({ territoire, value }))).toEqual(
      densite.map(({ territoire, value }) => ({ territoire, value })),
    )
    expect(modele.page.levels).toEqual(['commune', 'epci', 'departement'])
    expect(modele.sourceRecords.serie_historique?.dataset).toBeTruthy()
    const payload = payloadDepuisModeleIndicateur(modele, territoiresFixture)
    expect(payload.themeMetadata?.demographie?.source_records).toEqual(modele.sourceRecords)
  })
})
