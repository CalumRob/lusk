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
    expect(tokensSource).toContain('--type-figure-tick-size: 0.6875rem')
    expect(cssRule(figureCss, '.cahier-figure-frame')).toContain(
      '--cahier-figure-tick-label-size: var(--type-figure-tick-size)',
    )
  })

  it('keeps Cahier text at or above 11px except for deliberate desktop editorial source stamps', () => {
    const undersized: string[] = []
    const sources = cahierStyleFiles(join(process.cwd(), 'src', 'fiche', 'prototype'))
    // Only these two source-stamp base rules may use a deliberate 10px desktop editorial size.
    const desktopEditorialSizeAllowlist = [
      { file: 'cahierEvidenceSource.css', selector: '.cahier-evidence-source' },
      { file: 'VarianteCahierLibre.vue', selector: '.margin-sources a' },
    ]

    for (const path of sources) {
      let source = readFileSync(path, 'utf8')
      const exception = desktopEditorialSizeAllowlist.find(({ file }) => path.endsWith(file))
      if (exception) {
        const ruleStart = source.indexOf(`${exception.selector} {`)
        const ruleEnd = source.indexOf('}', ruleStart)
        if (ruleStart < 0 || ruleEnd < 0) {
          throw new Error(`Expected desktop editorial source rule: ${exception.selector}`)
        }
        const rule = source.slice(ruleStart, ruleEnd + 1)
        expect(rule).toContain('font: 500 10px/1.4 var(--font-metadata);')
        expect(source).toContain('deliberate desktop editorial size')
        const desktopSourceRuleForFloorScan = rule.replace(
          'font: 500 10px/1.4 var(--font-metadata);',
          'font: 500 11px/1.4 var(--font-metadata);',
        )
        source = source.slice(0, ruleStart) + desktopSourceRuleForFloorScan + source.slice(ruleEnd + 1)
      }
      for (const declaration of source.matchAll(/\bfont(?:-size)?\s*:\s*([^;]+);/gu)) {
        const directSizes = declaration[1].replace(/calc\([^()]*\)/gu, '')
        for (const size of directSizes.matchAll(/([\d.]+)(px|rem)(?=\s|\/|,|\)|$)/gu)) {
          const pixels = Number(size[1]) * (size[2] === 'rem' ? 16 : 1)
          if (pixels < 11) undersized.push(`${path}: ${declaration[0]}`)
        }
      }
    }

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
