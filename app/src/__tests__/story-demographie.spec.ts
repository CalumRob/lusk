import { describe, expect, it } from 'vitest'

import { storyDemographie } from '../fiche/storyDemographie'

/**
 * The Story copy mapping (docs/themes/demographie.md): classification →
 * serif one-liner + "comment lire". Pure, isolated, deterministic — the
 * reproducibility rule (same territory + same data → same reading forever).
 * Wording is PROVISIONAL per the theme contract; the mapping shape is locked.
 */

describe('storyDemographie — the copy keyed by the 2×2 classification', () => {
  it('returns the fertile reading: title + one-liner + comment-lire', () => {
    const story = storyDemographie('fertile')

    expect(story).toMatchObject({
      classification: 'fertile',
      titre: 'Attractive ou fertile ?',
      uneLigne: 'La population se renouvelle sur place.',
    })
    expect(story?.commentLire).toContain('solde naturel')
    expect(story?.commentLire).toContain('arrivées')
  })

  it('drafts a one-liner and a comment-lire for each of the four readings', () => {
    for (const lecture of ['fertile', 'attractive', 'vieillissante', 'exode']) {
      const story = storyDemographie(lecture)

      expect(story).not.toBeNull()
      expect(story?.uneLigne.length).toBeGreaterThan(0)
      expect(story?.commentLire.length).toBeGreaterThan(0)
    }
  })

  it('gives each reading its own one-liner (four distinct sentences)', () => {
    const uneLignes = new Set(
      ['fertile', 'attractive', 'vieillissante', 'exode'].map(
        (lecture) => storyDemographie(lecture)?.uneLigne,
      ),
    )

    expect(uneLignes.size).toBe(4)
  })

  it('names the migration half for attractive and exodus, the natural half for the others', () => {
    expect(storyDemographie('attractive')?.uneLigne).toContain('arrivants')
    expect(storyDemographie('exode')?.uneLigne).toContain('départs')
    expect(storyDemographie('vieillissante')?.uneLigne).toContain('renouvelle')
  })

  it('returns null for an unknown classification — never invents a one-liner', () => {
    expect(storyDemographie('inconnu')).toBeNull()
    expect(storyDemographie('')).toBeNull()
    expect(storyDemographie(null)).toBeNull()
    expect(storyDemographie(undefined)).toBeNull()
  })
})
