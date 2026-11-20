/**
 * #1025 — producer drift guard for the shared export-surface contract.
 *
 * Every selector in CAHIER_EXPORT_SURFACE must still be emitted as MARKUP by
 * every producer that owns it, every emitter in the repository must be mapped,
 * and the generated mount stylesheet must scope EVERY selector (never leak a
 * `display:none` rule onto the live page). An independent, hardcoded witness
 * pins the contract itself, so deleting an entry from both the contract and the
 * producer map cannot stay green. Removing a selector from the contract, from
 * one of its producers, or adding a new emitter fails this suite.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CAHIER_EXPORT_SURFACE } from '@/fiche/prototype/cahierExportSurface'
import { buildExportSurfaceStylesheet, exportSurfaceScope, selectorList } from '@/fiche/prototype/cahierNativePdf'

const ROOT = join(process.cwd(), 'src')
const PRO = join(ROOT, 'fiche/prototype')
const raw = (path: string) => readFileSync(path, 'utf-8')

/**
 * Independent witness — deliberately NOT derived from the contract module.
 * Coordinated edits to the contract and its producer map cannot pass it.
 */
const CONTRACT_WITNESS = {
  hostClass: 'cahier-native-pdf-host',
  layoutHook: 'data-cahier-export-layout',
  layoutSpread: 'spread',
  proseSelector: '.argument-copy, .page-subtitle, .cahier-evidence-source:not(.cahier-map-legend__note)',
  documentOnlyProse: '.cahier-evidence-source:not(.cahier-map-legend__note)',
  hidden: [
    '.cahier-section-footer',
    '[role=tooltip]',
    '.cahier-rank',
    '.map-panel-number, .blank-map-slot__number, .aedar-diversity-loss-map__number',
    '.cahier-action-button',
    '.cahier-comparison-value__state',
    '[data-pdf-confirm]',
  ],
  neutralised: ['.concept-group', '.cahier-page', '.page-layout', '.page-main', '.page-heading'],
} as const

const LAYOUT_SELECTOR = `[${CAHIER_EXPORT_SURFACE.layoutHook}="${CAHIER_EXPORT_SURFACE.layoutSpread}"]`

// Every selector -> every .vue producer that emits it as markup.
// `.cahier-map-legend__note` is the NEGATED exception inside `:not(...)` — it is
// not a contract entry and is deliberately absent from this map.
const PRODUCERS: Readonly<Record<string, readonly string[]>> = {
  '.cahier-section-footer': ['VarianteCahierLibre.vue'],
  '[role=tooltip]': [
    'CahierFigureTooltip.vue', 'CahierComparisonValue.vue', 'CahierFigureLegend.vue',
    'ComparisonUnavailableCue.vue', 'ValeurComparaison.vue',
  ],
  '.cahier-rank': ['CahierRank.vue'],
  '.map-panel-number': ['CahierMapPanel.vue'],
  '.blank-map-slot__number': ['CahierBlankMapSlots.vue'],
  '.aedar-diversity-loss-map__number': ['AedarDiversityLossMapsCahier.vue'],
  '.cahier-action-button': ['CahierActionButton.vue'],
  '.cahier-comparison-value__state': ['CahierComparisonValue.vue'],
  '[data-pdf-confirm]': ['CahierPdfAction.vue'],
  [LAYOUT_SELECTOR]: [
    'VarianteCahierLibre.vue', 'AedarDiversityLossMapsCahier.vue',
    'CahierAedarAccessSection.vue', 'CahierMobiliteSection.vue',
  ],
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
  // neutralised presentation containers
  '.concept-group': ['VarianteCahierLibre.vue'],
  '.cahier-page': ['VarianteCahierLibre.vue'],
  '.page-layout': ['VarianteCahierLibre.vue'],
  '.page-main': ['VarianteCahierLibre.vue'],
  '.page-heading': ['VarianteCahierLibre.vue'],
}

function contractSelectors(): string[] {
  const parts = [
    ...CAHIER_EXPORT_SURFACE.hidden.flatMap(selectorList),
    ...selectorList(CAHIER_EXPORT_SURFACE.proseSelector),
    ...CAHIER_EXPORT_SURFACE.neutralised.flatMap(selectorList),
    LAYOUT_SELECTOR,
  ]
  return [...new Set(parts.map((value) => value.trim()).filter(Boolean))]
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:])\/\/[^\n]*/gu, '$1')
}

/**
 * Only the root `<template>` can emit markup; script strings and CSS rules
 * cannot. Nesting-aware: an inner `<template v-if>` must not end the block.
 */
