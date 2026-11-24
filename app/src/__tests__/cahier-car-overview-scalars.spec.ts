/**
 * #1025 — comparison loading-state chrome must stay out of both export routes.
 * Rendered PDF geometry is covered by the browser-level verify:* acceptance
 * scripts; this unit gate protects the production export hide list.
 */
import { describe, expect, it } from 'vitest'

describe('overview scalars in every export route (#1025)', () => {
  it('never paints comparison loading-state chrome in the PDF', async () => {
    const { cahierExportHiddenSelectors } = await import('@/fiche/prototype/cahierExportSurface')
    for (const document of [true, false]) {
      expect(cahierExportHiddenSelectors(document).join(' '))
        .toContain('.cahier-comparison-value__state')
    }
  })
})
