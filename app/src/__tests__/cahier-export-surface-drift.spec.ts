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
 *
 * Emission is read from parsed syntax, not just source substrings: SFC
 * templates are walked through `@vue/compiler-sfc` (static `class` and `:class`
 * bindings are tokenised from a real expression AST) and TS/TSX files through
 * the TypeScript AST (JSX attributes, `h()`/`class` object properties,
 * `.className`, `setAttribute` and `classList.add`). A separate blunt textual
 * net requires every raw selector mention to be mapped, catching emitters built
 * through script variables that the AST nets cannot see. LIMITATION: a name
 * assembled entirely at runtime (e.g. `'argu' + 'ment-copy'`) leaves no literal
 * for either net to find. Script strings and CSS rules alone cannot satisfy a
 * precise producer mapping; mention-only files are listed separately.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { babelParse, parse as parseSfc } from '@vue/compiler-sfc'
import {
  CAHIER_EXPORT_SURFACE, selectorList,
} from '@/fiche/prototype/cahierExportSurface'
import { buildExportSurfaceStylesheet, exportSurfaceScope } from '@/fiche/prototype/cahierNativePdf'
import { cahierSectionRendererFor } from '@/fiche/prototype/cahierSectionRenderers'
import { rendererFor } from '@/fiche/prototype/VarianteCahierLibre.vue'
import { cahierExportFixture } from './helpers/cahierExportFixtures'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
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

// Every selector -> every file that emits it as markup.
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

/**
 * Files that mention a contract selector without emitting it (comments, CSS,
 * querySelector consumers). The precise AST net still examines these files for
 * real emission; only the blunt textual net below needs them listed.
 */
const MENTION_ONLY: Readonly<Record<string, readonly string[]>> = {
  '.cahier-evidence-source': ['cahierPdfGrammaire.ts'],
  '.concept-group': [
    'cahierNativePdf.ts', 'cahierPdfComposer.ts', 'cahierPdfGrammaire.ts',
    'cahierPdfPalette.ts', 'useCahierBaselineGrid.ts',
  ],
  '.cahier-page': ['useCahierBaselineGrid.ts'],
  '.page-heading': [
    'cahierPdfComposer.ts', 'cahierPdfGrammaire.ts', 'cahierPdfPalette.ts',
    'useCahierBaselineGrid.ts',
  ],
}

