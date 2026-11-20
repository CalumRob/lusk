/**
 * #1025 — producer drift guard for the shared export-surface contract.
 *
 * Every selector in CAHIER_EXPORT_SURFACE must still be emitted as MARKUP by
 * every producer that owns it. Removing a selector from the contract, or from
 * one of its producers, fails this test.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CAHIER_EXPORT_SURFACE } from '@/fiche/prototype/cahierExportSurface'

const PRO = 'src/fiche/prototype'
const raw = (name: string) => readFileSync(join(process.cwd(), PRO, name), 'utf-8')
// Markup only: comments and CSS rules must not satisfy a producer mapping.
const markup = (name: string) => raw(name)
  .replace(/<!--[\s\S]*?-->/gu, '')
  .replace(/<style[^>]*>[\s\S]*?<\/style>/giu, '')

// Every selector -> every .vue producer that emits it as markup.
const PRODUCERS: Readonly<Record<string, readonly string[]>> = {
  '.cahier-section-footer': ['VarianteCahierLibre.vue'],
  '[role=tooltip]': ['CahierFigureTooltip.vue', 'CahierComparisonValue.vue', 'CahierFigureLegend.vue'],
  '.cahier-rank': ['CahierRank.vue'],
  '.map-panel-number': ['CahierMapPanel.vue'],
  '.blank-map-slot__number': ['CahierBlankMapSlots.vue'],
  '.aedar-diversity-loss-map__number': ['AedarDiversityLossMapsCahier.vue'],
  '.cahier-action-button': ['CahierActionButton.vue'],
  '.cahier-comparison-value__state': ['CahierComparisonValue.vue'],
  '[data-pdf-confirm]': ['CahierPdfAction.vue'],
  '.argument-copy': [
    'VarianteCahierLibre.vue', 'CahierAedarOverviewSection.vue', 'CahierAedarAccessSection.vue',
    'CahierAedarProfileSection.vue', 'AedarDiversityLossMapsCahier.vue',
    'AedarEquipmentExplorerCahier.vue', 'CahierMobiliteSection.vue',
  ],
  '.page-subtitle': ['VarianteCahierLibre.vue'],
  '.cahier-evidence-source': [
    'CahierEvidenceSource.vue', 'CahierBlankMapSlots.vue',
    'CahierContinuousMapLegend.vue', 'CahierMobiliteSection.vue',
  ],
  '.cahier-map-legend__note': ['CahierContinuousMapLegend.vue'],
  // neutralised presentation containers
  '.concept-group': ['VarianteCahierLibre.vue'],
  '.cahier-page': ['VarianteCahierLibre.vue'],
  '.page-layout': ['VarianteCahierLibre.vue'],
  '.page-main': ['VarianteCahierLibre.vue'],
  '.page-heading': ['VarianteCahierLibre.vue'],
}

function contractSelectors(): string[] {
  const parts = [
    ...CAHIER_EXPORT_SURFACE.hidden.flatMap((value) => value.split(',')),
    ...CAHIER_EXPORT_SURFACE.proseSelector.split(','),
    ...CAHIER_EXPORT_SURFACE.neutralised,
  ]
  return [...new Set(parts.map((value) => value.trim()).filter(Boolean))]
}

/** Normalise a contract selector to its markup token. */
function key(selector: string): string {
  return selector.startsWith('[') ? selector : selector.replace(/:not\(.*\)$/u, '')
}

function token(selector: string): string {
  if (selector.startsWith('[')) {
    const inner = selector.slice(1, -1)
    const eq = inner.indexOf('=')
    return eq < 0 ? inner : `${inner.slice(0, eq)}="${inner.slice(eq + 1)}"`
  }
  return selector.replace(/:not\(.*\)$/u, '')
}

function emits(source: string, selector: string): boolean {
  const t = token(selector)
  if (selector.startsWith('[')) return source.includes(t) || source.includes(selector.slice(1, -1))
  const cls = t.slice(1)
  // class="..." or :class="{ 'token': ... }" — no comments, no CSS rules.
  return new RegExp(`class="[^"]*\\b${cls}(?![\\w-])`, 'u').test(source)
    || new RegExp(`'${cls}'`, 'u').test(source)
}

describe('export surface producer drift (#1025)', () => {
  it('maps every contract selector to every producer that emits it', () => {
    const selectors = contractSelectors()
    for (const selector of selectors) {
      const k = key(selector)
      expect(PRODUCERS[k], `${selector} (${k}) has no producer mapping`).toBeDefined()
      for (const file of PRODUCERS[k]!) {
        expect(emits(markup(file), selector),
          `${selector} no longer emitted as markup by ${file}`).toBe(true)
      }
    }
    // Reverse direction: removing a selector from the contract also fails.
    const contractKeys = [
      ...selectors.map(key),
      ...selectors.flatMap((value) => [...value.matchAll(/:not\(\.?([\w-]+)\)/gu)].map((m) => `.${m[1]}`)),
    ]
    for (const selector of Object.keys(PRODUCERS)) {
      expect(contractKeys, `producer mapping ${selector} is no longer in the contract`).toContain(selector)
    }
  })
})
