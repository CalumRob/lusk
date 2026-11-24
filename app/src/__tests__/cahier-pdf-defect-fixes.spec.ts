/**
 * #1024 — the waffle title is the exact owner sentence, not renderer copy.
 */
import { describe, expect, it } from 'vitest'

import { aedarWaffleTitre } from '@/fiche/content/aedarAccessSection'

describe('corrections de la revue données réelles (#1024)', () => {
  it('2. le titre du waffle est la phrase exacte du propriétaire', () => {
    expect(aedarWaffleTitre(15)).toBe(
      'Part des adresses résidentielles situées à 15 minutes ou moins par mode de transport.',
    )
  })
})
