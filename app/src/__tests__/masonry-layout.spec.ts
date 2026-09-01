import { describe, expect, it } from 'vitest'

import { layoutMasonry } from '@/fiche/masonryLayout'

describe('layoutMasonry', () => {
  it('starts left, then chooses the shorter measured column', () => {
    expect(
      layoutMasonry([
        { key: 'group-1', height: 100 },
        { key: 'group-2', height: 200 },
        { key: 'group-3', height: 40 },
      ], { gap: 20 }).placements,
    ).toEqual([
      { key: 'group-1', column: 0, top: 0 },
      { key: 'group-2', column: 1, top: 0 },
      { key: 'group-3', column: 0, top: 120 },
    ])

    expect(
      layoutMasonry([
        { key: 'group-1', height: 200 },
        { key: 'group-2', height: 100 },
        { key: 'group-3', height: 40 },
      ], { gap: 20 }).placements,
    ).toEqual([
      { key: 'group-1', column: 0, top: 0 },
      { key: 'group-2', column: 1, top: 0 },
      { key: 'group-3', column: 1, top: 120 },
    ])
  })

  it('uses the left column for equal heights and reports the packed height', () => {
    expect(layoutMasonry([
      { key: 'group-1', height: 80 },
      { key: 'group-2', height: 80 },
      { key: 'group-3', height: 20 },
    ], { gap: 16 })).toEqual({
      placements: [
        { key: 'group-1', column: 0, top: 0 },
        { key: 'group-2', column: 1, top: 0 },
        { key: 'group-3', column: 0, top: 96 },
      ],
      height: 116,
    })
  })
})
