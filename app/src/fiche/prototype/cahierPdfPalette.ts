/**
 * Resolved palette for the shared Cahier PDF (#1024).
 *
 * PDF paints cannot evaluate CSS. Resolve the actual bundled tokens.css and
 * the same scoped aliases as the screen, never a snapshot of today's hexes.
 * Only the colour expressions used by these owners are supported; unknown
 * expressions fail explicitly. The existing app OKLab primitive is reused.
 */
import tokensCss from '@/styles/tokens.css?raw'
import { melangerOklab } from '@/carte/couleurs'
import { CAHIER_COLOR_ROLES } from './cahierColorRoles'
import { AEDAR_TIME_MODE_COLORS } from './aedarTimeModeColors'

// No live screen/style introspection: these are immutable bundled owner inputs.
const TOKENS_PDF: Readonly<Record<string, string>> = {
  ...Object.fromEntries([...tokensCss.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)]
    .map((match) => [match[1]!, match[2]!.trim()])),
  ...CAHIER_COLOR_ROLES,
}

export const PALETTE_PDF = {
  paper: couleurPdf('--paper'),
  paperDeep: couleurPdf('--paper-deep'),
  ink: couleurPdf('--ink'),
  muted: couleurPdf('--muted'),
  margin: couleurPdf('--red'),
  marginSoft: couleurPdf('--red-soft'),
  border: couleurPdf('--editorial-page-border-color'),
  borderLight: couleurPdf('--border-default'),
  textTertiary: couleurPdf('--text-tertiary'),
  brand200: couleurPdf('--brand-200'),
  brand500: couleurPdf('--brand-500'),
  themeMobiliteStrong: couleurPdf('--cahier-theme-strong'),
  themeMobilite: couleurPdf('--cahier-theme'),
  modeFoot: couleurPdf('--cahier-mode-foot'),
  modeBike: couleurPdf('--cahier-mode-bike'),
  modeCar: couleurPdf('--cahier-mode-car'),
  modeWalk: couleurPdf(AEDAR_TIME_MODE_COLORS.walk),
  modeBikeLts2: couleurPdf(AEDAR_TIME_MODE_COLORS.bike_lts2),
  white: couleurPdf('--surface-primary'),
} as const

export type PdfPaletteKey = keyof typeof PALETTE_PDF

/** Mode colours used by the native AEDAR figures, resolved for PDF fills. */
export const COULEURS_MODES_PDF: Readonly<Record<string, string>> = {
  car: PALETTE_PDF.modeCar,
  bike_lts2: PALETTE_PDF.modeBikeLts2,
  bike_lts4: PALETTE_PDF.modeBike,
  transit: PALETTE_PDF.modeFoot,
  walk: PALETTE_PDF.modeWalk,
}

/** Native Mobilité tone inks for compared category bars. */
export const COULEURS_TONS_PDF: Readonly<Record<string, string>> = {
  t: PALETTE_PDF.modeFoot,
  b: PALETTE_PDF.modeBike,
  c: PALETTE_PDF.modeCar,
  neutral: PALETTE_PDF.muted,
  brand: PALETTE_PDF.brand500,
}

function melange(percent: number, a: string, b: string): string {
  const [r1, g1, b1] = hexVersRgb(a)
  const [r2, g2, b2] = hexVersRgb(b)
  const p = Math.max(0, Math.min(1, percent / 100))
  const canal = (x: number, y: number) => Math.round(x * p + y * (1 - p)).toString(16).padStart(2, '0')
  return `#${canal(r1, r2)}${canal(g1, g2)}${canal(b1, b2)}`
}

/**
 * Resolve a token/`color-mix` expression to a literal hex the PDF can paint.
 * Unknown expressions are rejected: a silently substituted colour would be a
 * visual lie, not a graceful fallback.
 */
export function couleurPdf(value: string, depth = 0): string {
  if (depth > 16) throw new Error(`Couleur PDF récursive : ${value}`)
  const trimmed = value.trim()
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase()
  const token = TOKENS_PDF[trimmed]
  if (token) return couleurPdf(token, depth + 1)
  const variable = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(trimmed)
  if (variable) {
    const resolved = TOKENS_PDF[variable[1]!]
    if (resolved) return couleurPdf(resolved, depth + 1)
    if (variable[2]) return couleurPdf(variable[2], depth + 1)
    throw new Error(`Jeton de couleur PDF inconnu : ${variable[1]}`)
  }
  const alphaRgb = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*(\d+(?:\.\d+)?)%\s*\)$/.exec(trimmed)
  if (alphaRgb) {
    const hex = `#${alphaRgb.slice(1, 4).map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`
    return melange(Number(alphaRgb[4]), hex, couleurPdf('--paper', depth + 1))
  }
  const mix = /^color-mix\(\s*in\s+(srgb|oklab)\s*,\s*(.+)\)$/.exec(trimmed)
  if (mix) {
    // A native light-mode comparison nests two mixes. Split only the outer
    // argument separator, not the commas inside var()/color-mix().
    let parentheses = 0
    let separator = -1
    for (let index = 0; index < mix[2]!.length; index += 1) {
      const character = mix[2]![index]
      if (character === '(') parentheses += 1
      if (character === ')') parentheses -= 1
      if (character === ',' && parentheses === 0) { separator = index; break }
    }
    const first = /^(.+)\s+(\d+(?:\.\d+)?)%$/.exec(mix[2]!.slice(0, separator).trim())
    if (separator < 0 || !first) throw new Error(`Mélange PDF non résolu : ${value}`)
    const premier = couleurPdf(first[1]!, depth + 1)
    const secondExpression = mix[2]!.slice(separator + 1).trim()
    // Raster/vector marks lie on the same opaque editorial paper. Resolve
    // transparency onto that paper, never onto a copied white/background.
    const second = couleurPdf(secondExpression === 'transparent' ? '--paper' : secondExpression, depth + 1)
    return mix[1] === 'oklab'
      ? melangerOklab(premier, second, Number(first[2]) / 100)
      : melange(Number(first[2]), premier, second)
  }
  throw new Error(`Couleur PDF non résolue : ${value}`)
}

export function hexVersRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(clean)) throw new Error(`Couleur PDF invalide : ${hex}`)
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
  ]
}
