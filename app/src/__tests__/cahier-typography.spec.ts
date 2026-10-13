import { readFileSync } from 'node:fs'
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
const tokensSource = readFileSync(
  join(process.cwd(), 'src', 'styles', 'tokens.css'),
  'utf8',
)

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
      'font-family: var(--font-figure-title)',
    )
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
