/**
 * #1024 — the wordmark's *visible ink*, not its pen origins.
 *
 * The parent diagnosis on the real running header proved that the derived face
 * kept the upright `hmtx` bearings after the synthetic skew: `u` was displaced
 * by 0.086 em inside its advance even though the pen origins matched. These
 * checks pin the post-skew `xMin == lsb` contract and the actual header ink
 * deltas, then the ermine's baseline offset.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { OFFSET_ERMINE_EM, sommetErminePt } from '@/fiche/prototype/cahierPdfComposer'
import { ROLE_PDF } from '@/fiche/prototype/cahierPdfGrammaire'
import { lirePoliceTtf } from './helpers/cahierPdfFontProbe'

const GLYPHS = ['l', 'u', 's', 'k'] as const
/** Real global-header char boxes at 22 px (`browser-facts.json`, read-only run). */
const HEADER_X_PX = [77.953125, 84.15625, 96.515625, 105.34375]
const HEADER_SIZE_PX = 22
const TRACKING_EM = -0.01

describe('#1024 — encre visible du logotype, pas seulement les origines de plume', () => {
  it('conserve xMin == lsb après l’oblique synthétique (face et programme PDF)', () => {
    const asset = new Uint8Array(readFileSync(
      resolve(process.cwd(), 'src/assets/fonts/pdf/newsreader-600-italic.ttf'),
    ))
    const font = lirePoliceTtf(asset)
    expect(GLYPHS.map((glyph) => font.xMin(glyph))).toEqual([34, 195, 115, 32])
    // Visible ink origin = pen + (xMin - lsb). A non-zero delta is the exact
    // `u` displacement the owner saw; pen origins alone cannot detect it.
    for (const glyph of GLYPHS) {
      const inkShiftEm = (font.xMin(glyph)! - font.leftSideBearing(glyph)!) / font.unitsPerEm
      expect(Math.abs(inkShiftEm), glyph).toBeLessThan(0.0001)
    }
  })

  it('égale les deltas d’encre du header réel à 0,005 em près', () => {
    const asset = new Uint8Array(readFileSync(
      resolve(process.cwd(), 'src/assets/fonts/pdf/newsreader-600-italic.ttf'),
    ))
    const font = lirePoliceTtf(asset)
    let pen = 0
    const inkEm: number[] = []
    for (const glyph of GLYPHS) {
      const bearing = (font.xMin(glyph)! - font.leftSideBearing(glyph)!) / font.unitsPerEm
      inkEm.push(pen + bearing)
      pen += font.advance(glyph)! / font.unitsPerEm + TRACKING_EM
    }
    const headerEm = HEADER_X_PX.map((x) => (x - HEADER_X_PX[0]!) / HEADER_SIZE_PX)
    for (let index = 0; index < GLYPHS.length; index += 1) {
      expect(Math.abs(inkEm[index]! - headerEm[index]!), GLYPHS[index]).toBeLessThanOrEqual(0.005)
    }
  })

  it('aligne l’hermine sur l’offset de lockup du header réel', () => {
    expect(OFFSET_ERMINE_EM).toBeCloseTo(0.792, 3)
    // Live header: lockup top 16.515 px, word baseline 33.94 px at 22 px →
    // 0.792 em. The previous fixed 26.9 pt was 0.847 em, lifting the ermine
    // 0.076 em above the screen.
    expect(sommetErminePt(36.7, ROLE_PDF.marqueMot.taille)).toBeCloseTo(
      36.7 - 0.792 * ROLE_PDF.marqueMot.taille,
      6,
    )
    expect((36.7 - 26.9) / ROLE_PDF.marqueMot.taille).toBeCloseTo(0.847, 3)
    // The rasterised PDF lockup vs the actual header is produced outside the
    // suite (see the evidence report), because this Node runtime has no
    // renderer; the placed box is what the painter consumes.
  })
})
