/**
 * #1024 — the PDF wordmark lockup against the *real* header, on both axes.
 *
 * The expected ink is read from the pinned read-only header capture
 * (`fixtures/lusk-header-lockup.json`: 720 px/em render of the shared ermine
 * paths inside the 1.18em box) and the painter's own placement
 * (`sommetErminePt`). This file deliberately does not import the brand-owner
 * derivation, so the measurement is a genuine cross-surface check: the PDF
 * bytes are compared with the header, not with the code that placed them.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { composerCahierPdf } from '@/fiche/prototype/cahierPdfComposer'
import { PAGE_APPROUVEE, ROLE_PDF } from '@/fiche/prototype/cahierPdfGrammaire'
import {
  chargeurImageTest,
  chargeurPoliceTest,
  cheminsPdfPage,
  lirePdf,
  requetePour,
} from './helpers/cahierPdfRuntime'

const fixture = JSON.parse(readFileSync(
  resolve(process.cwd(), 'src/__tests__/fixtures/lusk-header-lockup.json'),
  'utf8',
)) as {
  fontSizePx: number
  svg: { y: number }
  word: { y: number }
  baseline: { y: number }
  lockup: { w: number; h: number }
  ermineEm: number
  gapPx: number
  ascensionEncreMotEm: number
  ecartEncreMotErmineEm: number
  encreHautErmineBoiteEm: number
  ink720Em: { top: number; bottom: number; left: number; right: number }
}

describe('#1024 — encre du logotype PDF vs header réel, les deux axes', () => {
  it('place l’hermine du PDF réel sur la même encre que le header, sur les deux axes', async () => {
    expect(fixture.fontSizePx).toBe(22)
    // Real header geometry, in em: the word baseline is 0.7273 em below the
    // word box top; the ermine box top is 0.8168 em above the baseline.
    expect((fixture.baseline.y - fixture.word.y) / fixture.fontSizePx).toBeCloseTo(16 / 22, 9)
    expect(fixture.svg.y).toBeCloseTo(
      fixture.word.y - (fixture.ermineEm - 1) / 2 * fixture.fontSizePx,
      1,
    )

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

    // Expected ink = the *real header's* measured ink gap applied to the PDF
    // word's own ascender ink (the embedded face's `l`/`k` yMax, a font fact),
    // plus the header's measured horizontal ink offsets. Nothing here re-reads
    // the painter's own box constant.
    const ermineTopAbove = fixture.ascensionEncreMotEm - fixture.ecartEncreMotErmineEm
    const attenduHaut = baselineHaut - ermineTopAbove * taille
    const attenduBas = attenduHaut + (fixture.ink720Em.bottom - fixture.ink720Em.top) * taille
    const attenduGauche = PAGE_APPROUVEE.insetGauchePt + fixture.ink720Em.left * taille
    expect(Math.abs(haut - attenduHaut) / taille).toBeLessThanOrEqual(0.005)
    expect(Math.abs(bas - attenduBas) / taille).toBeLessThanOrEqual(0.005)
    expect(Math.abs(gauche - attenduGauche) / taille).toBeLessThanOrEqual(0.005)
    // The text is placed by the same box + native gap; this is the horizontal
    // lockup check that cannot hide behind curve control points.
    const mot = lecture.textes.find((item) => item.str === 'lusk')!
    expect(mot).toBeTruthy()
    expect(mot.y).toBeCloseTo(baselineBas, 1)
    expect(Math.abs(mot.x - (PAGE_APPROUVEE.insetGauchePt + fixture.ermineEm * taille
      + fixture.gapPx * 531.28 / 1010.4)) / taille).toBeLessThanOrEqual(0.005)
    // The visible ink's right edge, on the actual header, is inside the same
    // tolerance as the painted paths (control-point overshoot measured once).
    expect(Math.abs(droit - (PAGE_APPROUVEE.insetGauchePt + fixture.ink720Em.right * taille)) / taille)
      .toBeLessThanOrEqual(0.012)
  })
})
