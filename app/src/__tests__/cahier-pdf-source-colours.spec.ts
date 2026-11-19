import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { CAHIER_SHARE_COLOUR, COULEUR_CYCLE_PARTAGE } from '@/fiche/prototype/cahierColorRoles'
import { chargeurPoliceTest, chargeurImageTest, requetePour, couleursRemplissage } from './helpers/cahierPdfRuntime'

const source = vi.hoisted(() => ({ css: '' }))

// RETIRED (#1024 native switch): Pins source-token mutation of hand-built painter literals; native paint resolves CSS colours in the browser.
it.skip('une modification des jetons éditoriaux source change les couleurs du vrai fichier PDF', async () => {
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
    .replace(/(--editorial-paper-deep:\s*)#[\da-f]{6}/i, '$1#123456')
    .replace(/(--editorial-muted:\s*)#[\da-f]{6}/i, '$1#00ff00')
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
  // The shared Cahier alias resolves to the mutated editorial token, so the
  // share track's own ground/border follow the source too.
  expect(PALETTE_PDF.editorialMuted).toBe('#00ff00')
  expect(PALETTE_PDF.paperDeep).toBe('#123456')
  expect(couleurPdf('var(--paper)')).toBe('#ff0000')
  // The share SFC and this palette consume the same three owner expressions;
  // the PDF resolves them from the mutated source, not from copied hexes.
  // 18 % / 22 % / 40 % of #00ff00 over the mutated #ff0000 paper.
  expect(PALETTE_PDF.shareTrackGround).toBe('#d12e00')
  expect(PALETTE_PDF.shareTrackBorder).toBe('#c73800')
  expect(PALETTE_PDF.shareTrackEmptyBorder).toBe('#996600')
  expect(couleurPdf(CAHIER_SHARE_COLOUR.fond)).toBe(PALETTE_PDF.shareTrackGround)
  expect(couleurPdf(CAHIER_SHARE_COLOUR.filet)).toBe(PALETTE_PDF.shareTrackBorder)
  expect(couleurPdf(CAHIER_SHARE_COLOUR.filetVide)).toBe(PALETTE_PDF.shareTrackEmptyBorder)
  expect(() => couleurPdf('var(--not-a-real-role)')).toThrow()
})

it('ne consomme que le bloc :root canonique des jetons, jamais une surcharge média future', async () => {
  const css = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8')
  const canonicalPaper = /--editorial-paper:\s*(#[0-9a-f]{6})/i.exec(css)![1]!.toLowerCase()
  const canonicalBrand = /--brand-500:\s*(#[0-9a-f]{6})/i.exec(css)![1]!.toLowerCase()
  source.css = `${css}\n@media (prefers-color-scheme: dark) {\n  :root {\n    --editorial-paper: #101010;\n    --brand-500: #202020;\n  }\n}\n`
  vi.resetModules()
  vi.doMock('@/styles/tokens.css?raw', () => ({ default: source.css }))
  try {
    const { PALETTE_PDF } = await import('@/fiche/prototype/cahierPdfPalette')
    expect(PALETTE_PDF.paper).toBe(canonicalPaper)
    expect(PALETTE_PDF.brand500).toBe(canonicalBrand)
  } finally {
    vi.doUnmock('@/styles/tokens.css?raw')
    vi.resetModules()
  }
})

it('n’entretient qu’un propriétaire pour la teinte cycle partagée', () => {
  const lire = (chemin: string) => readFileSync(resolve(process.cwd(), chemin), 'utf8')
  const proprietaire = lire('src/fiche/prototype/cahierColorRoles.ts')
  expect(proprietaire.toLowerCase()).toContain(COULEUR_CYCLE_PARTAGE.toLowerCase())
  expect(proprietaire).toContain('COULEUR_CYCLE_PARTAGE')
  const consommateurs = [
    'src/fiche/prototype/cahierMobiliteReadings.ts',
    'src/fiche/prototype/CartographicBreakoutPrototype.vue',
    'src/fiche/prototype/cahierPdfPalette.ts',
  ]
  for (const chemin of consommateurs) {
    expect(lire(chemin).toLowerCase(), chemin).not.toContain(COULEUR_CYCLE_PARTAGE.toLowerCase())
  }
  const lectures = lire('src/fiche/prototype/cahierMobiliteReadings.ts')
  expect(lectures).toContain('COULEUR_CYCLE_PARTAGE')
  expect(lectures).toContain('var(--cahier-cycle-shared')
})
