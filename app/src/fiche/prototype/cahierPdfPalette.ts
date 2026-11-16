/**
 * Resolved palette for the shared Cahier PDF (#1024).
 *
 * The PDF cannot read CSS custom properties, so this module resolves the
 * existing token values — never new colours. The values mirror
 * `app/src/styles/tokens.css` and the Cahier's own mode aliases; the file
 * keeps them in one place so a renderer literal cannot drift on its own.
 * `cahier-pdf-composer.spec.ts` checks the token file still declares each
 * source value.
 */
export const PALETTE_PDF = {
  paper: '#f5f2eb',
  paperDeep: '#e6e1d7',
  ink: '#232a2a',
  muted: '#62706c',
  margin: '#a44f51',
  marginSoft: '#c69392',
  border: '#d6d4ce',
  borderLight: '#e2e8f0',
  textTertiary: '#a0aec0',
  brand200: '#83aca7',
  modeFoot: '#448fa6',
  modeBike: '#2e6171',
  modeCar: '#a94562',
  modeWalk: '#94bcc5',
  modeBikeLts2: '#88a2a8',
  white: '#ffffff',
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
  brand: PALETTE_PDF.brand200,
}

const TOKENS_PDF: Readonly<Record<string, string>> = {
  '--editorial-paper': PALETTE_PDF.paper,
  '--paper': PALETTE_PDF.paper,
  '--paper-deep': PALETTE_PDF.paperDeep,
  '--editorial-paper-deep': PALETTE_PDF.paperDeep,
  '--editorial-ink': PALETTE_PDF.ink,
  '--ink': PALETTE_PDF.ink,
  '--editorial-muted': PALETTE_PDF.muted,
  '--muted': PALETTE_PDF.muted,
  '--editorial-margin': PALETTE_PDF.margin,
  '--red': PALETTE_PDF.margin,
  '--red-soft': PALETTE_PDF.marginSoft,
  '--editorial-margin-soft': PALETTE_PDF.marginSoft,
  '--border-default': PALETTE_PDF.borderLight,
  '--text-tertiary': PALETTE_PDF.textTertiary,
  '--brand-200': PALETTE_PDF.brand200,
  '--cahier-mode-foot': PALETTE_PDF.modeFoot,
  '--cahier-mode-bike': PALETTE_PDF.modeBike,
  '--cahier-mode-car': PALETTE_PDF.modeCar,
  '--mode-transit': PALETTE_PDF.modeFoot,
  '--mode-bike': PALETTE_PDF.modeBike,
  '--mode-car': PALETTE_PDF.modeCar,
  '--cahier-theme-strong': PALETTE_PDF.ink,
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
  if (depth > 4) throw new Error(`Couleur PDF récursive : ${value}`)
  const trimmed = value.trim()
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase()
  const token = TOKENS_PDF[trimmed]
  if (token) return token
  const variable = /^var\(\s*(--[\w-]+)\s*\)$/.exec(trimmed)
  if (variable) {
    const resolved = TOKENS_PDF[variable[1]!]
    if (!resolved) throw new Error(`Jeton de couleur PDF inconnu : ${variable[1]}`)
    return resolved
  }
  const mix = /^color-mix\(\s*in\s+srgb\s*,\s*(.+?)\s+(\d+(?:\.\d+)?)%\s*,\s*(.+?)\s*\)$/.exec(trimmed)
  if (mix) {
    const premier = couleurPdf(mix[1]!, depth + 1)
    const second = couleurPdf(mix[3]!, depth + 1)
    return melange(Number(mix[2]), premier, second)
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
