/**
 * #1024 — the PDF wordmark lockup at the real header, across the two surfaces.
 *
 * This file owns the actual-PDF geometry and the shared-owner consumption:
 *  - the header capture's own line-box geometry (`fixtures/lusk-header-lockup.json`),
 *    labelled as a measurement snapshot, not as code-generated output;
 *  - the printed lockup's horizontal placement, which must come from
 *    `MARQUE_LUSK_LOCKUP` (the gap token + em box), never from a per-surface
 *    millimetre literal;
 *  - the honest-raster comparison between the real screen lockup and the real
 *    PDF lockup lives in `cahier-pdf-lockup-raster.spec.ts` (pixels, both axes).
 *
 * The previous "static face is 0.0238 em lower" story is withdrawn: that number
 * came from a derived 22 px line-box baseline probe, not from ink. The embedded
 * face and the browser's upright-600 instance share the `l`/`k` `yMax`
 * 1434/2000; the raster test is the witness, not an internal re-derivation.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { MARQUE_LUSK_LOCKUP } from '@/components/luskBrandMark'
import { composerCahierPdf } from '@/fiche/prototype/cahierPdfComposer'
import { PAGE_APPROUVEE, ROLE_PDF } from '@/fiche/prototype/cahierPdfGrammaire'
import {
  chargeurImageTest,
  chargeurPoliceTest,
  cheminsPdfPage,
  lirePdf,
  requetePour,
} from './helpers/cahierPdfRuntime'

const appDir = process.cwd()

const fixture = JSON.parse(readFileSync(
  resolve(appDir, 'src/__tests__/fixtures/lusk-header-lockup.json'),
  'utf8',
)) as {
  provenance: { source: string; method: string; pathsSha256: string; regeneration?: string }
  fontSizePx: number
  ermineEm: number
  gapPx: number
  computed: { gap: string }
  word: { y: number }
  baseline: { y: number; derivation: string }
  ink720Em: { top: number; bottom: number; left: number; right: number }
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

  it('place le mot PDF à l’écart déclaré du propriétaire, sur les tracés réels', async () => {
    const taille = ROLE_PDF.marqueMot.taille
    expect(taille).toBeCloseTo(22 * 531.28 / 1010.4, 6)
    const request = requetePour('aedar-access')
    const lecture = await lirePdf((await composerCahierPdf(request, {
      signal: new AbortController().signal,
      chargerPolice: chargeurPoliceTest,
      chargerImage: chargeurImageTest,
      urlAccueil: 'https://lusk.test/',
      urlPublique: 'https://lusk.test/territoire/commune/22001',
    })).blob)
    const ermine = (await cheminsPdfPage(lecture.octets, 1)).filter((chemin) => (
      chemin.kind === 'fill'
      && chemin.y < 70
      && chemin.x < 120
      && chemin.width < 40
      && chemin.height < 40
    ))
    expect(ermine.length, 'les cinq tracés de l’hermine').toBe(5)
    const boiteGauche = Math.min(...ermine.map((chemin) => chemin.x))
    const boiteDroite = Math.max(...ermine.map((chemin) => chemin.x + chemin.width))
    // The ermine ink sits inside the owner's 1.18 em box (it is not the box).
    expect(boiteGauche).toBeGreaterThanOrEqual(PAGE_APPROUVEE.insetGauchePt)
    expect((boiteDroite - boiteGauche) / taille).toBeLessThan(MARQUE_LUSK_LOCKUP.ermineEm)
    expect((boiteDroite - boiteGauche) / taille).toBeGreaterThan(1)
    const mot = lecture.textes.find((item) => item.str === 'lusk')!
    expect(mot).toBeTruthy()
    // The word pen is placed after the owner box plus the owner gap. The gap
    // is CSS px at the app's 16 px root, converted to points once.
    const ecart = MARQUE_LUSK_LOCKUP.ecartPx * 531.28 / 1010.4
    expect((mot.x - PAGE_APPROUVEE.insetGauchePt) / taille)
      .toBeCloseTo(MARQUE_LUSK_LOCKUP.ermineEm + ecart / taille, 2)
    // The real header's ink offsets, measured on the read-only capture, stay
    // plausible in the PDF (the raster comparison in the other spec owns the
    // pixel-level tolerance).
    expect(fixture.ink720Em.right - fixture.ink720Em.left).toBeGreaterThan(1)
    expect(PAGE_APPROUVEE.insetGauchePt).toBe(32)
  })
})
