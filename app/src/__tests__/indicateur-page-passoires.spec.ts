import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { normalizeComparisonFacet } from '../indicateurs/familySeam'

/**
 * #474 — the app-owned Habitat page declarations keep passoires as a scalar
 * page and DPE as a profile. Numerical consumer behavior is exercised against
 * compact synthetic API observations in profile-page-api.spec.ts.
 */
const publicDir = join(process.cwd(), '..', 'public', 'data')
const canonicalFile = join(process.cwd(), '..', 'pipeline', 'inst', 'extdata', 'theme-metadata', 'theme_habitat.json')

interface PageHabitat {
  indicator: string
  label: string
  definition: string
  unit: string
  calculation: string
  direction: string
  caveats: string
  levels: string[]
  sources: string[]
  family?: string
  comparison?: { indicator?: string; label?: string; unit?: string; direction?: string }
}

function readHabitat(file: string) {
  return JSON.parse(readFileSync(file, 'utf8')) as { indicator_pages: Record<string, PageHabitat> }
}

const canonicalHabitat = readHabitat(canonicalFile)
const publicHabitat = readHabitat(join(publicDir, 'theme_habitat.json'))

describe('descripteur part_passoires — canon producteur et snapshot navigateur (#474)', () => {
  it('declares the scalar page and its self-owned comparison facet in both metadata layers', () => {
    for (const [origin, metadata] of [['producer', canonicalHabitat], ['browser', publicHabitat]] as const) {
      const page = metadata.indicator_pages.part_passoires
      expect(page, origin).toBeDefined()
      expect(page!.family, origin).toBe('scalar')
      expect(page!.label, origin).toBe('Part de passoires thermiques')
      expect(page!.unit, origin).toBe('%')
      expect(page!.direction, origin).toBe('low')
      expect(page!.definition.length, origin).toBeGreaterThan(0)
      expect(page!.calculation.length, origin).toBeGreaterThan(0)
      expect(page!.caveats.length, origin).toBeGreaterThan(0)
      expect(page!.levels, origin).toEqual(['commune', 'epci', 'departement'])
      expect(page!.sources, origin).toContain('dpe_22')
      expect(page!.comparison, origin).toMatchObject({
        indicator: 'part_passoires', label: 'Part de passoires thermiques', unit: '%', direction: 'low',
      })
    }
    expect(canonicalHabitat.indicator_pages.part_passoires)
      .toEqual(publicHabitat.indicator_pages.part_passoires)
  })

  it('keeps the declared Habitat page roster closed', () => {
    expect(Object.keys(publicHabitat.indicator_pages).sort()).toEqual([
      'age_du_bati', 'distribution_dpe', 'mix_logements', 'part_passoires', 'prix_m2', 'statut', 'type',
    ])
  })

  it('resolves the scalar comparison facet to the page itself', () => {
    const page = { ...publicHabitat.indicator_pages.part_passoires!, family: 'scalar' } as
      Parameters<typeof normalizeComparisonFacet>[0]
    expect(normalizeComparisonFacet(page, {}, 'habitat')).toMatchObject({
      indicator: 'part_passoires', label: 'Part de passoires thermiques', unit: '%', direction: 'low', valid: true,
    })
  })
})
