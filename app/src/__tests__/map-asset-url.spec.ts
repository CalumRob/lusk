import { describe, expect, it } from 'vitest'
import { mapAssetUrl } from '@/fiche/mapAssetUrl'

describe('mapAssetUrl', () => {
  it.each(['commune 35238', 'EPCI 243500741', 'département 22', 'région 53'])('%s uses the canonical territory code', (territory) => {
    const code = territory.split(' ').at(-1)!
    expect(mapAssetUrl(code, 'bike', 'inline')).toBe(`https://images.calumrobertson.fr/maps/v1/${code}-bike-inline.webp`)
  })
  it.each(['car', 'walk', 'bike'] as const)('%s supports both image profiles', (mode) => {
    expect(mapAssetUrl('22002', mode, 'inline')).toContain(`22002-${mode}-inline.webp`)
    expect(mapAssetUrl('22002', mode, 'inspection')).toContain(`22002-${mode}-inspection.webp`)
  })
})
