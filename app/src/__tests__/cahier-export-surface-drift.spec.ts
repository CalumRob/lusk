/**
 * #1025 — producer drift guard for the shared export-surface contract.
 * Every selector listed by CAHIER_EXPORT_SURFACE must still be emitted by its
 * real producer component. Removing a selector from a producer fails this test.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PRO = 'src/fiche/prototype'
const read = (name: string) => readFileSync(join(process.cwd(), PRO, name), 'utf-8')

// Each exported selector -> the file(s) that actually emit that class/attribute.
const PRODUCERS: Readonly<Record<string, readonly string[]>> = {
  // hidden chrome
  '.cahier-section-footer': ['VarianteCahierLibre.vue'],
  'role=tooltip': ['CahierFigureTooltip.vue', 'CahierComparisonValue.vue'],
  '.cahier-rank': ['CahierRank.vue'],
  '.map-panel-number': ['CahierMapPanel.vue'],
  '.blank-map-slot__number': ['CahierBlankMapSlots.vue'],
  '.aedar-diversity-loss-map__number': ['AedarDiversityLossMapsCahier.vue'],
  '.cahier-action-button': ['CahierActionButton.vue'],
  '.cahier-comparison-value__state': ['CahierComparisonValue.vue'],
  'data-pdf-confirm': ['CahierPdfAction.vue'],
  // prose roles (the single owned list)
  '.argument-copy': ['VarianteCahierLibre.vue', 'CahierAedarOverviewSection.vue'],
  '.page-subtitle': ['VarianteCahierLibre.vue'],
  '.cahier-evidence-source': ['CahierEvidenceSource.vue'],
  '.cahier-map-legend__note': ['CahierContinuousMapLegend.vue'],
}

describe('export surface producer drift (#1025)', () => {
  it('maps every listed selector to a producer that still emits it', () => {
    const listed = [
      ...(readFileSync(join(process.cwd(), PRO, 'cahierExportSurface.ts'), 'utf8').match(/\.[a-z][\w-]+/gu) ?? []),
    ]
    // Every key of the contract appears in the producer map.
    for (const selector of ['.cahier-section-footer', '.cahier-rank', '.cahier-action-button',
      '.cahier-comparison-value__state', '.map-panel-number', '.blank-map-slot__number',
      '.aedar-diversity-loss-map__number', '.argument-copy', '.page-subtitle',
      '.cahier-evidence-source', '.cahier-map-legend__note']) {
      expect(listed, `selector ${selector} absent from the export contract`).toContain(selector)
      expect(PRODUCERS[selector], `selector ${selector} has no producer mapping`).toBeDefined()
    }
    for (const [selector, files] of Object.entries(PRODUCERS)) {
      const token = selector === 'role=tooltip' ? 'role="tooltip"' : selector.replace(/^\./, '')
      // EVERY mapped producer must still emit the selector: a single missing
      // one fails the guard.
      expect(files.every((file) => read(file).includes(token)),
        `${selector} missing from one of ${files.join(', ')}`).toBe(true)
    }
  })
})
