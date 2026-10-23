import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const figureCss = readFileSync(
  join(process.cwd(), 'src', 'fiche', 'prototype', 'cahierFigure.css'),
  'utf8',
)
const layoutCss = readFileSync(
  join(process.cwd(), 'src', 'fiche', 'prototype', 'cahierLayout.css'),
  'utf8',
)
const varianteCahierLibreSource = readFileSync(
  join(process.cwd(), 'src', 'fiche', 'prototype', 'VarianteCahierLibre.vue'),
  'utf8',
)
const cahierEvidenceSource = readFileSync(
  join(process.cwd(), 'src', 'fiche', 'prototype', 'cahierEvidenceSource.css'),
  'utf8',
)
const lectureSource = readFileSync(
  join(process.cwd(), 'src', 'fiche', 'prototype', 'CahierFigureLecture.vue'),
  'utf8',
)
const comparisonSource = readFileSync(
  join(process.cwd(), 'src', 'fiche', 'prototype', 'CahierComparisonValue.vue'),
  'utf8',
)
const comparisonNoteSource = readFileSync(
  join(process.cwd(), 'src', 'fiche', 'prototype', 'CahierComparisonNote.vue'),
  'utf8',
)
const mapPanelSource = readFileSync(
  join(process.cwd(), 'src', 'fiche', 'prototype', 'CahierMapPanel.vue'),
  'utf8',
)
const blankMapSlotsSource = readFileSync(
  join(process.cwd(), 'src', 'fiche', 'prototype', 'CahierBlankMapSlots.vue'),
  'utf8',
)
const diversityMapSource = readFileSync(
  join(process.cwd(), 'src', 'fiche', 'prototype', 'AedarDiversityLossMapsCahier.vue'),
  'utf8',
)
const tokensSource = readFileSync(
  join(process.cwd(), 'src', 'styles', 'tokens.css'),
  'utf8',
)

function cahierStyleFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return cahierStyleFiles(path)
    return /\.(?:css|vue)$/u.test(entry.name) ? [path] : []
  })
}

