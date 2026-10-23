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

  it('keeps surface roots on the site ground; paper stays on the notebook pages', () => {
    const css = read('src/styles/editorial.css')
    const sharedSurface = css.match(/\.presentation-editorial\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(sharedSurface).toContain('background-color: transparent')
    expect(sharedSurface).not.toContain('background-color: var(--editorial-paper)')
    expect(sharedSurface).toContain('color: var(--editorial-ink)')
    for (const path of ['src/fiche/prototype/VarianteCahierLibre.vue', 'src/components/fiche/OngletTheme.vue', 'src/views/IndicateurPage.vue']) {
      expect(read(path)).toMatch(/class="[^"]*presentation-editorial/)
    }
    expect(read('src/fiche/prototype/VarianteCahierLibre.vue')).toMatch(/\.cahier\s*\{[^}]*background:\s*transparent/s)
    expect(read('src/fiche/prototype/VarianteCahierLibre.vue')).toContain('background-color: var(--paper)')
    expect(read('src/main.ts')).toContain("'./styles/editorial.css'")
  })

  it('does not leave unused selectors or duplicate the prototype alias owner', () => {
    const css = read('src/styles/editorial.css')
    expect(css).not.toContain('.editorial-reading-surface')
    expect(css).not.toContain('--paper:')
    expect(css).not.toContain('--margin-line:')
    expect(read('src/views/IndicateurPage.vue')).not.toMatch(/\.indicateur-page\s*\{[^}]*background:/)
    expect(read('src/fiche/prototype/VarianteCahierLibre.vue')).toContain('--margin-line: var(--editorial-margin-offset)')
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

    expect(mobile600).toHaveLength(1)
    expect(mobile600[0]).toContain('--margin-line: 12px')
    expect(mobile760).toBeDefined()
    expect(mobile760).toMatch(/\.page-margin\s*\{[^}]*position:\s*static/s)
  })

  it('ships the Mobilité map plate in the production cahier without prototype query switches', () => {
    const cahier = read('src/fiche/prototype/VarianteCahierLibre.vue')
    expect(cahier).toContain("import CartographicBreakoutPrototype from './CartographicBreakoutPrototype.vue'")
    expect(cahier).not.toContain('import.meta.env.DEV')
    const plate = read('src/fiche/prototype/CartographicBreakoutPrototype.vue')
    expect(plate).not.toContain('route.query')
    expect(plate).not.toContain('import.meta.env.DEV')
  })
})
