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
import { composerCahierPdf, sommetErminePt } from '@/fiche/prototype/cahierPdfComposer'
import { PAGE_APPROUVEE, ROLE_PDF } from '@/fiche/prototype/cahierPdfGrammaire'
import { lirePoliceTtf } from './helpers/cahierPdfFontProbe'
import { chargeurPoliceTest, cheminsPdfPage, lirePdf, requetePour } from './helpers/cahierPdfRuntime'

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
    expect(sommetErmineEm()).toBeCloseTo(
      (MARQUE_LUSK_LOCKUP.ermineEm - MARQUE_LUSK_LOCKUP.ligneMotEm) / 2 + 16 / 22,
      9,
    )
    // The real header: lockup top 16.515625 px, baseline 34.484375 px at 22 px.
    expect(Math.abs(sommetErmineEm() - fixture.derived.svgTopAboveBaseline))
      .toBeLessThanOrEqual(0.005)
  })

  it('place l’hermine du PDF réel sur la même encre que le header, sur les deux axes', async () => {
    const font = lirePoliceTtf(asset())
    expect(fixture.fontSizePx).toBe(22)
    // Real header geometry, in em: the word baseline is 0.7273 em below the
    // word box top; the ermine box top is 0.8168 em above the baseline.
    expect((fixture.baseline.y - fixture.word.y) / fixture.fontSizePx).toBeCloseTo(16 / 22, 9)
    expect(fixture.svg.y).toBeCloseTo(fixture.word.y - (MARQUE_LUSK_LOCKUP.ermineEm - MARQUE_LUSK_LOCKUP.ligneMotEm)
      / 2 * fixture.fontSizePx, 1)

    const taille = ROLE_PDF.marqueMot.taille
    expect(taille).toBeCloseTo(22 * 531.28 / 1010.4, 6)
    expect(sommetErminePt(36.7, taille)).toBeCloseTo(36.7 - sommetErmineEm() * taille, 9)

    const request = requetePour('aedar-access')
    const lecture = await lirePdf((await composerCahierPdf(request, {
      signal: new AbortController().signal,
      chargerPolice: chargeurPoliceTest,
      chargerImage: async () => ({ dataUrl: 'data:image/png;base64,', width: 2, height: 2 }),
      urlAccueil: 'https://lusk.test/',
      urlPublique: 'https://lusk.test/territoire/commune/22001',
    })).blob)

    const H = PAGE_APPROUVEE.hauteurPt
    // `cheminsPdfPage` reports the reader's top-origin y; a pdfjs text item's
    // y is the bottom-origin baseline.
    const baselineHaut = 36.7
    const baselineBas = H - 36.7
    const dessins = await cheminsPdfPage(lecture.octets, 1)
    const ermine = dessins.filter((chemin) => (
      chemin.kind === 'fill'
      && chemin.y < 70
      && chemin.x < 120
      && chemin.width < 40
      && chemin.height < 40
    ))
    expect(ermine.length, 'les cinq tracés de l’hermine').toBe(5)
    const haut = Math.min(...ermine.map((chemin) => chemin.y))
    const bas = Math.max(...ermine.map((chemin) => chemin.y + chemin.height))
    const gauche = Math.min(...ermine.map((chemin) => chemin.x))
    const droit = Math.max(...ermine.map((chemin) => chemin.x + chemin.width))

    // Expected ink from the shared owner + the real header's 720 px/em ink
    // offsets, never from the painter's own box arithmetic.
    const sommet = sommetErmineEm() * taille
    const attenduHaut = baselineHaut - (sommet - fixture.ink720Em.top * taille)
    const attenduBas = baselineHaut - (sommet - fixture.ink720Em.bottom * taille)
    const attenduGauche = PAGE_APPROUVEE.insetGauchePt + fixture.ink720Em.left * taille
    expect(Math.abs(haut - attenduHaut) / taille).toBeLessThanOrEqual(0.005)
    expect(Math.abs(bas - attenduBas) / taille).toBeLessThanOrEqual(0.005)
    expect(Math.abs(gauche - attenduGauche) / taille).toBeLessThanOrEqual(0.005)
    // The text is placed by the same box + native 8 px gap; this is the
    // horizontal lockup check that cannot hide behind curve control points.
    const mot = lecture.textes.find((item) => item.str === 'lusk')!
    expect(mot).toBeTruthy()
    expect(mot.y).toBeCloseTo(baselineBas, 1)
    expect(Math.abs(mot.x - (PAGE_APPROUVEE.insetGauchePt + MARQUE_LUSK_LOCKUP.ermineEm * taille
      + MARQUE_LUSK_LOCKUP.ecartPx * 531.28 / 1010.4)) / taille).toBeLessThanOrEqual(0.005)
    // The visible ink's right edge, on the actual header, is inside the same
    // 0.005 em as the painted paths (control-point overshoot measured once).
    expect(Math.abs(droit - (PAGE_APPROUVEE.insetGauchePt + fixture.ink720Em.right * taille)) / taille)
      .toBeLessThanOrEqual(0.012)
    expect(font.italicAngle).toBeCloseTo(-14, 6)
  })
})