function rawNeedle(selector: string): string {
  return selector.startsWith('[') ? selector.slice(1, -1) : selector
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

interface AttributeEmission {
  readonly values: Set<string>
  readonly expressions: string[]
}

interface Emissions {
  readonly classes: Set<string>
  readonly attributes: ReadonlyMap<string, AttributeEmission>
}

const emptyEmissions = (): Emissions => ({ classes: new Set(), attributes: new Map() })

function recordAttribute(emissions: Emissions, name: string): AttributeEmission {
  let record = emissions.attributes.get(name)
  if (!record) {
    record = { values: new Set(), expressions: [] }
    ;(emissions.attributes as Map<string, AttributeEmission>).set(name, record)
  }
  return record
}

/** Generic AST walk shared by Babel and Vue trees; never follows a node twice. */
function walkAny(node: unknown, visit: (node: any) => void, seen = new WeakSet<object>()): void {
  if (!node || typeof node !== 'object' || seen.has(node)) return
  seen.add(node)
  visit(node)
  for (const value of Object.values(node as Record<string, unknown>)) {
    if (Array.isArray(value)) value.forEach((item) => walkAny(item, visit, seen))
    else if (value && typeof value === 'object') walkAny(value, visit, seen)
  }
}

function words(value: string): string[] {
  return value.split(/\s+/u).filter(Boolean)
}

/** Tokenise a real `:class` expression AST: object keys, string and template literals. */
function expressionClassTokens(expression: string): string[] {
  const tokens = new Set<string>()
  const program = (babelParse(`(${expression})`) as any).program
  walkAny(program, (node: any) => {
    if (node.type === 'StringLiteral') words(String(node.value)).forEach((word) => tokens.add(word))
    else if (node.type === 'TemplateLiteral') {
      for (const quasi of node.quasis) words(String(quasi.value.cooked ?? '')).forEach((word) => tokens.add(word))
    } else if (node.type === 'ObjectProperty' && !node.computed && node.key?.type === 'Identifier') {
      tokens.add(String(node.key.name))
    }
  })
  return [...tokens]
}

/** Literals and the owner-declared registry accessor shape in a bound expression. */
function expressionInfo(expression: string): { literals: string[]; registryMember: boolean; accessor?: string } {
  const literals: string[] = []
  let registryMember = false
  let accessor: string | undefined
  const program = (babelParse(`(${expression})`) as any).program
  walkAny(program, (node: any) => {
    if (node.type === 'StringLiteral') literals.push(String(node.value))
    else if (node.type === 'TemplateLiteral') {
      for (const quasi of node.quasis) if (quasi.value.cooked) literals.push(String(quasi.value.cooked))
    } else if (node.type === 'MemberExpression' && !node.computed
      && node.property?.type === 'Identifier' && node.property.name === 'exportLayout'
      && node.object?.type === 'CallExpression') {
      registryMember = true
      if (node.object.callee?.type === 'Identifier') accessor = String(node.object.callee.name)
    }
  })
  return { literals, registryMember, accessor }
}

/** Parse an SFC and read emitted classes/attributes from its template AST. */
function sfcEmissions(path: string): Emissions {
  const { descriptor, errors } = parseSfc(raw(path), { filename: basename(path) })
  if (errors.length) throw new Error(`${path}: ${errors.map((error) => error.message).join(', ')}`)
  const emissions = emptyEmissions()
  const root = descriptor.template?.ast
  if (!root) return emissions
  walkAny(root, (node: any) => {
    if (node.type === 6 /* ATTRIBUTE */) {
      if (node.name === 'class') {
        words(String(node.value?.content ?? '')).forEach((token) => emissions.classes.add(token))
      } else {
        recordAttribute(emissions, String(node.name)).values.add(String(node.value?.content ?? ''))
      }
    } else if (node.type === 7 /* DIRECTIVE */ && node.name === 'bind'
      && node.arg?.type === 4 /* SIMPLE_EXPRESSION */) {
      const name = String(node.arg.content)
      const expression = node.exp?.content
      if (expression === undefined || expression === null) return
      if (name === 'class') {
        expressionClassTokens(String(expression)).forEach((token) => emissions.classes.add(token))
      } else {
        recordAttribute(emissions, name).expressions.push(String(expression))
      }
    }
  })
  return emissions
}

function sourceAst(path: string): ts.SourceFile {
  return ts.createSourceFile(basename(path), raw(path), ts.ScriptTarget.Latest, true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
}

function walkTs(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node)
  ts.forEachChild(node, (child) => walkTs(child, visit))
}

function findFunction(sf: ts.SourceFile, name: string): ts.FunctionDeclaration | undefined {
  let found: ts.FunctionDeclaration | undefined
  walkTs(sf, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node
  })
  return found
}

function isProseSelectorRef(node: ts.Expression): boolean {
  return (ts.isPropertyAccessExpression(node) && node.name.text === 'proseSelector')
    || (ts.isIdentifier(node) && node.text === 'proseSelector')
}

