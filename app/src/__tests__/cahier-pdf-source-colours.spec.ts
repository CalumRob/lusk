import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import {  COULEUR_CYCLE_PARTAGE } from '@/fiche/prototype/cahierColorRoles'

const source = vi.hoisted(() => ({ css: '' }))


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
