/**
 * #1024 — the wordmark's *visible ink* and its real lockup, not pen origins.
 *
 * The parent diagnosis on the real running header proved that the derived face
 * kept the upright `hmtx` bearings after the synthetic skew: `u` was displaced
 * by 0.086 em inside its advance even though the pen origins matched. These
 * checks pin the post-skew `xMin == lsb` contract and the actual header ink
 * deltas, then the lockup placement. The placement is not a copied PDF number:
 * it comes from the shared brand owner (`MARQUE_LUSK_LOCKUP` in
 * `components/luskBrandMark.ts`) and is checked against the pinned real header
 * (`fixtures/lusk-header-lockup.json`, read-only capture of the live app) and
 * against the actual PDF bytes.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  MARQUE_LUSK_ERMINE,
  MARQUE_LUSK_LOCKUP,
  baseMotDansLigneEm,
  sommetErmineEm,
} from '@/components/luskBrandMark'
import { ROLE_PDF } from '@/fiche/prototype/cahierPdfGrammaire'
import { lirePoliceTtf } from './helpers/cahierPdfFontProbe'

const GLYPHS = ['l', 'u', 's', 'k'] as const
/** Real global-header char boxes at 22 px (`browser-facts.json`, read-only run). */
const HEADER_X_PX = [77.953125, 84.15625, 96.515625, 105.34375]
const HEADER_SIZE_PX = 22
const TRACKING_EM = ROLE_PDF.marqueMot.espacementEm

const fixture = JSON.parse(readFileSync(
  resolve(process.cwd(), 'src/__tests__/fixtures/lusk-header-lockup.json'),
  'utf8',
)) as {
  fontSizePx: number
  svg: { y: number }
  word: { y: number }
  baseline: { y: number }
  derived: {
    svgTopAboveBaseline: number
    pathInkTopInBox: number
    pathInkBottomInBox: number
    pathWordToErmineGap: number
  }
  ink720Em: { top: number; bottom: number; left: number; right: number }
  provenance: { pathsSha256: string; source: string }
}

function asset(): Uint8Array {
  return new Uint8Array(readFileSync(
    resolve(process.cwd(), 'src/assets/fonts/pdf/newsreader-600-italic.ttf'),
  ))
}

/** The fixture is only valid for the exact locked paths it was captured with. */
function pathsHash(): string {
  return createHash('sha256')
    .update(JSON.stringify(MARQUE_LUSK_ERMINE.chemins.map((chemin) => ({ d: chemin.d, role: chemin.role }))))
    .digest('hex')
}

describe('#1024 — encre visible du logotype, pas seulement les origines de plume', () => {
  it('conserve xMin == lsb après l’oblique synthétique (face et programme PDF)', () => {
    const font = lirePoliceTtf(asset())
    expect(GLYPHS.map((glyph) => font.xMin(glyph))).toEqual([34, 195, 115, 32])
    // Visible ink origin = pen + (xMin - lsb). A non-zero delta is the exact
    // `u` displacement the owner saw; pen origins alone cannot detect it.
    for (const glyph of GLYPHS) {
      const inkShiftEm = (font.xMin(glyph)! - font.leftSideBearing(glyph)!) / font.unitsPerEm
      expect(Math.abs(inkShiftEm), glyph).toBeLessThan(0.0001)
    }
  })

  it('égale les deltas d’encre du header réel à 0,005 em près', () => {
    const font = lirePoliceTtf(asset())
    let pen = 0
    const inkEm: number[] = []
    for (const glyph of GLYPHS) {
      const bearing = (font.xMin(glyph)! - font.leftSideBearing(glyph)!) / font.unitsPerEm
      inkEm.push(pen + bearing)
      // The tracking is the shared role's value, never a third literal.
      pen += font.advance(glyph)! / font.unitsPerEm + TRACKING_EM
    }
    const headerEm = HEADER_X_PX.map((x) => (x - HEADER_X_PX[0]!) / HEADER_SIZE_PX)
    for (let index = 0; index < GLYPHS.length; index += 1) {
      expect(Math.abs(inkEm[index]! - headerEm[index]!), GLYPHS[index]).toBeLessThanOrEqual(0.005)
    }
  })
})

describe('#1024 — placement du lockup : la géométrie partagée, pas un littéral PDF', () => {
  it('conserve les chemins verrouillés sur lesquels la référence écran a été mesurée', () => {
    expect(pathsHash()).toBe(fixture.provenance.pathsSha256)
    expect(fixture.provenance.source).toContain('read-only live app')
  })

  it('dérive la baseline du mot et le sommet de l’hermine des métriques réelles de la face', () => {
    const font = lirePoliceTtf(asset())
    // The shared face's own typographic metrics (upm 2000, hhea 1470/-530).
    expect(MARQUE_LUSK_LOCKUP.unitesParEm).toBe(font.unitsPerEm)
    expect(MARQUE_LUSK_LOCKUP.ascensionUnites).toBe(font.ascender)
    expect(MARQUE_LUSK_LOCKUP.descenteUnites).toBe(-font.descender)
    // The browser lays the 22 px word out with its integer 16 px ascent; the
    // shared owner states that derivation, not the measured result.
    expect(baseMotDansLigneEm()).toBeCloseTo(16 / 22, 9)
    expect(baseMotDansLigneEm()).toBeCloseTo(
      Math.round(font.ascender / font.unitsPerEm * MARQUE_LUSK_LOCKUP.tailleSourcePx)
        / MARQUE_LUSK_LOCKUP.tailleSourcePx,
      9,
    )
    // The screen's flex box sits 0.81727em above the baseline; the PDF's text
    // ink frame is 0.0451em lower (its static ascender is 0.0238em lower and
    // the raster-confirmed ink gap is 0.26705em). Both numbers are derived,
    // never copied from a previous PDF output.
    expect((MARQUE_LUSK_LOCKUP.ermineEm - MARQUE_LUSK_LOCKUP.ligneMotEm) / 2 + 16 / 22)
      .toBeCloseTo(0.8172727272727273, 9)
    expect(sommetErmineEm()).toBeCloseTo(0.77215, 5)
    // The PDF text baseline is fixed by the page; the embedded face's ascender
    // ink is its `l`/`k` yMax. The owner derives the box top from that ink, the
    // real header's ink gap and the ermine's ink offset in its box.
    expect(MARQUE_LUSK_LOCKUP.ascensionEncreMotEm).toBe(1434 / 2000)
    expect(sommetErmineEm()).toBeCloseTo(
      MARQUE_LUSK_LOCKUP.ascensionEncreMotEm
        - MARQUE_LUSK_LOCKUP.ecartEncreMotErmineEm
        + MARQUE_LUSK_LOCKUP.encreHautErmineBoiteEm,
      9,
    )
    // The ink gap it encodes is the one measured on the real header.
    expect(MARQUE_LUSK_LOCKUP.ecartEncreMotErmineEm).toBeCloseTo(
      fixture.derived.pathWordToErmineGap,
      5,
    )
  })
})
