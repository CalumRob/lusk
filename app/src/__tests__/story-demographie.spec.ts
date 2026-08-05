import { describe, expect, it } from 'vitest'

import { storyDemographie } from '../fiche/storyDemographie'

/**
 * The Story copy mapping (docs/themes/demographie.md, ADR-0011): the
 * classification is one of four quadrant readings by the SIGNS of the two
 * annualized rates; the copy is a fixed one-liner per reading plus a
 * "comment lire" line that quotes the territory's actual rates. Pure,
 * isolated, deterministic — the reproducibility rule (same territory + same
 * data → same reading forever). Wording is PROVISIONAL per the theme
 * contract and stays factual/neutral (issue #73 — no dramatic wording even
 * when a rate is negative); the mapping shape is locked.
 */

describe('storyDemographie — the copy keyed by the rate-quadrant classification', () => {
  it('returns the attire-renouvelle reading: title + one-liner + rates in comment-lire', () => {
    const story = storyDemographie('attire-renouvelle', 4.99, 5.49)

    expect(story).toMatchObject({
      classification: 'attire-renouvelle',
      titre: 'Trajectoire démographique',
      uneLigne: 'La population se renouvelle et attire.',
    })
    expect(story?.commentLire).toContain('+4,99 ‰/an')
    expect(story?.commentLire).toContain('+5,49 ‰/an')
  })

  it('drafts a one-liner and a comment-lire for each of the four readings', () => {
    for (const lecture of [
      'attire-renouvelle',
      'attire-meurt',
      'vide-meurt',
      'vide-renouvelle',
    ]) {
      const story = storyDemographie(lecture, -1.5, 2.5)

      expect(story).not.toBeNull()
      expect(story?.uneLigne.length).toBeGreaterThan(0)
      expect(story?.commentLire.length).toBeGreaterThan(0)
    }
  })

  it('gives each reading its own one-liner (four distinct sentences)', () => {
    const uneLignes = new Set(
      ['attire-renouvelle', 'attire-meurt', 'vide-meurt', 'vide-renouvelle'].map(
        (lecture) => storyDemographie(lecture, -1.5, 2.5)?.uneLigne,
      ),
    )

    expect(uneLignes.size).toBe(4)
  })

  it('names the natural force for attire-meurt and vide-meurt without dramatic wording', () => {
    expect(storyDemographie('attire-meurt', -1.5, 2.5)?.uneLigne).toContain('solde naturel')
    expect(storyDemographie('vide-meurt', -1.5, -2.5)?.uneLigne).toContain('diminue')
    // copy decision (issue #73): no "dying"/"exodus" — factual words only
    expect(storyDemographie('vide-meurt', -1.5, -2.5)?.uneLigne).not.toMatch(/meurt|meure|exode/i)
    expect(storyDemographie('attire-meurt', -1.5, 2.5)?.commentLire).not.toMatch(/meurt|meure|exode/i)
  })

  it('quotes the territory’s actual rates in « comment lire » (per-mille, signed)', () => {
    const story = storyDemographie('vide-renouvelle', 2.1, -3.3)

    expect(story?.commentLire).toContain('+2,10 ‰/an')
    expect(story?.commentLire).toContain('-3,30 ‰/an')
  })

  it('returns null for an unknown classification — never invents a one-liner', () => {
    expect(storyDemographie('inconnu', 1, 2)).toBeNull()
    expect(storyDemographie('', 1, 2)).toBeNull()
    expect(storyDemographie(null, 1, 2)).toBeNull()
    expect(storyDemographie(undefined, 1, 2)).toBeNull()
  })

  it('returns null when a rate is missing — the comment-lire would have nothing to quote', () => {
    expect(storyDemographie('attire-renouvelle', null, 5.49)).toBeNull()
    expect(storyDemographie('attire-renouvelle', 4.99, undefined)).toBeNull()
  })
})
