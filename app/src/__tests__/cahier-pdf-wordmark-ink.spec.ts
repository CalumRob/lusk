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

  it('dérive les métriques de la face réelle, pas d’une sonde de baseline', () => {
    const font = lirePoliceTtf(asset())
    // The shared face's own typographic metrics (upm 2000, hhea 1470/-530).
    expect(MARQUE_LUSK_LOCKUP.unitesParEm).toBe(font.unitsPerEm)
    expect(MARQUE_LUSK_LOCKUP.ascensionUnites).toBe(font.ascender)
    expect(MARQUE_LUSK_LOCKUP.descenteUnites).toBe(-font.descender)
    // The PDF's ascender ink is the face's own `l`/`k` `yMax` — not a raster
    // probe. The withdrawn 0.0238 em "lower static face" came from a derived
    // 22 px line box, not from glyph ink.
    expect(font.yMax('l')).toBe(1434)
    expect(font.yMax('k')).toBe(1434)
    expect(MARQUE_LUSK_LOCKUP.ascensionEncreMotEm).toBe(font.yMax('l')! / font.unitsPerEm)
    // The two remaining inputs are real header measurements (read-only capture):
    // the ink gap from the word ascender to the ermine top, and the ermine ink
    // top inside its box.
    expect(MARQUE_LUSK_LOCKUP.ecartEncreMotErmineEm)
      .toBeCloseTo(fixture.derived.pathWordToErmineGap, 4)
    expect(MARQUE_LUSK_LOCKUP.encreHautErmineBoiteEm)
      .toBeCloseTo(fixture.ink720Em.top, 4)
    // The painter's box top is those facts combined; the raster spec owns the
    // independent pixel comparison against the PDF.
    expect(sommetErmineEm()).toBeCloseTo(
      font.yMax('l')! / font.unitsPerEm
        - fixture.derived.pathWordToErmineGap
        + fixture.ink720Em.top,
      4,
    )
  })
})
