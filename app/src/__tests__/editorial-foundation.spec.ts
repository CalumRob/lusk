import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')

describe('shared E editorial foundation', () => {
  it('exposes observed E decisions as site-wide tokens', () => {
    const tokens = read('src/styles/tokens.css')
    for (const token of ['--editorial-paper', '--editorial-paper-deep', '--editorial-ink', '--editorial-margin', '--editorial-margin-soft', '--editorial-reading-width']) {
      expect(tokens).toContain(token)
    }
  })

  it('is consumed by both production territory and indicator surfaces', () => {
    expect(read('src/components/fiche/OngletTheme.vue')).toContain('presentation-editorial')
    expect(read('src/views/IndicateurPage.vue')).toContain('presentation-editorial')
    expect(read('src/styles/editorial.css')).toContain('var(--editorial-margin-soft)')
    expect(read('src/main.ts')).toContain("'./styles/editorial.css'")
  })

  it('keeps typography roles and specialized prototype flourishes outside universal tokens', () => {
    const tokens = read('src/styles/tokens.css')
    expect(tokens).toContain('--font-wordmark: var(--font-serif)')
    expect(tokens).toContain('--font-global-header: var(--font-mozilla-text)')
    expect(tokens).not.toContain('--editorial-rank-outline')
  })
})
