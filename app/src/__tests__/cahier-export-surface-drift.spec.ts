/**
 * #1025 — producer drift guard for the shared export-surface contract.
 * The doc claims a listed selector disappearing from its producer fails a
 * test; this is that test.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PRO = 'src/fiche/prototype'
const read = (name: string) => readFileSync(join(process.cwd(), PRO, name), 'utf-8')

const PRODUCERS: Readonly<Record<string, readonly string[]>> = {
  '.cahier-section-footer': ['VarianteCahierLibre.vue'],
  '.cahier-rank': ['CahierRank.vue'],
  '.cahier-action-button': ['CahierActionButton.vue'],
  '.cahier-comparison-value__state': ['CahierComparisonValue.vue'],
  '.argument-copy': ['CahierProse.vue', 'VarianteCahierLibre.vue'],
  '.page-subtitle': ['VarianteCahierLibre.vue'],
  '.cahier-evidence-source': ['CahierEvidenceSource.vue', 'CahierContinuousMapLegend.vue'],
  '.cahier-map-legend__note': ['CahierContinuousMapLegend.vue'],
  'data-pdf-confirm': ['CahierPdfAction.vue'],
}

describe('export surface producer drift (#1025)', () => {
  it('fails when a listed selector disappears from its producer', () => {
    for (const [selector, files] of Object.entries(PRODUCERS)) {
      const token = selector.replace(/^\./, '').replace(/^\[|\]$/g, '')
      const found = files.some((file) => read(file).includes(token))
      expect(found, `${selector} missing from ${files.join(', ')}`).toBe(true)
    }
  })
})
