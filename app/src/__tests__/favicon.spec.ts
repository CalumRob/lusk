import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Brand contract (mock/brand/final.html, DESIGN.md): the favicon is the
 * agreed ermine mark — the 512 tuile mock/brand/favicon.svg, shipped from
 * the app root as /favicon.svg (Vite serves app/public/ at the site root).
 * The old inline « L » tile (a data-URI in index.html) is retired.
 */

const dossierSpecs = dirname(fileURLToPath(import.meta.url))
const cheminIndexHtml = resolve(dossierSpecs, '../../index.html')
const cheminFavicon = resolve(dossierSpecs, '../../public/favicon.svg')

describe('favicon — la tuile ermine agréée', () => {
  it('reference la tuile agréée depuis index.html', async () => {
    const html = await readFile(cheminIndexHtml, 'utf8')

    expect(html).toContain('rel="icon"')
    expect(html).toContain('href="/favicon.svg"')
  })

  it('ne sert plus la tuile « L » en data-URI', async () => {
    const html = await readFile(cheminIndexHtml, 'utf8')

    expect(html).not.toContain('data:image/svg+xml')
  })

  it('livre la tuile agréée à app/public/favicon.svg', () => {
    expect(existsSync(cheminFavicon)).toBe(true)
  })
})
