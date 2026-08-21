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
        sources: { densite: 'serie_historique' },
        indicator_labels: { densite: 'Densité de population' },
        indicator_pages: { densite: { sources: ['serie_historique', 'menages'] } },
        source_records: {
          serie_historique: {
            dataset: 'Canonique série', publisher: 'Canonique', url: 'https://canonique.example', licence: 'Canonique', vintage: 'V-custom', freshness: 'Fraîcheur custom',
            vintages: [{ id: 'custom-row', label: 'Ligne custom', version: 'V-custom', licence: 'Canonique', dateReference: null, datePublication: null }],
          },
        },
      },
    } as unknown as Payload['themeMetadata']
    const records = sourceRecords({ ...payload, themeMetadata: metadata })
    const serie = records.find((record) => record.id === 'serie_historique')!
    expect(serie.dataset).toBe('Canonique série')
    expect(serie.vintages.map((vintage) => vintage.id)).toEqual(['custom-row'])
    expect(records.find((record) => record.id === 'menages')?.consumers.map((consumer) => consumer.key)).toEqual(['densite', 'taille_menages'])
  })
})
