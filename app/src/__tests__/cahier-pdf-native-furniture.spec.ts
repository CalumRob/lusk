/**
 * #1024 — export visibility contract for page furniture. Rendered placement is
 * covered by the browser-level verify:* acceptance scripts.
 */
import { describe, expect, it } from 'vitest'

describe('Cahier PDF natif — mobilier de page', () => {
  it('hides prose in both routes but evidence stamps only in the document route', async () => {
    const { cahierExportHiddenSelectors } = await import('@/fiche/prototype/cahierExportSurface')
    for (const document of [true, false]) {
      const hidden = cahierExportHiddenSelectors(document).join(' ')
      expect(hidden).toContain('.cahier-action-button')
      expect(hidden).toContain('.argument-copy')
      expect(hidden).toContain('.page-subtitle')
      expect(hidden.includes('.cahier-evidence-source:not(.cahier-map-legend__note)')).toBe(document)
    }
  })
})
