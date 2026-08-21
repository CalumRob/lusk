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
})