/** Parse TS/TSX and read markup emitted through JSX, `h()` props and DOM APIs. */
function tsEmissions(path: string): Emissions {
  const sf = sourceAst(path)
  const emissions = emptyEmissions()
  const literalWords = (node: ts.Expression | undefined): string[] => {
    if (!node) return []
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return words(node.text)
    if (ts.isTemplateExpression(node)) {
      return node.templateSpans.flatMap((span) => words(span.literal.text))
    }
    if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap((item) => literalWords(item))
    if (ts.isJsxExpression(node) && node.expression) return literalWords(node.expression)
    return []
  }
  const addClasses = (node: ts.Expression | undefined) =>
    literalWords(node).forEach((token) => emissions.classes.add(token))
  const isClassName = (text: string | undefined) => text === 'class' || text === 'className'
  const propNameText = (name: ts.Node): string | undefined => {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text
    if (ts.isJsxNamespacedName(name)) return name.name.text
    return undefined
  }
  walkTs(sf, (node) => {
    // `h('div', { class: 'token' })` and any object/JSX prop named class.
    if (ts.isPropertyAssignment(node) && isClassName(propNameText(node.name))) addClasses(node.initializer)
    if (ts.isJsxAttribute(node) && isClassName(propNameText(node.name))) addClasses(node.initializer)
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isPropertyAccessExpression(node.left) && node.left.name.text === 'className') {
      addClasses(node.right)
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf)
      if (callee.endsWith('setAttribute') && node.arguments.length >= 2) {
        const nameNode = node.arguments[0]!
        if (ts.isStringLiteral(nameNode)) {
          const name = nameNode.text
          const values = literalWords(node.arguments[1])
          if (isClassName(name)) values.forEach((token) => emissions.classes.add(token))
          else {
            const record = recordAttribute(emissions, name)
            values.forEach((value) => record.values.add(value))
            if (!values.length) record.expressions.push(node.arguments[1]!.getText(sf))
          }
        }
      }
      if (callee.endsWith('classList.add')) node.arguments.forEach((arg) => addClasses(arg))
    }
  })
  return emissions
}

function emissionsOf(path: string): Emissions {
  if (path.endsWith('.vue')) return sfcEmissions(path)
  if (/\.tsx?$/u.test(path)) return tsEmissions(path)
  return emptyEmissions()
}

/** Normalise a contract selector to its producer-map key. */
function key(selector: string): string {
  return selector.startsWith('[') ? selector : selector.replace(/:not\(.*\)$/u, '')
}

function token(selector: string): string {
  if (selector.startsWith('[')) return selector.slice(1, -1)
  return key(selector).slice(1)
}

function emits(emissions: Emissions, selector: string): boolean {
  if (!selector.startsWith('[')) return emissions.classes.has(token(selector))
  const inner = selector.slice(1, -1)
  const eq = inner.indexOf('=')
  const name = eq < 0 ? inner : inner.slice(0, eq)
  const record = emissions.attributes.get(name)
  if (!record) return false
  if (eq < 0) return true
  const value = inner.slice(eq + 1).replace(/^"|"$/gu, '')
  if (record.values.has(value)) return true
  for (const expression of record.expressions) {
    const info = expressionInfo(expression)
    if (info.literals.includes(value)) return true
    // The one owner-declared binding: its value is verified by CALLING the
    // renderer registry in the dedicated test below, never by trusting a bind.
    if (name === CAHIER_EXPORT_SURFACE.layoutHook && info.registryMember) return true
  }
  return false
}

/** All source files that could emit markup — no tests, fixtures or the contract. */
function producerCandidates(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'fixtures' || entry.name === 'node_modules') continue
      found.push(...producerCandidates(full))
    } else if (entry.isFile() && /\.(vue|ts|tsx)$/u.test(entry.name)
      && entry.name !== 'cahierExportSurface.ts' && !/\.fixture\./u.test(entry.name)) {
      found.push(full)
    }
  }
  return found
}

const CANDIDATES = producerCandidates(ROOT)
const BY_NAME = new Map<string, string[]>()
for (const path of CANDIDATES) {
  const name = basename(path)
  BY_NAME.set(name, [...(BY_NAME.get(name) ?? []), path])
}

