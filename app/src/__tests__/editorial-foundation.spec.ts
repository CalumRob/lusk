import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')

describe('shared E editorial foundation', () => {
  it('exposes observed E decisions as site-wide tokens', () => {
    const tokens = read('src/styles/tokens.css')
    for (const token of ['--editorial-paper', '--editorial-paper-deep', '--editorial-ink', '--editorial-margin', '--editorial-margin-soft', '--editorial-margin-offset']) {
      expect(tokens).toContain(token)
    }
  })

  it('keeps the original theme ground visible and reserves original E paper for explicit sheets', () => {
    const css = read('src/styles/editorial.css')
    const sharedSurface = css.match(/\.presentation-editorial\s*\{([^}]*)\}/)?.[1] ?? ''
    const sheet = css.match(/\.editorial-sheet\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(sharedSurface).toContain('background-color: transparent')
    expect(sharedSurface).not.toContain('background-color: var(--editorial-paper)')
    expect(sheet).toContain('background-color: var(--editorial-paper)')
    expect(read('src/styles/tokens.css')).toContain('--editorial-paper: #f1f2ec')
    expect(read('src/fiche/prototype/VarianteCahierLibre.vue')).toMatch(/\.cahier\s*\{[^}]*background:\s*transparent/s)
    expect(sharedSurface).not.toContain('--surface-primary')
    expect(sharedSurface).not.toContain('border-inline-start')
    for (const path of ['src/fiche/prototype/VarianteCahierLibre.vue', 'src/components/fiche/OngletTheme.vue', 'src/views/IndicateurPage.vue']) {
      expect(read(path)).toMatch(/class="[^"]*presentation-editorial/)
    }
    expect(read('src/main.ts')).toContain("'./styles/editorial.css'")
  })

  it('does not leave unused selectors or duplicate the prototype alias owner', () => {
    const css = read('src/styles/editorial.css')
    expect(css).not.toContain('.editorial-reading-surface')
    expect(css).not.toContain('--paper:')
    expect(css).not.toContain('--margin-line:')
    expect(read('src/views/IndicateurPage.vue')).not.toMatch(/\.indicateur-page[^}]*background(?:-color)?:\s*var\(--editorial-paper\)/)
    expect(read('src/fiche/prototype/VarianteCahierLibre.vue')).toContain('--margin-line: var(--editorial-margin-offset)')
  })

  it('owns shared sheet, reading, evidence, provenance, control, and responsive spread grammar centrally', () => {
    const css = read('src/styles/editorial.css')
    for (const selector of ['.editorial-sheet', '.editorial-spread', '.editorial-evidence', '.editorial-section-heading',
      '.editorial-section-index', '.editorial-provenance', '.editorial-control', '.editorial-figure']) {
      expect(css).toContain(selector)
    }
    expect(css).toMatch(/\.editorial-provenance\s*\{[^}]*overflow-wrap:\s*anywhere/s)
    expect(css).toMatch(/@media\s*\(max-width:\s*600px\)/)
    const mobility = read('src/fiche/mobilite/ProductionMobilite.vue')
    expect(mobility).toContain('show-all-units')
    expect(mobility).not.toContain('show-map-prototype')
    expect(read('src/fiche/prototype/VarianteCahierLibre.vue')).toContain('page-margin editorial-provenance')
    const mobilityLayout = read('src/fiche/prototype/VarianteCahierLibre.vue')
    expect(mobilityLayout).toContain('.cahier { --margin-line: 12px; }')
    expect(mobilityLayout).toContain('.page-margin { position: static; display: flex;')
    expect(mobilityLayout).toContain('--page-left-inset: 28px; --page-right-inset: 18px;')
    expect(mobilityLayout).toContain('const CartographicBreakoutPrototype = import.meta.env.DEV')
    expect(mobilityLayout).not.toContain("import CartographicBreakoutPrototype from './CartographicBreakoutPrototype.vue'")
  })

  it('keeps typography roles and specialized prototype flourishes outside universal tokens', () => {
    const tokens = read('src/styles/tokens.css')
    expect(tokens).toContain('--font-wordmark: var(--font-serif)')
    expect(tokens).toContain('--font-global-header: var(--font-mozilla-text)')
    expect(tokens).not.toContain('--editorial-rank-outline')
  })
})
