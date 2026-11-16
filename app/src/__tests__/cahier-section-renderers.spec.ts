import { describe, expect, it } from 'vitest'
import { cahierSectionRendererFor, CAHIER_SECTION_RENDERERS } from '@/fiche/prototype/cahierSectionRenderers'
import type { ContentEvidence } from '@/fiche/content/themeContent'

describe('Cahier section renderer admission (#956)', () => {
  it('covers every section evidence kind, retaining the Mobilité delegate', () => {
    expect(Object.keys(CAHIER_SECTION_RENDERERS).sort()).toEqual([
      'aedar-access', 'aedar-car-overview', 'aedar-diversity-loss',
      'aedar-equipment-explorer', 'aedar-equipment-profile',
      'mobilite-networks', 'mobilite-raccordement', 'mobilite-share',
      'mobilite-stationnement-ravitaillement',
    ])
    const mobilite = cahierSectionRendererFor({ kind: 'mobilite-share' } as ContentEvidence, false)
    expect(mobilite.classes).toEqual(['mobilite-delegate'])
  })

  it('uses an explicit fallback for null evidence and disabled AEDAR, never admitting their assets', () => {
    const pending = cahierSectionRendererFor(null, true)
    expect(pending.body).toBeNull()
    expect(pending.argument).toBe(true)
    for (const kind of ['aedar-access', 'aedar-car-overview', 'aedar-diversity-loss',
      'aedar-equipment-explorer', 'aedar-equipment-profile'] as const) {
      const evidence = { kind } as ContentEvidence
      expect(cahierSectionRendererFor(evidence, false)).toBe(pending)
      expect(cahierSectionRendererFor(evidence, true).body).not.toBeNull()
    }
  })
})
