import { describe, expect, it } from 'vitest'

import { storyDemographie } from '../fiche/storyDemographie'

/**
 * The Story copy mapping (docs/themes/demographie.md, ADR-0011): the
 * classification is one of four quadrant readings by the SIGNS of the two
 * annualized rates; the copy is a one-liner per reading plus a "comment lire"
 * line that quotes the territory's actual rates. Within the two mixed
 * quadrants the copy is MAGNITUDE-AWARE (issue #73 follow-up): compensation
 * is only claimed when the positive force outweighs the negative one — Moréac
 * (+1,43 / −4,15 → net −2,72) reads "la population diminue malgré les
 * naissances", never "compensent". Pure, isolated, deterministic. Wording is
 * PROVISIONAL and stays factual/neutral; the mapping shape is locked.
 */

describe('storyDemographie — the copy keyed by the rate-quadrant classification', () => {
  it('returns the attire-renouvelle reading: dated title + one-liner + rates in comment-lire', () => {
    const story = storyDemographie('attire-renouvelle', 4.99, 5.49, '2017-2023')

    expect(story).toMatchObject({
      classification: 'attire-renouvelle',
      titre: 'Trajectoire démographique (2017-2023)',
      uneLigne: 'Le territoire attire et se renouvelle.',
    })
    expect(story?.commentLire).toContain('+4,99/an pour 1 000 hab.')
    expect(story?.commentLire).toContain('+5,49/an pour 1 000 hab.')
  })

  it('dates the title only when the pipeline published the period (issue #113)', () => {
    expect(storyDemographie('attire-renouvelle', 4.99, 5.49, null)?.titre).toBe(
      'Trajectoire démographique',
    )
    expect(storyDemographie('attire-renouvelle', 4.99, 5.49)?.titre).toBe(
      'Trajectoire démographique',
    )
  })

  it('drafts a one-liner and a comment-lire for each of the four readings', () => {
    for (const lecture of [
      'attire-renouvelle',
      'attire-meurt',
      'vide-meurt',
      'vide-renouvelle',
    ]) {
      const story = storyDemographie(lecture, -1.5, 2.5, '2017-2023')

      expect(story).not.toBeNull()
      expect(story?.uneLigne.length).toBeGreaterThan(0)
      expect(story?.commentLire.length).toBeGreaterThan(0)
    }
  })

  it('gives each reading its own one-liner (four distinct sentences)', () => {
    const uneLignes = new Set(
      ['attire-renouvelle', 'attire-meurt', 'vide-meurt', 'vide-renouvelle'].map(
        (lecture) => storyDemographie(lecture, -1.5, 2.5, '2017-2023')?.uneLigne,
      ),
    )

    expect(uneLignes.size).toBe(4)
  })

  it('names the natural force for attire-meurt and vide-meurt without dramatic wording', () => {
    expect(storyDemographie('attire-meurt', -1.5, 2.5, '2017-2023')?.uneLigne).toContain(
      'solde naturel',
    )
    expect(storyDemographie('vide-meurt', -1.5, -2.5, '2017-2023')?.uneLigne).toContain('diminue')
    // copy decision (issue #73): no "dying"/"exodus" — factual words only
    expect(storyDemographie('vide-meurt', -1.5, -2.5, '2017-2023')?.uneLigne).not.toMatch(
      /meurt|meure|exode/i,
    )
    expect(storyDemographie('attire-meurt', -1.5, 2.5, '2017-2023')?.commentLire).not.toMatch(
      /meurt|meure|exode/i,
    )
  })

  it('quotes the territory’s actual rates in « comment lire » (per-year per-1000, signed)', () => {
    const story = storyDemographie('vide-renouvelle', 2.1, -3.3, '2017-2023')

    expect(story?.commentLire).toContain('+2,10/an pour 1 000 hab.')
    expect(story?.commentLire).toContain('-3,30/an pour 1 000 hab.')
  })

  it('vide-renouvelle: claims compensation ONLY when births outweigh departures', () => {
    // births dominate (|naturel| > |migration|) → compensation is honest
    const quiCompense = storyDemographie('vide-renouvelle', 4.0, -2.0, '2017-2023')
    expect(quiCompense?.uneLigne).toBe('Les naissances compensent les départs.')
    expect(quiCompense?.commentLire).toContain('se maintient grâce aux naissances')

    // the tie (|naturel| = |migration|) → net zero, maintenance still honest
    const exAequo = storyDemographie('vide-renouvelle', 2.0, -2.0, '2017-2023')
    expect(exAequo?.uneLigne).toBe('Les naissances compensent les départs.')

    // Moréac 56140: natural +1,43 / migration −4,15 → net −2,72 → NO compensation
    const moreac = storyDemographie('vide-renouvelle', 1.428125, -4.150489, '2017-2023')
    expect(moreac?.uneLigne).toBe('La population diminue malgré les naissances.')
    expect(moreac?.commentLire).toContain('+1,43/an pour 1 000 hab.')
    expect(moreac?.commentLire).toContain('-4,15/an pour 1 000 hab.')
    expect(moreac?.commentLire).toContain('la population diminue malgré les naissances')
  })

  it('attire-meurt: claims compensation ONLY when arrivals outweigh the natural deficit', () => {
    // arrivals dominate → compensation is honest
    const quiCompense = storyDemographie('attire-meurt', -2.0, 4.0, '2017-2023')
    expect(quiCompense?.uneLigne).toBe('Les arrivées compensent un solde naturel négatif.')
    expect(quiCompense?.commentLire).toContain('se maintient grâce aux arrivées')

    // the natural deficit dominates → population declines despite arrivals
    const deficit = storyDemographie('attire-meurt', -4.0, 2.0, '2017-2023')
    expect(deficit?.uneLigne).toBe('La population diminue malgré les arrivées.')
    expect(deficit?.commentLire).toContain('la population diminue malgré les arrivées')
  })

  it('returns null for an unknown classification — never invents a one-liner', () => {
    expect(storyDemographie('inconnu', 1, 2, '2017-2023')).toBeNull()
    expect(storyDemographie('', 1, 2, '2017-2023')).toBeNull()
    expect(storyDemographie(null, 1, 2, '2017-2023')).toBeNull()
    expect(storyDemographie(undefined, 1, 2, '2017-2023')).toBeNull()
  })

  it('returns null when a rate is missing — the comment-lire would have nothing to quote', () => {
    expect(storyDemographie('attire-renouvelle', null, 5.49, '2017-2023')).toBeNull()
    expect(storyDemographie('attire-renouvelle', 4.99, undefined, '2017-2023')).toBeNull()
  })
})