/** Resolve a mapped producer by name; a silent basename collision is an error. */
function producerPath(name: string): string {
  const paths = BY_NAME.get(name) ?? []
  if (paths.length !== 1) {
    throw new Error(`producer ${name} resolves to ${paths.length} files: ${paths.join(', ')}`)
  }
  return paths[0]!
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
        expect(emits(emissionsOf(producerPath(file)), selector),
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
      const emissions = emissionsOf(path)
      const where = relative(ROOT, path)
      for (const selector of selectors) {
        if (!emits(emissions, selector)) continue
        const mapped = (PRODUCERS[key(selector)] ?? []).map(producerPath)
        expect(mapped, `${where} emits ${selector} but is not mapped`).toContain(path)
      }
    }
  })

  it('maps any raw selector mention in a scanned source (blunt superset net)', () => {
    // Deliberately textual: a class may be composed in `<script setup>`, a
    // render function or a TS variable and escape both AST nets. Any raw
    // occurrence must be mapped. LIMITATION: a name assembled entirely at
    // runtime (e.g. 'argu' + 'ment-copy') leaves no literal to find and is NOT
    // caught here — the producer contract still requires a static token.
    for (const path of CANDIDATES) {
      const where = relative(ROOT, path)
      const source = raw(path)
      for (const selector of contractSelectors()) {
        const needle = rawNeedle(selector)
        if (!source.includes(needle)) continue
        const k = key(selector)
        const mapped = [...(PRODUCERS[k] ?? []), ...(MENTION_ONLY[k] ?? [])].map(producerPath)
        expect(mapped, `${where} mentions ${needle} but is not mapped`).toContain(path)
      }
    }
  })

  it('builds the host and its stylesheet scope from the one hostClass contract', () => {
    const sf = sourceAst(join(PRO, 'cahierNativePdf.ts'))
    const fn = findFunction(sf, 'avecCorpsNatif')
    expect(fn).toBeDefined()
    const strings: string[] = []
    let assignsHostClass = false
    let buildsScope = false
    walkTs(fn!, (node) => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) strings.push(node.text)
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ts.isPropertyAccessExpression(node.left) && node.left.name.text === 'className'
        && ts.isPropertyAccessExpression(node.right) && node.right.name.text === 'hostClass') {
        assignsHostClass = true
      }
      if (ts.isCallExpression(node) && node.expression.getText(sf) === 'exportSurfaceScope'
        && node.arguments.some((arg) => arg.getText(sf) === 'layout.document')) {
        buildsScope = true
      }
    })
    expect(assignsHostClass, 'host.className no longer reads the contract hostClass').toBe(true)
    expect(buildsScope, 'the mount no longer builds its scope from the contract').toBe(true)
    expect(strings).not.toContain(CAHIER_EXPORT_SURFACE.hostClass)
    expect(exportSurfaceScope(true)).toBe(`.${CAHIER_EXPORT_SURFACE.hostClass}[data-native-document]`)
    expect(exportSurfaceScope(false)).toBe(`.${CAHIER_EXPORT_SURFACE.hostClass}:not([data-native-document])`)
  })

  it('drives the reflow pass from the same contract constants', () => {
    const sf = sourceAst(join(PRO, 'cahierExportSurface.ts'))
    const fn = findFunction(sf, 'reflowVisibleFigureTracks')
    expect(fn).toBeDefined()
    const identifiers: string[] = []
    const strings: string[] = []
    const proseAliases = new Set<string>()
    walkTs(fn!, (node) => {
      if (ts.isIdentifier(node)) identifiers.push(node.text)
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) strings.push(node.text)
      // A local alias (destructuring / `const p = surface.proseSelector`) is
      // still a use of the one shared selector, not a second hardcoded list.
      if (ts.isVariableDeclaration(node) && node.initializer && isProseSelectorRef(node.initializer)
        && ts.isIdentifier(node.name)) {
        proseAliases.add(node.name.text)
      }
    })
    const isProseUse = (node: ts.Expression) =>
      isProseSelectorRef(node) || (ts.isIdentifier(node) && proseAliases.has(node.text))
    let proseCalls = 0
    walkTs(fn!, (node) => {
      if (!ts.isCallExpression(node)) return
      const callee = node.expression
      if (!ts.isPropertyAccessExpression(callee)
        || !['matches', 'querySelector', 'querySelectorAll', 'closest'].includes(callee.name.text)) return
      const arg = node.arguments[0]
      if (!arg) return
      if (isProseUse(arg)) proseCalls += 1
      if (ts.isStringLiteral(arg) && /argument-copy|page-subtitle|cahier-evidence-source/u.test(arg.text)) {
        throw new Error(`reflow hardcodes a prose role instead of the shared selector: ${arg.text}`)
      }
    })
    // Identifiers, not source substrings: survives destructuring and reformatting.
    expect(identifiers).toContain('layoutHook')
    expect(identifiers).toContain('layoutSpread')
    expect(strings).not.toContain(CAHIER_EXPORT_SURFACE.layoutHook)
    expect(strings).not.toContain(CAHIER_EXPORT_SURFACE.layoutSpread)
    for (const text of strings) {
      expect(text).not.toMatch(/argument-copy|page-subtitle|cahier-evidence-source/u)
    }
    // Every prose-consuming call site still reads the ONE shared selector.
    expect(proseCalls).toBeGreaterThanOrEqual(3)
  })

  it('resolves the bound layout hook to the contract spread by CALLING the shell resolver', () => {
    const shell = sfcEmissions(join(PRO, 'VarianteCahierLibre.vue'))
    const bound = shell.attributes.get(CAHIER_EXPORT_SURFACE.layoutHook)?.expressions ?? []
    expect(bound.length, 'the shell no longer binds the layout hook').toBe(1)
    const info = expressionInfo(bound[0]!)
    expect(info.literals).toEqual([])
    expect(info.registryMember, 'binding is no longer the owner-declared resolver accessor').toBe(true)
    expect(info.accessor, 'binding no longer uses the shell-exported resolver').toBe('rendererFor')

    const sf = sourceAst(join(PRO, 'VarianteCahierLibre.vue'))
    const accessor = findFunction(sf, 'rendererFor')
    expect(accessor, 'the shell no longer exports its resolver').toBeDefined()
    let delegates = false
    walkTs(accessor!, (node) => {
      if (ts.isCallExpression(node) && node.expression.getText(sf) === 'cahierSectionRendererFor') delegates = true
    })
    expect(delegates, 'rendererFor no longer reads cahierSectionRendererFor').toBe(true)

    // CALL the very resolver the template binds: a returned object that strips
    // `exportLayout` for prose sections fails here, even though every grep and
    // registry-only assertion still passes.
    // Exercise both the prose and no-prose shapes: the fixture's sections carry
    // `lecture: null`, while a real prose section has a truthy Lecture. A
    // resolver that strips the layout only for prose must fail too.
    const sections = cahierExportFixture({}).content.units.flatMap((unit) => unit.sections)
      .flatMap((base) => [base, { ...base, lecture: { marelle: base.label, prose: [] } } as typeof base])
    expect(sections.length, 'fixture has no sections').toBeGreaterThan(0)
    const withLayout: string[] = []
    const without: string[] = []
    for (const section of sections) {
      const declared = cahierSectionRendererFor(section.evidence, true).exportLayout
      const actual = rendererFor(section, true).exportLayout
      expect(actual, `${section.key}: shell resolver diverged from its renderer`).toBe(declared)
      if (declared === undefined) without.push(section.key)
      else {
        withLayout.push(section.key)
        expect(actual, `${section.key}: shell resolver dropped the layout`).toBe(CAHIER_EXPORT_SURFACE.layoutSpread)
      }
    }
    expect(withLayout.length, 'no section resolves to the declared layout').toBeGreaterThan(0)
    expect(without.length, 'no legitimately layout-free section in the fixture').toBeGreaterThan(0)
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
