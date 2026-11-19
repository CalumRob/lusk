import { describe, expect, it } from 'vitest'

import {
  CLES_HISTOIRES_PAR_THEME,
  GROUPES_PAR_STORY,
  RAISONS_SAILLANCE,
} from '../payload/types'
import { parsePayload } from '../payload/validate'
import {
  histoiresDemographieFixture,
  histoiresMobiliteFixture,
  indicateursDemographieFixture,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import { SOURCES_METHODES } from '../methodes/sources'

/**
 * Slice 3 of #1048 — the retired Mobilité snapshot surface is gone from the
 * app contract. The app must stay tolerant while the producer still serves
 * legacy rows (the API retires them at republish, slice 4): an unknown or
 * empty histoire table is never a load error, and the retired story keys and
 * snapshot source are no longer part of any app registry.
 */

describe('registres — la Mobilité ne porte plus de lecture ni de saillance', () => {
  it('ne déclare aucune histoire Mobilité (le thème reste canonique)', () => {
    expect(CLES_HISTOIRES_PAR_THEME.mobilite).toEqual([])
    expect(GROUPES_PAR_STORY.mobilite).toEqual({})
  })

  it('ne connaît plus la raison de saillance du vélo retiré', () => {
    expect(RAISONS_SAILLANCE).toEqual(['defaut'])
  })

  it('ne déclare plus la source du snapshot porté dans les Méthodes', () => {
    expect(Object.keys(SOURCES_METHODES)).not.toContain('mobilite_snapshot')
  })
})

describe('tolérance des histoires — une table vide ou inconnue ne bloque pas le chargement', () => {
  const documents = (histoires: unknown) => ({
    territoires: territoiresFixture,
    indicateurs: indicateursDemographieFixture,
    histoires,
    runReport: runReportFraisFixture,
    vintages: vintagesFixture,
  })

  it('accepte une table d’histoires vide', () => {
    expect(parsePayload(documents([])).histoires).toEqual([])
  })

  it('ignore une ligne Mobilité résiduelle sans rejeter le payload', () => {
    // Le producteur sert encore les anciennes lignes jusqu'au republish ;
    // le lecteur les ignore au lieu d'exiger des champs retirés.
    const legacy = {
      territoire: '22001',
      type: 'commune',
      theme: 'mobilite',
      groupe: 'acces-aux-services',
      story_key: 'story-du-snapshot-retire',
      salience_reason: 'defaut',
    }
    const payload = parsePayload(documents([...histoiresDemographieFixture, legacy]))
    expect(payload.histoires.every((h) => (h.theme as string) !== 'mobilite')).toBe(true)
    expect(payload.histoires).toHaveLength(histoiresDemographieFixture.length)
  })

  it('la fixture Mobilité ne porte plus aucune ligne de snapshot', () => {
    expect(histoiresMobiliteFixture).toEqual([])
  })

  it('continue de rejeter une dérive sur une histoire d’un thème retenu', () => {
    const invalide = JSON.parse(JSON.stringify(histoiresDemographieFixture))
    ;(invalide[0] as { story_key: string }).story_key = 'histoire-inconnue'
    expect(() => parsePayload(documents(invalide))).toThrow(/Story/)
  })
})
