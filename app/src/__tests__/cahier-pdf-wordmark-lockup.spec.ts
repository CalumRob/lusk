/**
 * #1024 — the PDF wordmark lockup's measurement provenance and shared-owner
 * consumption. The honest screen-vs-PDF raster comparison remains pinned in
 * cahier-pdf-lockup-raster.spec.ts; current rendering is verify:* coverage.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { MARQUE_LUSK_LOCKUP } from '@/components/luskBrandMark'

const appDir = process.cwd()

const fixture = JSON.parse(readFileSync(
  resolve(appDir, 'src/__tests__/fixtures/lusk-header-lockup.json'),
  'utf8',
)) as {
  provenance: { source: string; method: string; pathsSha256: string; regeneration?: string }
  fontSizePx: number
  gapPx: number
  computed: { gap: string }
  word: { y: number }
  baseline: { y: number; derivation: string }
}

const composerSource = readFileSync(
  resolve(appDir, 'src/fiche/prototype/cahierPdfComposer.ts'),
  'utf8',
// The repo is checked out with the platform's line endings (`core.autocrlf`);
// this source witness must read the same text on every host.
).replace(/\r\n/gu, '\n')

function dessinerMarqueSource(): string {
  const match = /async function dessinerMarque\([\s\S]*?\n}\n/.exec(composerSource)
  if (!match) throw new Error('dessinerMarque introuvable')
  return match[0]
}

describe('#1024 — lockup PDF : géométrie du header réel et propriétaire partagé', () => {
  it('déclare le header comme une mesure, pas comme une sortie de code', () => {
    expect(fixture.provenance.source).toContain('read-only live app')
    expect(fixture.provenance.method).toContain('Playwright Chromium')
    expect(fixture.provenance.regeneration ?? '').toMatch(/measurement|mesure/i)
    expect(fixture.provenance.pathsSha256).toMatch(/^[0-9a-f]{64}$/)
    // The capture's line box: 22 px word box, 16 px browser ascent at this
    // size. This is the probe's own box fact, never an ink-height claim.
    expect(fixture.fontSizePx).toBe(22)
    expect(fixture.baseline.y - fixture.word.y).toBeCloseTo(16, 9)
    expect(fixture.baseline.derivation).toContain('word top')
    expect(fixture.computed.gap).toBe(`${fixture.gapPx}px`)
  })

  it('consomme l’écart et la boîte du propriétaire partagé, sans littéral PDF', () => {
    const marque = dessinerMarqueSource()
    // The painter reads the shared owner; it may not carry its own copy.
    expect(marque).toContain('MARQUE_LUSK_LOCKUP.ermineEm')
    expect(marque).toContain('MARQUE_LUSK_LOCKUP.ecartPx')
    expect(marque).not.toContain('rythmePt(8)')
    expect(marque).not.toMatch(/cote\s*\+\s*mm\(ptDepuisCssPx\(8\)\)/)
    expect(MARQUE_LUSK_LOCKUP.ecartPx).toBe(fixture.gapPx)
  })
})
