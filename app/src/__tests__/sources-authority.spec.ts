import { describe, expect, it } from 'vitest'

import { sourceRecords } from '../payload/selectors'
import { apercuAvecNAFixture, histoiresDemographieFixture, indicateursDemographieFixture, territoiresFixture, vintagesFixture } from '../payload/fixtures'
import type { Payload } from '../payload/types'

const payload: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursDemographieFixture,
  histoires: histoiresDemographieFixture,
  apercu: apercuAvecNAFixture,
  runReport: null,
  vintages: vintagesFixture,
  programmes: null,
}

describe('sourceRecords — autorité dataset-centric publiée', () => {
  it('regroupe les lignes vintage et conserve toute la fraîcheur', () => {
    const serie = sourceRecords(payload).find((source) => source.id === 'serie_historique')!
    expect(serie.publisher).toBe('INSEE')
    expect(serie.url).toContain('data.gouv.fr')
    expect(serie.vintages).toHaveLength(1)
    expect(serie.vintages[0]).toMatchObject({ version: '2023', licence: 'Licence Ouverte 2.0' })
  })

  it('publie uniquement les consommateurs résolus par le registre', () => {
    const serie = sourceRecords(payload).find((source) => source.id === 'serie_historique')!
    expect(serie.consumers.map((consumer) => consumer.key)).toEqual(['densite', 'evolution_1968'])
    expect(sourceRecords(payload).some((source) => source.consumers.some((consumer) => consumer.key === 'le-matin-la-commune-se-vide'))).toBe(false)
    expect(sourceRecords(payload).find((source) => source.id === 'flores_a88')).toBeUndefined()
  })

  it('forme une union exacte des indicateurs publiés et conserve les horloges structurées', () => {
    const records = sourceRecords(payload)
    for (const line of payload.indicateurs) {
      expect(records.some((record) => record.consumers.some((consumer) => consumer.theme === line.theme && consumer.key === line.key))).toBe(true)
    }
    const mobilite = sourceRecords(payload, { includeUnpublished: true }).find((record) => record.id === 'mobilite_snapshot')
    expect(mobilite?.clocks.some((clock) => clock.frequency && clock.reference && clock.trigger)).toBe(true)
  })

  it('consomme les vintages propres à source_records sans les reconstruire depuis le registre', () => {
    const metadata = {
      demographie: {
        sources: { densite: 'serie_historique', taille_menages: 'menages' },
        indicator_labels: { densite: 'Densité de population', taille_menages: 'Taille moyenne des ménages' },
        indicator_pages: { densite: { sources: ['serie_historique', 'menages'] } },
        source_records: {
          serie_historique: {
            dataset: 'Canonique série', publisher: 'Canonique', url: 'https://canonique.example', licence: 'Canonique', vintage: 'V-custom', freshness: 'Fraîcheur custom',
            vintages: [{ id: 'custom-row', label: 'Ligne custom', version: 'V-custom', licence: 'Canonique', dateReference: null, datePublication: null }],
            methodology: {
              title: 'Méthode canonique',
              summary: 'Une méthode portée par la source.',
              factors: [{ key: 'surface', label: 'Surface', value: 25, unit: 'm²/place' }],
              notes: ['La note est portée par le payload.'],
            },
          },
        },
      },
    } as unknown as Payload['themeMetadata']
    const records = sourceRecords({ ...payload, themeMetadata: metadata })
    const serie = records.find((record) => record.id === 'serie_historique')!
    expect(serie.dataset).toBe('Canonique série')
    expect(serie.vintages.map((vintage) => vintage.id)).toEqual(['custom-row'])
    expect(serie.methodology).toMatchObject({
      title: 'Méthode canonique',
      factors: [{ key: 'surface', value: 25, unit: 'm²/place' }],
    })
    expect(records.find((record) => record.id === 'menages')?.consumers.map((consumer) => consumer.key)).toEqual(['densite', 'taille_menages'])
  })

  it('expose le référentiel territorial comme consommateur non-indicateur', () => {
    const territoryMetadata = {
      schema_version: '1',
      territory_reference_label: 'Référentiel territorial — classes de densité communale',
      source_records: {
        classe_densite_communale: {
          dataset: 'Grille de densité 2025 — maille communale',
          publisher: 'INSEE',
          url: 'https://www.insee.fr/fr/statistiques/fichier/8571524/fichier_diffusion_2026.xlsx',
          licence: 'Licence Ouverte 2.0',
          sha256: '8ebf3011743db45ab94c4ffb74d1bcb06929f0076ecd5b8247011bca861ca978',
          vintage: 'Classification 2025 · géographie communale au 01/01/2026 · RP 2021',
          freshness: 'Publication INSEE du 15 mai 2026',
          vintages: [{
            id: 'classe_densite_communale',
            label: 'Grille de densité communale 2025',
            version: 'Classification 2025 · géographie communale au 01/01/2026 · RP 2021',
            licence: 'Licence Ouverte 2.0',
            dateReference: '2021-01-01',
            datePublication: '2026-05-15',
          }],
        },
      },
      density_classes: Object.fromEntries(Array.from({ length: 7 }, (_, index) => [String(index + 1), {
        code: String(index + 1),
        libelle_insee: `Classe INSEE ${index + 1}`,
        libelle_public: `Classe publique ${index + 1}`,
      }])),
    } as unknown as Payload['territoryMetadata']

    const record = sourceRecords({ ...payload, territoryMetadata }).find(
      (source) => source.id === 'classe_densite_communale',
    )!
    expect(record.dataset).toContain('Grille de densité 2025')
    expect(record.sha256).toBe('8ebf3011743db45ab94c4ffb74d1bcb06929f0076ecd5b8247011bca861ca978')
    expect(record.vintages[0]).toMatchObject({ datePublication: '2026-05-15' })
    expect(record.consumers).toEqual([
      expect.objectContaining({
        kind: 'territory-reference',
        label: 'Référentiel territorial — classes de densité communale',
      }),
    ])
  })
})