function template(path: string): string {
  const source = raw(path)
  const open = source.match(/<template\b[^>]*>/iu)
  if (!open || open.index === undefined) return ''
  const tags = /<\/?template\b[^>]*>/giu
  tags.lastIndex = open.index
  let depth = 0
  let match: RegExpExecArray | null
  while ((match = tags.exec(source))) {
    depth += match[0].startsWith('</') ? -1 : 1
    if (depth === 0) {
      return source.slice(open.index + open[0].length, match.index).replace(/<!--[\s\S]*?-->/gu, '')
    }
  }
  return ''
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/** Class names actually emitted by a template: static `class` + Vue `:class` bindings. */
function classTokens(markup: string): Set<string> {
  const tokens = new Set<string>()
  for (const match of markup.matchAll(/\sclass=(["'])([^"']*)\1/gu)) {
    for (const token of match[2]!.split(/\s+/u)) if (token) tokens.add(token)
  }
  for (const match of markup.matchAll(/\s(?::class|v-bind:class)=(["'])([^"']*)\1/gu)) {
    const expression = match[2]!
    // Quoted strings and template literals are class lists. Strip ${...}
    // interpolations first so a dynamic suffix cannot fake a literal class.
    for (const quoted of expression.matchAll(/['"`]((?:\\.|(?!\1)[^\\])*)\1/gu)) {
      for (const token of quoted[1]!.replace(/\$\{[^}]*\}/gu, ' ').split(/[\s'"`]+/u)) {
        if (token) tokens.add(token)
      }
    }
    // Bare object keys: { active: cond } or an array identifier.
    for (const key of expression.matchAll(/(?<![\w-])([A-Za-z_][\w-]*)\s*:/gu)) tokens.add(key[1]!)
  }
  return tokens
}

/** Attribute selectors emitted by a template, with whole-name/whole-value boundaries. */
function emitsAttribute(markup: string, selector: string): boolean {
  const inner = selector.slice(1, -1)
  const eq = inner.indexOf('=')
  const name = eq < 0 ? inner : inner.slice(0, eq)
  if (eq < 0) {
    // Bare attribute: a whole attribute name, never a prefix of a longer one.
    return new RegExp(`\\s${escapeRe(name)}(?=[\\s=/>])`, 'u').test(markup)
  }
  const value = inner.slice(eq + 1).replace(/^"|"$/gu, '')
  // Exact static value with a closing boundary so `...-x` cannot satisfy it.
  if (new RegExp(`\\s${escapeRe(name)}="${escapeRe(value)}"(?=[\\s/>])`, 'u').test(markup)) return true
  // Vue-bound attribute: `:name="expression"`. A literal in the expression must
  // match the contract value. Only the layout hook has an owner-declared bound
  // value (checked against its renderer registry below); other contract
  // attributes are emitted with static literal values.
  const ownerDeclared = name === CAHIER_EXPORT_SURFACE.layoutHook
  const bound = new RegExp(`\\s:${escapeRe(name)}="([^"]*)"`, 'gu')
  for (const match of markup.matchAll(bound)) {
    const literals = [...match[1]!.matchAll(/['"`]([^'"`]*)['"`]/gu)].map((m) => m[1])
    if (literals.includes(value) || (ownerDeclared && !literals.length)) return true
  }
  return false
}

/** Normalise a contract selector to its producer-map key. */
function key(selector: string): string {
  return selector.startsWith('[') ? selector : selector.replace(/:not\(.*\)$/u, '')
}

function token(selector: string): string {
  if (selector.startsWith('[')) return selector.slice(1, -1)
  return key(selector).slice(1)
}

function emits(markup: string, selector: string): boolean {
  return selector.startsWith('[')
    ? emitsAttribute(markup, selector)
    : classTokens(markup).has(token(selector))
}

/** All source files that could emit markup — no tests, fixtures or the contract. */
function producerCandidates(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'fixtures' || entry.name === 'node_modules') continue
      found.push(...producerCandidates(full))
    } else if (entry.isFile() && /\.(vue|ts)$/u.test(entry.name)
      && entry.name !== 'cahierExportSurface.ts' && !/\.fixture\./u.test(entry.name)) {
      found.push(full)
    }
  }
  return found
}

const CANDIDATES = producerCandidates(ROOT)
const FILE_BY_NAME = new Map(CANDIDATES.map((path) => [basename(path), path]))

/** Resolve a mapped producer by file name, wherever it lives under `src/`. */
function producerTemplate(name: string): string {
  const path = FILE_BY_NAME.get(name)
  if (!path) throw new Error(`mapped producer ${name} not found in the repository`)
  return template(path)
}

describe('export surface producer drift (#1025)', () => {
  it('keeps the full contract against an independent witness', () => {
    expect(CAHIER_EXPORT_SURFACE).toEqual(CONTRACT_WITNESS)
  })

  it('maps every contract selector to every producer that emits it', () => {
    const selectors = contractSelectors()
    for (const selector of selectors) {
      const k = key(selector)
      expect(PRODUCERS[k], `${selector} (${k}) has no producer mapping`).toBeDefined()
      for (const file of PRODUCERS[k]!) {
        expect(emits(producerTemplate(file), selector),
          `${selector} no longer emitted as markup by ${file}`).toBe(true)
      }
    }
    // Reverse direction: removing a selector from the contract also fails.
    const contractKeys = selectors.map(key)
    for (const selector of Object.keys(PRODUCERS)) {
      expect(contractKeys, `producer mapping ${selector} is no longer in the contract`).toContain(selector)
    }
  })

  it('maps every emitter in the repository (an unmapped emitter fails)', () => {
    const selectors = contractSelectors()
    for (const path of CANDIDATES) {
      const markup = path.endsWith('.vue') ? template(path) : ''
      if (!markup) continue
      const name = basename(path)
      for (const selector of selectors) {
        if (!emits(markup, selector)) continue
        expect(PRODUCERS[key(selector)] ?? [],
          `${name} emits ${selector} but is not mapped`).toContain(name)
      }
    }
  })

  it('builds the host and its stylesheet scope from the one hostClass contract', () => {
    const source = stripComments(raw(join(PRO, 'cahierNativePdf.ts')))
    expect(source).toMatch(/host\.className\s*=\s*CAHIER_EXPORT_SURFACE\.hostClass/u)
    expect(source).toMatch(/exportSurfaceScope\(layout\.document\)/u)
    expect(source).not.toMatch(/['"`]cahier-native-pdf-host['"`]/u)
    expect(exportSurfaceScope(true)).toBe(`.${CAHIER_EXPORT_SURFACE.hostClass}[data-native-document]`)
    expect(exportSurfaceScope(false)).toBe(`.${CAHIER_EXPORT_SURFACE.hostClass}:not([data-native-document])`)
  })

  it('drives the reflow pass from the same layout and prose constants', () => {
    const source = stripComments(raw(join(PRO, 'cahierExportSurface.ts')))
    const body = source.slice(source.indexOf('export function reflowVisibleFigureTracks'))
    expect(body).toContain('surface.layoutHook')
    expect(body).toContain('surface.layoutSpread')
    expect(body).toContain('surface.proseSelector')
    expect(body).not.toMatch(/['"`]data-cahier-export-layout['"`]/u)
    expect(body).not.toMatch(/['"`]spread['"`]/u)
    // The shell declares the attribute through the renderer registry, whose
    // `exportLayout` value is the same contract spread token.
    expect(template(join(PRO, 'VarianteCahierLibre.vue')))
      .toContain(':data-cahier-export-layout="rendererFor(section).exportLayout"')
    expect(stripComments(raw(join(PRO, 'cahierSectionRenderers.ts'))))
      .toContain(`exportLayout: '${CAHIER_EXPORT_SURFACE.layoutSpread}'`)
  })
})

describe('export surface stylesheet scoping (#1025)', () => {
  it('scopes EVERY selector of EVERY generated rule — no rule leaks to the live page', () => {
    for (const document of [true, false]) {
      const scope = exportSurfaceScope(document)
      const css = buildExportSurfaceStylesheet(scope, 531, 0.5258083073, document)
      const rules = css.split('\n').filter((line) => line.includes('{'))
      expect(rules.length, 'no stylesheet rules generated').toBeGreaterThan(0)
      for (const rule of rules) {
        const selectors = selectorList(rule.slice(0, rule.indexOf('{')))
        for (const selector of selectors) {
          expect(selector.startsWith(`${scope} `),
            `unscoped rule leaks onto the live page: ${selector}`).toBe(true)
        }
      }
    }
  })

  it('emits one scoped rule per flattened contract selector', () => {
    const scope = exportSurfaceScope(true)
    const css = buildExportSurfaceStylesheet(scope, 531, 0.5258083073, true)
    const expected = [
      '.concept-group', '.cahier-figure-frame',
      ...CAHIER_EXPORT_SURFACE.neutralised.flatMap(selectorList),
      ...CAHIER_EXPORT_SURFACE.hidden.flatMap(selectorList),
      ...selectorList(CAHIER_EXPORT_SURFACE.proseSelector),
    ]
    for (const selector of expected) {
      expect(css, `${selector} missing from the mount stylesheet`).toContain(`${scope} ${selector} {`)
    }
  })
})
