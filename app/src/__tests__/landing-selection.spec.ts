import { describe, expect, it } from 'vitest'

import { selectionAleatoire } from '../landing/selection'
import { territoiresFixture } from '../payload/fixtures'

/**
 * The landing's "Sélection aléatoire" logic — a pure function, locked in
 * isolation before the carousel is built. Random selection of N territories
 * from the reference table: the size is deterministic, the picks are distinct,
 * and the selection is stable under a fixed RNG (so a refresh keeps the same
 * examples — the "alive" landing doesn't reshuffle on every render).
 */

describe('selectionAleatoire — the landing examples', () => {
  it('returns exactly the requested number of territoires', () => {
    const selection = selectionAleatoire(territoiresFixture, 4, () => 0.5)

    expect(selection).toHaveLength(4)
  })

  it('never returns a territoire twice', () => {
    const selection = selectionAleatoire(territoiresFixture, 8, () => 0.25)

    const codes = selection.map((t) => t.territoire)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('is stable under a fixed RNG — same picks every time', () => {
    const une = selectionAleatoire(territoiresFixture, 4, () => 0.42)
    const deux = selectionAleatoire(territoiresFixture, 4, () => 0.42)

    expect(une.map((t) => t.territoire)).toEqual(deux.map((t) => t.territoire))
  })

  it('draws only from the reference table — never invents a territoire', () => {
    const selection = selectionAleatoire(territoiresFixture, 6, () => 0.1)

    const codesConnus = new Set(territoiresFixture.map((t) => t.territoire))
    expect(selection.every((t) => codesConnus.has(t.territoire))).toBe(true)
  })

  it('caps the selection at the table size — never more than exists', () => {
    const selection = selectionAleatoire(territoiresFixture, 99, () => 0.7)

    expect(selection).toHaveLength(territoiresFixture.length)
  })

  it('returns an empty list for an empty table', () => {
    expect(selectionAleatoire([], 4, () => 0.5)).toEqual([])
  })
})
