import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { chargeurPoliceTest, chargeurImageTest, requetePour, couleursRemplissage } from './helpers/cahierPdfRuntime'

const source = vi.hoisted(() => ({ css: '' }))

it('une modification des jetons éditoriaux source change les couleurs du vrai fichier PDF', async () => {
  const css = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8')
  source.css = css
  vi.doMock('@/styles/tokens.css?raw', () => ({ default: source.css }))
  vi.resetModules()
  const original = await import('@/fiche/prototype/cahierPdfComposer')
  const options = { signal: new AbortController().signal, chargerPolice: chargeurPoliceTest, chargerImage: chargeurImageTest }
  const before = await original.composerCahierPdf(requetePour('couverture-du-territoire'), options)
  const beforeColours = await couleursRemplissage(new Uint8Array(await before.blob.arrayBuffer()))
  expect(beforeColours).not.toContain('#ff0000')
  source.css = css.replace(/(--editorial-paper:\s*)#[\da-f]{6}/i, '$1#ff0000')
    .replace(/(--editorial-paper-deep:\s*)#[\da-f]{6}/i, '$1#00ff00')
    .replace(/(--brand-500:\s*)#[\da-f]{6}/i, '$1#0000ff')
  vi.resetModules()
  vi.doMock('@/styles/tokens.css?raw', () => ({ default: source.css }))
  const changed = await import('@/fiche/prototype/cahierPdfComposer')
  const after = await changed.composerCahierPdf(requetePour('couverture-du-territoire'), options)
  const afterColours = await couleursRemplissage(new Uint8Array(await after.blob.arrayBuffer()))
  expect(afterColours).toContain('#ff0000')
  expect(afterColours).toContain('#00ff00')
  expect(afterColours).toContain('#0000ff')
  const { PALETTE_PDF, couleurPdf } = await import('@/fiche/prototype/cahierPdfPalette')
  expect(PALETTE_PDF.paperDeep).toBe('#00ff00')
  expect(couleurPdf('var(--paper)')).toBe('#ff0000')
  expect(() => couleurPdf('var(--not-a-real-role)')).toThrow()
})
