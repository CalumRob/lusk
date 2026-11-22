import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')

function mediaBlocks(css: string, maxWidth: number): string[] {
  const mediaRule = new RegExp(`@media\\s*\\(max-width:\\s*${maxWidth}px\\)\\s*\\{`, 'gu')
  const blocks: string[] = []
  let match: RegExpExecArray | null

  while ((match = mediaRule.exec(css)) !== null) {
    const open = match.index + match[0].lastIndexOf('{')
    let depth = 0

    for (let index = open; index < css.length; index += 1) {
      if (css[index] === '{') depth += 1
      if (css[index] === '}' && --depth === 0) {
        blocks.push(css.slice(open + 1, index))
        mediaRule.lastIndex = index + 1
        break
      }
    }
  }

  return blocks
}

describe('shared E editorial foundation', () => {
  it('exposes observed E decisions as site-wide tokens', () => {
    const tokens = read('src/styles/tokens.css')
    for (const token of ['--editorial-paper', '--editorial-paper-deep', '--editorial-ink', '--editorial-margin', '--editorial-margin-soft', '--editorial-margin-offset']) {
      expect(tokens).toContain(token)
    }
  })

  it('records the owner-approved paper palette and shared ink-derived page chrome roles', () => {
    const tokens = read('src/styles/tokens.css')
    expect(tokens).toContain('--editorial-paper: #f5f2eb;')
    expect(tokens).toContain('--editorial-paper-deep: #e6e1d7;')
    expect(tokens).toContain('--editorial-page-border-color: color-mix(in srgb, var(--editorial-ink) 15%, transparent);')
    expect(tokens).toContain('--editorial-page-shadow-color: color-mix(in srgb, var(--editorial-ink) 10%, transparent);')
    const accueil = read('src/views/AccueilView.vue')
    const cahier = read('src/fiche/prototype/VarianteCahierLibre.vue')
    for (const source of [accueil, cahier]) {
      expect(source).toContain('var(--editorial-page-border-color)')
      expect(source).toContain('var(--editorial-page-shadow-color)')
      expect(source).not.toContain('rgb(67 57 42')
      expect(source).not.toContain('rgb(35 42 42 / 15%)')
    }
    // Geometry stays local to each composition.
    expect(accueil).toContain('box-shadow: 0 10px 22px var(--editorial-page-shadow-color)')
    expect(cahier).toContain('box-shadow: 0 14px 30px var(--editorial-page-shadow-color)')
  })

  it('keeps surface roots on the site ground; paper stays on the notebook pages', () => {
    const css = read('src/styles/editorial.css')
    const sharedSurface = css.match(/\.presentation-editorial\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(sharedSurface).toContain('background-color: transparent')
    expect(sharedSurface).not.toContain('background-color: var(--editorial-paper)')
    expect(sharedSurface).toContain('color: var(--editorial-ink)')
    for (const path of ['src/fiche/prototype/VarianteCahierLibre.vue', 'src/components/fiche/OngletTheme.vue', 'src/views/IndicateurPage.vue']) {
      expect(read(path)).toMatch(/class="[^"]*presentation-editorial/)
    }
    // #1093 — the page surface and paper sheet moved to one shared owner; both
    // surfaces opt in by carrying its classes instead of redefining the ground.
    const pageLayer = read('src/styles/editorialPage.css')
    expect(pageLayer).toMatch(/\.editorial-page\s*\{[^}]*background:\s*transparent/s)
    expect(pageLayer).toMatch(/\.editorial-sheet\s*\{[^}]*background-color:\s*var\(--paper\)/s)
    expect(read('src/fiche/prototype/VarianteCahierLibre.vue')).toMatch(/class="[^"]*\beditorial-page\b/s)
    expect(read('src/views/AtelierView.vue')).toMatch(/class="[^"]*\beditorial-page\b/s)
    expect(read('src/main.ts')).toContain("'./styles/editorial.css'")
  })

  it('does not leave unused selectors or duplicate the prototype alias owner', () => {
    const css = read('src/styles/editorial.css')
    expect(css).not.toContain('.editorial-reading-surface')
    expect(css).not.toContain('--paper:')
    expect(css).not.toContain('--margin-line:')
    expect(read('src/views/IndicateurPage.vue')).not.toMatch(/\.indicateur-page\s*\{[^}]*background:/)
    expect(read('src/styles/editorialPage.css')).toContain('--margin-line: var(--editorial-margin-offset)')
    expect(read('src/fiche/prototype/VarianteCahierLibre.vue')).not.toContain('--margin-line: var(--editorial-margin-offset)')
  })

  it('grounds inline cahier maps in deep paper through the owner token', () => {
    const cahier = read('src/fiche/prototype/VarianteCahierLibre.vue')
    const mapPanel = read('src/fiche/prototype/CahierMapPanel.vue')
    const cahierRule = cahier.match(/\.cahier\s*\{([^}]*)\}/u)?.[1] ?? ''
    const imageRule = mapPanel.match(/\.map-viewport img\s*\{([^}]*)\}/u)?.[1] ?? ''

    expect(cahierRule).toContain('--cahier-map-ground: var(--editorial-paper-deep)')
    expect(imageRule).toMatch(/background:\s*var\(--cahier-map-ground,\s*var\(--editorial-paper-deep\)\)/u)
    expect(imageRule).not.toMatch(/#f8fbfb|#fff|#ffffff|\bwhite\b/iu)
  })

  it('keeps typography roles and specialized prototype flourishes outside universal tokens', () => {
    const tokens = read('src/styles/tokens.css')
    expect(tokens).toContain('--font-wordmark: var(--font-serif)')
    expect(tokens).toContain('--font-global-header: var(--font-mozilla-text)')
    expect(tokens).not.toContain('--editorial-rank-outline')
  })

  it('reflows the page margin in mobile flow and keeps a compact margin line', () => {
    const cahier = read('src/fiche/prototype/VarianteCahierLibre.vue')
    const mobile600 = mediaBlocks(cahier, 600)
    const mobile760 = mediaBlocks(cahier, 760).find((block) => block.includes('.page-margin'))
    // #1093 — the margin-line reflow moved with the aliases to the shared layer.
    const pageLayer = read('src/styles/editorialPage.css')
    const shared600 = mediaBlocks(pageLayer, 600)[0] ?? ''
    const shared760 = mediaBlocks(pageLayer, 760)[0] ?? ''

    expect(mobile600).toHaveLength(1)
    expect(shared600).toContain('--margin-line: 12px')
    expect(shared760).toContain('--margin-line: 82px')
    expect(mobile760).toBeDefined()
    expect(mobile760).toMatch(/\.page-margin\s*\{[^}]*position:\s*static/s)
  })

  it('ships the Mobilité map plate in the production cahier without prototype query switches', () => {
    const cahier = read('src/fiche/prototype/VarianteCahierLibre.vue')
    const renderers = read('src/fiche/prototype/cahierSectionRenderers.ts')
    const delegate = read('src/fiche/prototype/CahierMobiliteSection.vue')
    expect(cahier).toContain("import { CahierSectionBody } from './cahierSectionRenderers'")
    expect(cahier).toContain("import { cahierSectionRendererFor } from './cahierSectionRenderers'")
    expect(renderers).toContain("import CahierMobiliteSection from './CahierMobiliteSection.vue'")
    expect(delegate).toContain("import CartographicBreakoutPrototype from './CartographicBreakoutPrototype.vue'")
    expect(cahier).not.toContain('import.meta.env.DEV')
    const plate = read('src/fiche/prototype/CartographicBreakoutPrototype.vue')
    expect(plate).not.toContain('route.query')
    expect(plate).not.toContain('import.meta.env.DEV')
  })
})
