import { describe, expect, it } from 'vitest'

import { storyEconomie } from '../fiche/storyEconomie'
import { histoiresEconomieFixture } from '../payload/fixtures'
import type { HistoireEconomie } from '../payload/types'

/**
 * The Économie Story (issue #121, forme reshapée — issue #120): the LQ is the
 * Story, never a block indicator. TWO readings, one per story_key:
 * « ce que la commune abrite » (the top-5 specialisations by LQ — communes,
 * EPCIs, départements) and « ce que la Bretagne abrite » (the region's top-5
 * by presence — its LQ is degenerate, it reads n + part du parc). The copy is
 * generated from the payload rows — never hand-written per territory
 * (reproducibility rule); the vintage rides on the rows themselves (issue
 * #74). Null for a territory without an Économie Story — never an invented
 * reading.
 */

const lignesPour = (territoire: string): HistoireEconomie[] =>
  histoiresEconomieFixture.filter(
    (h): h is HistoireEconomie => h.theme === 'economie' && h.territoire === territoire,
  )

describe('storyEconomie — ce-que-la-commune-abrite (top-5 spécialisations LQ)', () => {
  it('reads the commune’s top-5, one ligne per rang, labels from the payload', () => {
    const story = storyEconomie(lignesPour('22001'), 'Commune A1')

    expect(story).not.toBeNull()
    expect(story?.storyKey).toBe('ce-que-la-commune-abrite')
    expect(story?.titre).toBe('Ce que la commune abrite')
    expect(story?.lignes.map((l) => l.rang)).toEqual([1, 2, 3, 4, 5])
    expect(story?.lignes[0]).toEqual({
      rang: 1,
      label: 'Élevage de volailles',
      mesure: 'LQ 23,7 · 12 établissements',
    })
    expect(story?.lignes[1].label).toBe(
      "Commerce de gros (commerce interentreprises) d'animaux vivants",
    )
  })

  it('drafts a one-liner naming the top-3 specialisations and a comment-lire on the LQ', () => {
    const story = storyEconomie(lignesPour('22001'), 'Commune A1')

    expect(story?.uneLigne).toBe(
      'Commune A1 se distingue par Élevage de volailles, Commerce de gros (commerce interentreprises) ' +
        "d'animaux vivants et Captage, traitement et distribution d'eau.",
    )
    expect(story?.commentLire).toContain('quotient de localisation')
    expect(story?.commentLire).toContain('moyenne bretonne')
  })

  it('adapts the title to the territory type (an EPCI is never « la commune »)', () => {
    expect(storyEconomie(lignesPour('200000001'), 'EPCI X')?.titre).toBe('Ce que l’EPCI abrite')
    expect(storyEconomie(lignesPour('22'), 'Département 22')?.titre).toBe(
      'Ce que le département abrite',
    )
  })

  it('stamps the story with its own vintage from the payload rows (issue #74)', () => {
    const story = storyEconomie(lignesPour('22001'), 'Commune A1')

    expect(story?.vintage).toContain('data.bretagne.bzh')
    expect(story?.vintage).toContain('réf. 31 mars 2026')
  })
})

describe('storyEconomie — ce-que-la-bretagne-abrite (top-5 par présence, région)', () => {
  it('reads the région’s top-5 by presence: n + part du parc, no LQ', () => {
    const story = storyEconomie(lignesPour('53'), 'Bretagne')

    expect(story).not.toBeNull()
    expect(story?.storyKey).toBe('ce-que-la-bretagne-abrite')
    expect(story?.titre).toBe('Ce que la Bretagne abrite')
    expect(story?.lignes.map((l) => l.rang)).toEqual([1, 2, 3, 4, 5])
    expect(story?.lignes[0]).toEqual({
      rang: 1,
      label: "Location de terrains et d'autres biens immobiliers",
      mesure: '124 881 établissements · 16,5 % du parc breton',
    })
  })

  it('drafts the presence one-liner and a comment-lire explaining why the LQ is absent', () => {
    const story = storyEconomie(lignesPour('53'), 'Bretagne')

    expect(story?.uneLigne).toBe(
      'La Bretagne abrite surtout Location de terrains et d\'autres biens immobiliers, ' +
        'Location de logements et Autres organisations fonctionnant par adhésion volontaire.',
    )
    expect(story?.commentLire).toContain('présence')
    expect(story?.commentLire).toContain('parc breton')
  })
})

describe('storyEconomie — honest edges', () => {
  it('returns null for a territory without an Économie Story — never invents a reading', () => {
    expect(storyEconomie([], 'Commune D')).toBeNull()
  })

  it('is deterministic — the same rows give the same story', () => {
    const une = storyEconomie(lignesPour('200000001'), 'EPCI X')
    const deux = storyEconomie(lignesPour('200000001'), 'EPCI X')

    expect(une?.lignes).toEqual(deux?.lignes)
    expect(une?.uneLigne).toBe(deux?.uneLigne)
  })
})
