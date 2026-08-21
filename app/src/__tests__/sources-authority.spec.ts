import { describe, expect, it } from 'vitest'

import { publishedSources } from '../methodes/authority'
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

describe('publishedSources — autorité dataset-centric publiée', () => {
  it('regroupe les lignes vintage et conserve toute la fraîcheur', () => {
    const serie = publishedSources(payload).find((source) => source.id === 'serie_historique')!
    expect(serie.publisher).toBe('INSEE')
    expect(serie.url).toContain('data.gouv.fr')
    expect(serie.vintages).toHaveLength(1)
    expect(serie.vintages[0]).toMatchObject({ version: '2023', licence: 'Licence Ouverte 2.0' })
  })

  it('publie uniquement les consommateurs résolus par le registre', () => {
    const serie = publishedSources(payload).find((source) => source.id === 'serie_historique')!
    expect(serie.consumers.map((consumer) => consumer.key)).toEqual(['densite', 'evolution_1968'])
    expect(publishedSources(payload).some((source) => source.consumers.some((consumer) => consumer.key === 'le-matin-la-commune-se-vide'))).toBe(false)
  })
})
