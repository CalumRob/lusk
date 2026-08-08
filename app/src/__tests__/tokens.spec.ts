import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Contract test for the DESIGN.md token layer.
 *
 * DESIGN.md (repo root) is the single source of truth: "No component is
 * written without reading this file." This spec reads src/styles/tokens.css
 * and asserts every §2/§3/§4/§7 token exists with the exact value DESIGN.md
 * specifies. If DESIGN.md changes, this spec changes — not the other way
 * around.
 */

const tokensPath = join(process.cwd(), 'src', 'styles', 'tokens.css')
const css = readFileSync(tokensPath, 'utf-8')

function parseTokens(source: string): Map<string, string> {
  const rootMatch = source.match(/:root\s*{([\s\S]*?)}/)
  const block = rootMatch ? rootMatch[1] : source
  const tokens = new Map<string, string>()
  const declRe = /--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g
  let m: RegExpExecArray | null
  while ((m = declRe.exec(block)) !== null) {
    tokens.set(`--${m[1]}`, m[2].trim())
  }
  return tokens
}

const tokens = parseTokens(css)

function expectToken(name: string, value: string) {
  expect(tokens.get(name), `expected --${name} to be declared`).toBe(value)
}

describe('DESIGN.md §2 — Color palette', () => {
  it('exposes the four surface tokens', () => {
    expectToken('--surface-secondary', '#F8FBFB')
    expectToken('--surface-primary', '#FFFFFF')
    expectToken('--surface-tertiary', '#F0F6F5')
    expectToken('--surface-elevated', '#FFFFFF')
  })

  it('exposes the three text tokens', () => {
    expectToken('--text-primary', '#2D3748')
    expectToken('--text-secondary', '#718096')
    expectToken('--text-tertiary', '#A0AEC0')
  })

  it('exposes the two border tokens', () => {
    expectToken('--border-default', '#E2E8F0')
    expectToken('--border-subtle', '#EDF1F1')
  })
})

describe('DESIGN.md §2 — Brand ramp', () => {
  it('locks the fixed identity steps', () => {
    expectToken('--brand-50', '#F0F6F5')
    expectToken('--brand-100', '#CCE3DE')
    expectToken('--brand-200', '#83ACA7')
    expectToken('--brand-500', '#57726F')
  })

  it('derives the intermediate steps from the anchor via color-mix', () => {
    expectToken('--brand-300', 'color-mix(in oklab, var(--brand-500) 60%, #FFFFFF)')
    expectToken('--brand-600', 'color-mix(in oklab, var(--brand-500) 85%, #0C1B19)')
    expectToken('--brand-700', 'color-mix(in oklab, var(--brand-500) 62%, #0C1B19)')
    expectToken('--brand-900', 'color-mix(in oklab, var(--brand-500) 35%, #0C1B19)')
  })
})

describe('DESIGN.md §2 — Interactive', () => {
  it('exposes accent + focus tokens', () => {
    expectToken('--accent-primary', 'var(--brand-500)')
    expectToken('--accent-hover', 'var(--brand-600)')
    expectToken('--focus-ring', '2px solid var(--brand-500)')
  })
})

describe('DESIGN.md §2 — Theme colors', () => {
  const themes = {
    mobilite: '#6BA3B5',
    demographie: '#8E85C4',
    habitat: '#C98F6E',
    economie: '#D9A441', // or/ambre (ADR décision #214) — distincte du vert-bleu de marque
    milieux: '#A99A5E', // le cinquième thème (ADR-0014) — l'ancre provisoire de l'axe terre
  }

  it('declares one anchor per theme', () => {
    for (const [theme, anchor] of Object.entries(themes)) {
      expectToken(`--theme-${theme}`, anchor)
    }
  })

  it('derives the four roles programmatically from each anchor', () => {
    for (const theme of Object.keys(themes)) {
      expectToken(
        `--theme-${theme}-wash`,
        `color-mix(in oklab, var(--theme-${theme}) 8%, var(--surface-secondary))`,
      )
      expectToken(
        `--theme-${theme}-soft`,
        `color-mix(in oklab, var(--theme-${theme}) 16%, var(--surface-primary))`,
      )
      expectToken(`--theme-${theme}-line`, `var(--theme-${theme})`)
      expectToken(
        `--theme-${theme}-strong`,
        `color-mix(in oklab, var(--theme-${theme}) 62%, #0C1B19)`,
      )
    }
  })

  it('does not introduce a fifth color system (general = brand ramp)', () => {
    expect(tokens.has('--theme-general')).toBe(false)
    expect(tokens.has('--theme-general-wash')).toBe(false)
  })
})

describe('DESIGN.md §2 — Modes', () => {
  it('preserves the semantic mode colors', () => {
    expectToken('--mode-transit', '#448FA6')
    expectToken('--mode-bike', '#2E6171')
    expectToken('--mode-car', '#A94562')
  })

  it('exposes the two gradients', () => {
    expectToken('--gradient-modes', 'linear-gradient(90deg, #448FA6, #2E6171, #A94562)')
    expectToken('--gradient-main', 'linear-gradient(90deg, #448FA6, #2E6171)')
  })
})

