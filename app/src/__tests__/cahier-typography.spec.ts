import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
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
// #1093 — the shared editorial page layer and its two consumers.
const sharedEditorialPageSource = readFileSync(
  join(process.cwd(), 'src', 'styles', 'editorialPage.css'),
  'utf8',
)
const atelierViewSource = readFileSync(
  join(process.cwd(), 'src', 'views', 'AtelierView.vue'),
  'utf8',
)
const atelierPageCssSource = readFileSync(
  join(process.cwd(), 'src', 'atelier', 'atelierPage.css'),
  'utf8',
)
const colorRolesSource = readFileSync(
  join(process.cwd(), 'src', 'styles', 'editorialPageRoles.ts'),
  'utf8',
)
const aedarAccessSectionSource = readFileSync(
  join(process.cwd(), 'src', 'fiche', 'prototype', 'CahierAedarAccessSection.vue'),
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
const cartographicBreakoutSource = readFileSync(
  join(process.cwd(), 'src', 'fiche', 'prototype', 'CartographicBreakoutPrototype.vue'),
  'utf8',
)
const sharedMapPanelLabelSource = readFileSync(
  join(process.cwd(), 'src', 'fiche', 'prototype', 'cahierMapPanelLabel.css'),
  'utf8',
)
const prototypeDirectory = join(process.cwd(), 'src', 'fiche', 'prototype')
const prototypeVueSources = readdirSync(prototypeDirectory)
  .filter((name) => name.endsWith('.vue'))
  .map((name) => ({ name, source: readFileSync(join(prototypeDirectory, name), 'utf8') }))

/**
 * Non-figure native titles tolerated in the prototype: rank chips and page
 * chrome. Any other native title on a figure mark is a defect.
 */
const NATIVE_TITLE_ALLOWLIST = new Map<string, RegExp>([
  ['CahierRank.vue', /class="cahier-rank/u],
  ['VarianteCahier.vue', /class="tuile-classement"/u],
  ['VarianteFil.vue', /class="bandeau-rang"/u],
  ['VarianteCahierLibre.vue', /class="page-heading-territory"/u],
])
const NATIVE_TAG_WITH_TITLE = /<([a-z][\w-]*)\b[^>]*?\s:?title=/gu
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
  return source.match(new RegExp(`(?:^|\\n)${selector.replaceAll('.', '\\.') }\\s*\\{([^}]*)\\}`))?.[1] ?? ''
}

function cssDeclarations(source: string, selector: string): Map<string, string> {
  return new Map(cssRule(source, selector).split(';').flatMap((declaration) => {
    const separator = declaration.indexOf(':')
    if (separator < 0) return []
    return [[declaration.slice(0, separator).trim(), declaration.slice(separator + 1).trim()]]
  }))
}

function expectMapLabelTreatment(
  source: string,
  selector: string,
  expectedColor: string,
  expectedTextShadow: string | null = null,
): void {
  const declarations = cssDeclarations(source, selector)
  expect(declarations.get('color'), `${selector} must retain its pre-W2 map-label ink`).toBe(expectedColor)
  for (const decoration of ['background', 'background-color', 'background-image', 'box-shadow']) {
    expect(declarations.has(decoration), `${selector} must not acquire ${decoration} treatment`).toBe(false)
  }
  expect(declarations.get('text-shadow') ?? null, `${selector} must preserve only its pre-W2 text shadow`).toBe(expectedTextShadow)
}

describe('Cahier typography roles', () => {
  it('does not let the frame label tracking leak into values or comparisons', () => {
    expect(cssRule(figureCss, '.cahier-figure-scalar-value')).toContain('letter-spacing: normal')
    expect(cssRule(figureCss, '.cahier-figure-scalar-reference')).toContain('letter-spacing: normal')
    expect(cssRule(comparisonSource, '.cahier-comparison-value')).toContain('letter-spacing: normal')
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

  it('keeps map titles and numbers on their original mode-specific color', () => {
    expect(cssRule(figureCss, '.cahier-figure-legend')).toContain('font: var(--text-caption)')
    expect(cssRule(figureCss, '.cahier-figure-tooltip')).toContain('font: var(--text-caption)')
    expectMapLabelTreatment(mapPanelSource, '.map-panel-number', 'var(--mode-ring)', '0 1px 4px var(--paper)')
    expect(cssRule(mapPanelSource, '.map-panel-number')).toContain('font: var(--text-caption)')
    expect(cssRule(mapPanelSource, '.map-panel-number')).toContain('letter-spacing: var(--text-caption-tracking)')
    expectMapLabelTreatment(sharedMapPanelLabelSource, '.map-panel-label', 'var(--mode-ring)')
    const mapTitleRule = cssRule(sharedMapPanelLabelSource, '.map-panel-label')
    expect(mapTitleRule).toContain('font: var(--text-overline)')
    expect(mapTitleRule).not.toMatch(/font-weight\s*:/u)
    expect(mapTitleRule).not.toMatch(/line-height\s*:/u)
    expect(mapTitleRule).toContain('letter-spacing: var(--text-overline-tracking)')
    expect(sharedMapPanelLabelSource).toMatch(
      /@media\s*\(max-width:\s*760px\)\s*\{\s*\.map-panel-label\s*\{[^}]*font:\s*var\(--text-caption\);/u,
    )
    expect(tokensSource).toContain('--text-caption: 500 0.75rem/1.4 var(--font-metadata)')
    expect(tokensSource).toContain('--text-overline: 600 0.6875rem/1.3 var(--font-metadata)')
    for (const source of [blankMapSlotsSource, diversityMapSource, cartographicBreakoutSource]) {
      expect(source).toContain('<style src="./cahierMapPanelLabel.css"></style>')
    }
    expectMapLabelTreatment(blankMapSlotsSource, '.blank-map-slot__number', 'var(--mode-ring)')
    expect(cssRule(blankMapSlotsSource, '.blank-map-slot__number')).toContain('font: var(--text-caption)')
    expectMapLabelTreatment(diversityMapSource, '.aedar-diversity-loss-map__number', 'var(--mode-ring)')
    expect(tokensSource).not.toContain('--color-figure-map-label')
    expect(figureCss).not.toContain('--color-figure-map-label')
    expect(tokensSource).toContain('--color-figure-reference: color-mix(in srgb, var(--brand-500) 30%, var(--editorial-ink))')
    expect(tokensSource).toContain('--color-figure-series-label: color-mix(in srgb, var(--brand-500) 45%, var(--editorial-ink))')
    expect(cssRule(figureCss, '.cahier')).toContain('var(--cahier-region-emphasis, var(--brand-500)) 30%')
    expect(cssRule(figureCss, '.cahier-figure-scalar--colored')).toContain(
      'var(--cahier-figure-scalar-color, var(--brand-500)) 45%',
    )
  })

  it('uses the existing light mint token only for the numeric comparison reference', () => {
    expect(cssRule(comparisonSource, '.cahier-comparison-value .region-emphasis'))
      .toContain('color: var(--brand-200)')
    expect(cssRule(comparisonSource, '.cahier-comparison-value'))
      .toContain('color: var(--cahier-default)')
    expect(comparisonSource).toContain('Groupe comparé :')
  })

  it('keeps the tooltip comparison one type step smaller with a brand-200 value and rank', () => {
    expect(cssRule(figureCss, '.cahier-figure-tooltip-row-comparison'))
      .toContain('font: var(--type-figure-comparison)')
    expect(cssRule(figureCss, '.cahier-figure-tooltip-comparison-value'))
      .toContain('color: var(--brand-200)')
    expect(cssRule(figureCss, '.cahier-figure-tooltip-comparison-rank'))
      .toContain('color: var(--brand-200)')
  })

  it('keeps a tooltip self-sufficient outside a figure frame', () => {
    const sharedTokens = figureCss.match(/\.cahier-figure-frame,\s*\.cahier-figure-tooltip\s*\{([^}]*)\}/u)?.[1] ?? ''
    expect(sharedTokens).toContain('--cahier-figure-surface: var(--paper, var(--editorial-paper))')
    expect(sharedTokens).toContain('--cahier-figure-surface-border:')
    expect(sharedTokens).toContain('--cahier-figure-surface-shadow:')
    const tooltipRule = cssRule(figureCss, '.cahier-figure-tooltip')
    expect(tooltipRule).toContain('background: var(--cahier-figure-surface)')
    expect(tooltipRule).toContain('border: 1px solid var(--cahier-figure-surface-border)')
    expect(tooltipRule).toContain('box-shadow: var(--cahier-figure-surface-shadow)')
  })

  it('leaves no native title on a figure mark across the prototype figures', () => {
    for (const { name, source } of prototypeVueSources) {
      for (const match of source.matchAll(NATIVE_TAG_WITH_TITLE)) {
        const allowed = NATIVE_TITLE_ALLOWLIST.get(name)?.test(match[0]) ?? false
        expect(allowed, `${name}: native title on <${match[1]}> — route figure tooltips through CahierFigureTooltip`).toBe(true)
      }
    }
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
    const accessEvidenceRule = aedarAccessSectionSource.match(/\.aedar-access-evidence\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(accessEvidenceRule).toContain('grid-column: 1 / -1')
    expect(accessEvidenceRule).toContain('width: 100%')
    expect(accessEvidenceRule).not.toMatch(/width:\s*min\(|max-width/)
  })

})

/**
 * #1093 — ONE owner per page role, consumed by both surfaces. The trap this
 * closes is scope-dependent styling: --paper and the page-heading rules used to
 * live only inside VarianteCahierLibre.vue's `<style scoped>`, so the Atelier
 * imported --paper and got white. These assertions pin the ownership seam;
 * the browser receipts pin the rendered look.
 */
describe('shared editorial page shell', () => {
  const appRoot = process.cwd()
  const ROLE_OWNER = 'src/styles/editorialPageRoles.ts'
  const STRUCTURE_OWNER = 'src/styles/editorialPage.css'
  // The responsive role legitimately has a base + two media declarations, all
  // in its one owner; the two ruling roles have one declaration each.
  const STRUCTURE_ROLES: Readonly<Record<string, number>> = {
    '--margin-line': 3,
    '--rule': 1,
    '--fine-rule': 1,
  }

  // Production sources: both app/src and app/scripts (a harness importing a
  // renamed export must not escape this seam). Test fixtures may inject roles
  // locally, so __tests__ is deliberately out of scope.
  function walk(directory: string): { path: string; source: string }[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const full = join(directory, entry.name)
      if (entry.isDirectory()) return entry.name === '__tests__' ? [] : walk(full)
      if (!/\.(?:ts|vue|css|mjs)$/u.test(entry.name)) return []
      return [{ path: relative(appRoot, full).replaceAll('\\', '/'), source: readFileSync(full, 'utf8') }]
    })
  }
  const productionSources = (): { path: string; source: string }[] =>
    ['src', 'scripts'].flatMap((directory) => walk(join(appRoot, directory)))

  function stripComments(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//gu, '')
      .replace(/(^|[^:])\/\/[^\n]*/gmu, '$1')
  }

  /**
   * Declaration-level count, not distinct files: a second declaration in the
   * owner itself must fail too. CSS declarations sit at the start of a line
   * (`--role:`, including inside @media); TS object keys are quoted and at the
   * start of a line. `var(--role, …)` usages and mid-line ternaries never match.
   */
  function declarationCount(path: string, source: string, role: string): number {
    const text = stripComments(source)
    const escaped = role.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    const cssCount = (text.match(new RegExp(`^\\s*${escaped}\\s*:`, 'gmu')) ?? []).length
    const tsCount = (text.match(new RegExp(`^\\s*['"]${escaped}['"]\\s*:`, 'gmu')) ?? []).length
    if (path.endsWith('.css')) return cssCount
    if (path.endsWith('.ts') || path.endsWith('.mjs')) return tsCount
    return cssCount + tsCount // .vue carries both a script and one or more styles
  }

  it('declares every role exactly once, at its single owner', () => {
    const sources = productionSources()
    // Derive the whole expected set from the owner's own keys, so a role added
    // later cannot escape the test. Values may be identifiers (cycle-shared).
    const moduleRoles = [...colorRolesSource.matchAll(/^\s*['"](--[\w-]+)['"]\s*:/gmu)]
      .map((match) => match[1]!)
    expect(moduleRoles.length).toBeGreaterThan(0)
    const expected = new Map<string, { owner: string; count: number }>([
      ...moduleRoles.map((role) => [role, { owner: ROLE_OWNER, count: 1 }] as const),
      ...Object.entries(STRUCTURE_ROLES).map(([role, count]) => [role, { owner: STRUCTURE_OWNER, count }] as const),
    ])
    for (const [role, { owner, count }] of expected) {
      let total = 0
      for (const { path, source } of sources) {
        const found = declarationCount(path, source, role)
        expect(found, `${role} may only be declared in ${owner}, not ${path}`).toBe(path === owner ? count : 0)
        total += found
      }
      expect(total, `${role} must have exactly ${count} declaration(s)`).toBe(count)
    }
  })

  it('has no dangling reference to the renamed role map', () => {
    const offenders = productionSources()
      .filter(({ source }) => /\bCAHIER_COLOR_ROLES\b/u.test(source))
      .map(({ path }) => path)
    expect(offenders).toEqual([])
  })

  it('owns the page surface and structure in CSS, consumed by both surfaces', () => {
    const page = cssRule(sharedEditorialPageSource, '.editorial-page')
    expect(page).toContain('color: var(--ink)')
    expect(page).toContain('background: transparent')
    expect(page).toContain('font-family: var(--font-body)')
    expect(page).not.toMatch(/--(?:paper|paper-deep|ink|muted|red|red-soft|cahier-default)\s*:/u)
    // The ruling rules moved verbatim: no brand fallback was introduced.
    expect(page).toContain('--rule: color-mix(in srgb, var(--cahier-theme) 19%, transparent)')
    expect(page).toContain('--fine-rule: color-mix(in srgb, var(--cahier-theme) 8%, transparent)')
    // Paper colour + ruling texture are one shared sheet, never a local copy.
    const sheet = cssRule(sharedEditorialPageSource, '.editorial-sheet')
    expect(sheet).toContain('background-color: var(--paper)')
    expect(sheet).toContain('repeating-linear-gradient')
    expect(sharedEditorialPageSource).toMatch(/@media\s*\(max-width:\s*760px\)[\s\S]*?--margin-line:\s*82px/u)
    expect(sharedEditorialPageSource).toMatch(/@media\s*\(max-width:\s*600px\)[\s\S]*?--margin-line:\s*12px/u)
    expect(varianteCahierLibreSource).not.toMatch(/\.cahier-page,\s*\.sources-page\s*\{[^}]*background-color:\s*var\(--paper\)/u)
    expect(atelierPageCssSource).not.toMatch(/\.atelier-page\s*\{[^}]*background-color:\s*var\(--paper\)/u)
    // Both import the layer, carry its classes and bind the one TS role map.
    expect(varianteCahierLibreSource).toContain("import '@/styles/editorialPage.css'")
    expect(atelierViewSource).toContain("import '@/styles/editorialPage.css'")
    expect(varianteCahierLibreSource).toMatch(/class="[^"]*\beditorial-page\b[^"]*"/u)
    expect(varianteCahierLibreSource).toMatch(/class="[^"]*\beditorial-sheet\b[^"]*"/u)
    expect(atelierViewSource).toMatch(/class="[^"]*\beditorial-page\b[^"]*"/u)
    expect(atelierViewSource).toMatch(/class="[^"]*\beditorial-sheet\b[^"]*"/u)
    expect(varianteCahierLibreSource).toContain(':style="EDITORIAL_PAGE_ROLES"')
    expect(atelierViewSource).toContain(':style="EDITORIAL_PAGE_ROLES"')
    expect(colorRolesSource).toContain('export const EDITORIAL_PAGE_ROLES')
  })

  it('owns the page-heading type once; each header composes over it', () => {
    const title = cssRule(sharedEditorialPageSource, '.editorial-page-title')
    expect(title).toContain('font: var(--text-page-heading)')
    expect(title).toContain('letter-spacing: var(--text-page-heading-tracking)')
    expect(title).toContain('color: var(--ink)')
    // The Cahier heading no longer carries the type declarations itself; it
    // opts into the shared type and keeps only its own alignment.
    const cahierHeading = cssRule(varianteCahierLibreSource, '.page-heading h2')
    expect(cahierHeading).not.toContain('font: var(--text-page-heading)')
    expect(cahierHeading).toContain('text-align: center')
    expect(varianteCahierLibreSource).toMatch(/class="cahier-baseline-anchor editorial-page-title"/u)
    // The Atelier imports the same type instead of copying the declarations.
    const atelierTitle = cssRule(atelierPageCssSource, '.atelier-titre')
    expect(atelierTitle).not.toContain('font: var(--text-page-heading)')
    expect(atelierTitle).not.toContain('letter-spacing: var(--text-page-heading-tracking)')
    expect(atelierViewSource).toContain('class="atelier-titre editorial-page-title"')
  })

  it('owns the thin red rule once; each header keeps its own real interface', () => {
    expect(cssRule(sharedEditorialPageSource, '.editorial-rule')).toContain('border-bottom: 1px solid var(--red-soft)')
    expect(cssRule(varianteCahierLibreSource, '.page-layout--sticky .page-heading')).not.toContain('border-bottom')
    expect(atelierPageCssSource).not.toMatch(/\.atelier-entete\s*\{[^}]*border-bottom/u)
    expect(varianteCahierLibreSource).toContain('class="page-heading editorial-rule"')
    expect(atelierViewSource).toContain('class="atelier-entete editorial-rule"')
    // Deletion test applied structurally: different interfaces, so two
    // compositions over the shared type/rule layer — not a slot-only header.
    expect(varianteCahierLibreSource).toContain('page-heading-index')
    expect(varianteCahierLibreSource).toContain('page-heading-comparaison')
    expect(atelierViewSource).toContain('atelier-partager')
    expect(atelierViewSource).not.toContain('page-heading-index')
    expect(atelierViewSource).not.toContain('page-heading-comparaison')
  })

  it('keeps the Atelier sheet on the clean ground of the production cahier', () => {
    // The Mobilité reference is indexed-sections: its sheet suppresses the
    // ruling. The Atelier imports the shared ground but makes the same choice,
    // so it is judged against that reference, not an ordinary fiche.
    expect(varianteCahierLibreSource).toMatch(/\.cahier--indexed-sections \.cahier-page,\s*\.cahier--indexed-sections \.sources-page\s*\{[^}]*background-image:\s*none/s)
    expect(cssRule(atelierPageCssSource, '.atelier-page')).toContain('background-image: none')
  })

  it('keeps the Cahier prose owner shared and the Atelier a consumer, not a copy', () => {
    expect(cssRule(layoutCss, '.argument-copy')).toContain('color: var(--cahier-default)')
    expect(cssRule(layoutCss, '.argument-copy')).toContain('font-size: 15px')
    expect(atelierViewSource).toContain("import '@/fiche/prototype/cahierLayout.css'")
    expect(atelierPageCssSource).not.toMatch(/\.argument-copy\s*\{/u)
    expect(atelierPageCssSource).not.toMatch(/\.cahier-prose\s*\{/u)
  })
})