function cssRule(source: string, selector: string): string {
  return source.match(new RegExp(`(?:^|\\n)${selector.replaceAll('.', '\\.') }\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ?? ''
}

describe('Cahier typography roles', () => {
  it('does not let the frame label tracking leak into values or comparisons', () => {
    expect(cssRule(figureCss, '.cahier-figure-scalar-value')).toContain('letter-spacing: normal')
    expect(cssRule(figureCss, '.cahier-figure-scalar-reference')).toContain('letter-spacing: normal')
    expect(cssRule(comparisonSource, '.cahier-comparison-value')).toContain('letter-spacing: normal')
    expect(cssRule(comparisonNoteSource, '.cahier-comparison-note')).toContain('letter-spacing: normal')
    expect(cssRule(layoutCss, '.cahier-figure-title')).toContain('letter-spacing: normal')
  })

  it('routes Cahier figure titles through the figure-title family role', () => {
    expect(cssRule(layoutCss, '.cahier-figure-title')).toContain(
      'font: var(--type-figure-title)',
    )
    expect(cssRule(layoutCss, '.cahier-figure-title')).toContain('color: var(--brand-700)')
    expect(tokensSource).toContain('--type-figure-title: 600 0.9375rem/1.25 var(--font-figure-title)')
    expect(tokensSource).toContain('--text-cahier-min-size: 0.6875rem')
    expect(tokensSource).toContain('--type-figure-tick-size: var(--text-cahier-min-size)')
    expect(cssRule(figureCss, '.cahier-figure-frame')).toContain(
      '--cahier-figure-tick-label-size: var(--type-figure-tick-size)',
    )
  })

  it('routes map labels, numbers, legends, and tooltips through shared text and contrast tokens', () => {
    expect(cssRule(figureCss, '.cahier-figure-legend')).toContain('font: var(--text-caption)')
    expect(cssRule(figureCss, '.cahier-figure-tooltip')).toContain('font: var(--text-caption)')
    expect(mapPanelSource).toContain('color: var(--color-figure-map-label)')
    expect(cssRule(mapPanelSource, '.map-panel-number')).toContain('font: var(--text-caption)')
    expect(blankMapSlotsSource).toMatch(/\.map-panel-label\s*\{[^}]*font:\s*var\(--text-overline\)/u)
    expect(blankMapSlotsSource).toMatch(/\.blank-map-slot__number\s*\{[^}]*font:\s*var\(--text-caption\)/u)
    expect(diversityMapSource).toContain('color: var(--color-figure-map-label)')
    expect(tokensSource).toContain('--color-figure-map-label: color-mix(in srgb, var(--brand-500) 45%, var(--editorial-ink))')
    expect(cssRule(figureCss, '.map-panel')).toContain(
      'var(--figure-map-accent, var(--mode-ring, var(--brand-500))) 45%',
    )
    expect(tokensSource).toContain('--color-figure-reference: color-mix(in srgb, var(--cahier-region-emphasis, var(--brand-500)) 30%, var(--editorial-ink))')
  })

  it('keeps Cahier text at or above 11px except for deliberate desktop editorial source stamps', () => {
    const undersized: string[] = []
    const sources = cahierStyleFiles(join(process.cwd(), 'src', 'fiche', 'prototype'))
    const sourceStampDecision =
      'Owner decision: source stamps are a deliberate quiet editorial size on desktop, below --text-caption, and rise to the 11px legibility floor on phones.'
    const sourceStampRole = '--text-source-stamp-size: 0.625rem;'

    for (const path of sources) {
      const source = readFileSync(path, 'utf8')
      for (const declaration of source.matchAll(/\bfont(?:-size)?\s*:\s*([^;]+);/gu)) {
        const directSizes = declaration[1].replace(/calc\([^()]*\)/gu, '')
        for (const size of directSizes.matchAll(/([\d.]+)(px|rem)(?=\s|\/|,|\)|$)/gu)) {
          const pixels = Number(size[1]) * (size[2] === 'rem' ? 16 : 1)
          if (pixels < 11) undersized.push(`${path}: ${declaration[0]}`)
        }
      }
    }

    expect(tokensSource).toContain(sourceStampRole)
    expect(tokensSource).toContain(sourceStampDecision)
    expect(tokensSource).toMatch(
      /\/\* Owner decision: source stamps are a deliberate quiet editorial size on desktop, below --text-caption, and rise to the 11px legibility floor on phones\. \*\/\s*--text-source-stamp-size:\s*0\.625rem;/u,
    )
    expect(tokensSource).toContain(
      'The 11px phone floor is applied to this size role in this single location.',
    )
    expect(tokensSource).toMatch(
      /@media\s*\(max-width:\s*760px\)\s*\{\s*:root\s*\{\s*--text-source-stamp-size:\s*0\.6875rem;\s*\}\s*\}/u,
    )
    expect(tokensSource.match(new RegExp(sourceStampDecision, 'gu'))).toHaveLength(1)
    expect(cahierEvidenceSource).toContain('font: 500 var(--text-source-stamp-size)/1.4 var(--font-metadata);')
    expect(varianteCahierLibreSource).toContain('font: 500 var(--text-source-stamp-size)/1.4 var(--font-metadata);')
    expect(cahierEvidenceSource).not.toContain('Source stamps are a deliberate quiet editorial size')
    expect(varianteCahierLibreSource).not.toContain('Source stamps are a deliberate quiet editorial size')
    expect(undersized).toEqual([])
  })

  it('uses one lecture size for the Lecture control and En savoir plus', () => {
    expect(tokensSource).toContain('--type-figure-lecture-size: 0.8125rem')
    expect(cssRule(lectureSource, '.cahier-figure-lecture')).toContain(
      'font-size: var(--type-figure-lecture-size)',
    )
    expect(cssRule(layoutCss, '.cahier-section-exploration .passarelle-exploration')).toContain(
      'font-size: var(--type-figure-lecture-size)',
    )
  })

  it('styles argument prose globally so nested evidence uses the same reading typography', () => {
    expect(cssRule(layoutCss, '.argument-copy')).toContain('font-size: 15px')
    expect(cssRule(layoutCss, '.argument-copy')).toContain('text-align: justify')
    expect(cssRule(layoutCss, '.argument-copy')).toContain('color: var(--cahier-default)')
    expect(cssRule(layoutCss, '.argument-copy')).toContain('margin: var(--cahier-grid-jump) 0 0')
  })

  it('keeps a moderate gap between shared y-axis titles and tick labels', () => {
    expect(cssRule(figureCss, '.cahier-figure-axis-title--y')).toContain(
      'left: calc(var(--cahier-figure-axis-title-y-left) + 8px)',
    )
  })

  it('lets the section 03 reading and plots use the full section draw area', () => {
    const accessEvidenceRule = varianteCahierLibreSource.match(/\.aedar-access-evidence\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(accessEvidenceRule).toContain('grid-column: 1 / -1')
    expect(accessEvidenceRule).toContain('width: 100%')
    expect(accessEvidenceRule).not.toMatch(/width:\s*min\(|max-width/)
  })

})