describe('DESIGN.md §2 — Status', () => {
  it('exposes the four status colors', () => {
    expectToken('--status-success', '#2EA043')
    expectToken('--status-warning', '#D97706')
    expectToken('--status-error', '#CB2431')
    expectToken('--status-info', 'var(--brand-500)')
  })
})

describe('DESIGN.md §3 — Typography', () => {
  it('declares the three font stacks (Fontsource self-hosted)', () => {
    expectToken("--font-sans", "'Manrope Variable', system-ui, -apple-system, sans-serif")
    expectToken(
      '--font-serif',
      "'Newsreader Variable', Georgia, 'Times New Roman', serif",
    )
    expectToken(
      '--font-mono',
      "ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, monospace",
    )
  })

  it('encodes the type scale (size, weight, line-height, tracking)', () => {
    expectToken('--text-display', "600 clamp(2.25rem, 4vw, 3rem)/1.15 var(--font-serif)")
    expectToken('--text-display-tracking', '-0.01em')

    expectToken('--text-h1', "700 clamp(1.75rem, 3vw, 2rem)/1.2 var(--font-sans)")
    expectToken('--text-h1-tracking', '-0.015em')

    expectToken('--text-h2', "600 1.5rem/1.3 var(--font-sans)")
    expectToken('--text-h2-tracking', '-0.01em')

    expectToken('--text-h3', "600 1.1875rem/1.4 var(--font-sans)")
    expectToken('--text-h3-tracking', '0')

    expectToken('--text-body-lg', "400 1.125rem/1.6 var(--font-sans)")
    expectToken('--text-body-lg-tracking', '0')

    expectToken('--text-body', "400 1rem/1.6 var(--font-sans)")
    expectToken('--text-body-tracking', '0')

    expectToken('--text-body-sm', "400 0.875rem/1.5 var(--font-sans)")
    expectToken('--text-body-sm-tracking', '0')

    expectToken('--text-caption', "500 0.75rem/1.4 var(--font-sans)")
    expectToken('--text-caption-tracking', '0.02em')

    expectToken('--text-overline', "600 0.6875rem/1.3 var(--font-sans)")
    expectToken('--text-overline-tracking', '0.08em')
  })

  it('tokenizes the numeric style (Manrope 600, tabular-nums)', () => {
    expectToken('--text-numeric-weight', '600')
    expectToken('--text-numeric-variant', 'tabular-nums')
  })
})

describe('DESIGN.md §4 — Spacing & layout', () => {
  it('declares the 4px-based space scale', () => {
    const scale: Record<string, string> = {
      '--space-1': '4px',
      '--space-2': '8px',
      '--space-3': '12px',
      '--space-4': '16px',
      '--space-5': '20px',
      '--space-6': '24px',
      '--space-8': '32px',
      '--space-10': '40px',
      '--space-12': '48px',
      '--space-16': '64px',
      '--space-20': '80px',
      '--space-24': '96px',
    }
    for (const [name, value] of Object.entries(scale)) {
      expectToken(name, value)
    }
  })

  it('declares the grid/shell tokens', () => {
    expectToken('--content-max-width', '1200px')
    expectToken('--header-max-width', '1400px')
    expectToken('--grid-columns', '12')
    expectToken('--grid-gutter', '24px')
    expectToken('--grid-margin-mobile', '16px')
    expectToken('--header-height', '60px')
  })

  it('declares the four breakpoints', () => {
    expectToken('--breakpoint-sm', '640px')
    expectToken('--breakpoint-md', '768px')
    expectToken('--breakpoint-lg', '1024px')
    expectToken('--breakpoint-xl', '1280px')
  })

  it('declares radii, shadows and z-index', () => {
    expectToken('--radius-sm', '6px')
    expectToken('--radius-md', '8px')
    expectToken('--radius-lg', '12px')
    expectToken('--radius-full', '999px')

    expectToken('--shadow-subtle', '0 1px 2px rgba(0,0,0,0.04)')
    expectToken(
      '--shadow-default',
      '0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03)',
    )
    expectToken('--shadow-prominent', '0 8px 24px rgba(0,0,0,0.12)')

    expectToken('--z-sticky', '100')
    expectToken('--z-header', '1000')
    expectToken('--z-drawer', '1100')
    expectToken('--z-overlay', '1200')
    expectToken('--z-popover', '1300')
    expectToken('--z-toast', '1400')
  })
})

describe('DESIGN.md §7 — Depth & surface', () => {
  it('declares the chrome backdrop recipe', () => {
    expectToken('--surface-chrome', 'rgba(255,255,255,0.8)')
    expectToken('--blur-chrome', '12px')
  })

  it('declares the hero band surface — the landing hero’s branded ground (V8 mock)', () => {
    expectToken(
      '--surface-hero',
      'radial-gradient(46rem 32rem at 82% -6%, color-mix(in oklab, var(--brand-100) 55%, transparent), transparent 70%), var(--surface-secondary)',
    )
  })

  it('declares the filigrane tokens — the fiche watermark (opacity + width range)', () => {
    expectToken('--filigrane-opacity', '0.08')
    expectToken('--filigrane-largeur-min', 'min(24vw, 280px)')
    expectToken('--filigrane-largeur-max', 'min(64vw, 680px)')
  })
})
