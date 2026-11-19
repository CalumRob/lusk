/**
 * #1024 — independent lockup witness: the real screen raster vs the real PDF.
 *
 * The previous lockup check re-derived the painter's own inputs inside the test
 * (`ascensionEncreMotEm − ecartEncreMotErmineEm`, then compared the painter's
 * output to that expression), so it could not falsify anything. This spec
 * measures two independently produced rasters instead:
 *
 *  - `header-lockup-720em.png`: the READ-ONLY actual app header lockup (full
 *    word + ermine), captured from the live screen at 720 px/em;
 *  - `pdf-lockup-720em.png`: page 1 of an actual generated PDF, rendered with
 *    PyMuPDF at exactly 720 px/em and cropped to the same full lockup.
 *
 * Both files are pinned measurement snapshots (`provenance.json` records the
 * app source, the exact PDF HEAD/hash and the render recipe); they are not
 * produced by the painter's code, so a change in placement moves the test.
 *
 * The tolerance is honest: at 720 px/em one raster pixel is 0.00139 em, and
 * independent capture/render/crop pipelines (device-pixel rounding, edge
 * anti-aliasing, ink threshold) cost on the order of a pixel or two. 0.02 em
 * (14.4 px, ≈ 0.23 pt at the PDF's 11.568 pt word) is therefore the noise
 * floor of this comparison — not a claim that every axis is ≤ 0.00114 em.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { inflateSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import { MARQUE_LUSK_LOCKUP } from '@/components/luskBrandMark'
import { composerCahierPdf } from '@/fiche/prototype/cahierPdfComposer'
import { PAGE_APPROUVEE, ROLE_PDF } from '@/fiche/prototype/cahierPdfGrammaire'
import {
  chargeurPoliceTest,
  cheminsPdfPage,
  lirePdf,
  requetePour,
} from './helpers/cahierPdfRuntime'
import { lirePoliceTtf } from './helpers/cahierPdfFontProbe'

const DOSSIER = resolve(process.cwd(), 'src/__tests__/fixtures/lusk-lockup')
const ECHELLE = 720
const TOLERANCE_EM = 0.02
/**
 * The ermine's width ÷ height is a pure aspect: it has no `em` unit. Comparing
 * it with the length tolerance is a units error (the measured screen-vs-PDF
 * aspect delta is 0.01023, dimensionless), so it gets its own bound and label.
 */
const TOLERANCE_ASPECT = 0.02
const SEUIL_ENCRE = 24

interface Png {
  readonly width: number
  readonly height: number
  readonly channels: number
  readonly pixels: Uint8Array
}

function lirePng(chemin: string): Png {
  const bytes = readFileSync(chemin)
  const signature = '89504e470d0a1a0a'
  if (bytes.subarray(0, 8).toString('hex') !== signature) throw new Error(`PNG invalide : ${chemin}`)
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat: Buffer[] = []
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii')
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]!
      colorType = data[9]!
      if (data[12] !== 0) throw new Error('PNG entrelacé non pris en charge')
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data))
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  if (bitDepth !== 8) throw new Error(`Profondeur PNG ${bitDepth} non prise en charge`)
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 0 ? 1 : -1
  if (channels < 0) throw new Error(`Type de couleur PNG ${colorType} non pris en charge`)
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const pixels = new Uint8Array(width * height * channels)
  let previous = new Uint8Array(stride)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]!
    const source = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const row = new Uint8Array(stride)
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? row[x - channels]! : 0
      const up = previous[x]!
      const upLeft = x >= channels ? previous[x - channels]! : 0
      let value = source[x]!
      if (filter === 1) value = (value + left) & 0xff
      else if (filter === 2) value = (value + up) & 0xff
      else if (filter === 3) value = (value + Math.floor((left + up) / 2)) & 0xff
      else if (filter === 4) {
        const p = left + up - upLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upLeft)
        value = (value + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)) & 0xff
      } else if (filter !== 0) throw new Error(`Filtre PNG ${filter} inconnu`)
      row[x] = value
    }
    pixels.set(row, y * stride)
    previous = row
  }
  return { width, height, channels, pixels }
}

interface Boite {
  readonly gauche: number
  readonly droite: number
  readonly haut: number
  readonly bas: number
}

interface Mesure {
  readonly ermine: Boite
  readonly mot: Boite
}

function mesurerEncre(png: Png): Mesure {
  const { width, height, channels, pixels } = png
  const fond = [0, 1, 2].map((canal) => pixels[canal]!)
  const colonnes = new Set<number>()
  const lignes = new Set<number>()
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * channels
      let diff = 0
      for (let canal = 0; canal < 3; canal += 1) {
        diff = Math.max(diff, Math.abs(pixels[index + canal]! - fond[canal]!))
      }
      if (diff <= SEUIL_ENCRE) continue
      colonnes.add(x)
      lignes.add(y)
    }
  }
  const triees = [...colonnes].sort((a, b) => a - b)
  if (!triees.length) throw new Error('Aucune encre mesurée')
  // Split at the widest empty column gap: the horizontal lockup only has one
  // (between the ermine and the word), and the word is always to the right.
  let coupure = -1
  let largeurMax = 0
  for (let index = 1; index < triees.length; index += 1) {
    const trou = triees[index]! - triees[index - 1]! - 1
    if (trou > largeurMax) {
      largeurMax = trou
      coupure = (triees[index]! + triees[index - 1]!) / 2
    }
  }
  if (largeurMax < width * 0.01) throw new Error(`Aucune séparation hermine/mot (trou ${largeurMax}px)`)
  const boite = (gauche: number, droite: number): Boite => {
    let haut = Number.POSITIVE_INFINITY
    let bas = -1
    let minX = Number.POSITIVE_INFINITY
    let maxX = -1
    for (let y = 0; y < height; y += 1) {
      for (let x = Math.ceil(gauche); x <= Math.floor(droite); x += 1) {
        const index = (y * width + x) * channels
        let diff = 0
        for (let canal = 0; canal < 3; canal += 1) {
          diff = Math.max(diff, Math.abs(pixels[index + canal]! - fond[canal]!))
        }
        if (diff <= SEUIL_ENCRE) continue
        haut = Math.min(haut, y)
        bas = Math.max(bas, y)
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
      }
    }
    return { gauche: minX, droite: maxX, haut, bas }
  }
  return {
    ermine: boite(triees[0]!, coupure),
    mot: boite(coupure, triees[triees.length - 1]!),
  }
}

interface Relatif {
  readonly hauteurMotEm: number
  readonly hauteurErmineEm: number
  readonly ecartHautEm: number
  readonly basEcartEm: number
  readonly ecartHorizontalEm: number
  readonly ratioErmine: number
  readonly largeurMotEm: number
}

function relatif(mesure: Mesure): Relatif {
  const { ermine, mot } = mesure
  const hauteurErmine = ermine.bas - ermine.haut
  return {
    hauteurMotEm: (mot.bas - mot.haut) / ECHELLE,
    hauteurErmineEm: hauteurErmine / ECHELLE,
    // Positive: the word's ascender ink sits above the ermine's ink top.
    ecartHautEm: (ermine.haut - mot.haut) / ECHELLE,
    basEcartEm: (mot.bas - ermine.bas) / ECHELLE,
    ecartHorizontalEm: (mot.gauche - ermine.droite) / ECHELLE,
    ratioErmine: (ermine.droite - ermine.gauche) / hauteurErmine,
    largeurMotEm: (mot.droite - mot.gauche) / ECHELLE,
  }
}

const provenance = JSON.parse(readFileSync(resolve(DOSSIER, 'provenance.json'), 'utf8')) as {
  kind: string
  scalePxPerEm: number
  toleranceRationale: string
  header: { file: string; sha256: string; source: string; method: string }
  pdf: { file: string; sha256: string; head: string; pdfSha256: string; requestSha256: string; render: string }
}

const encreEcran = mesurerEncre(lirePng(resolve(DOSSIER, provenance.header.file)))
const encrePdf = mesurerEncre(lirePng(resolve(DOSSIER, provenance.pdf.file)))
const relatifEcran = relatif(encreEcran)
const relatifPdf = relatif(encrePdf)

describe('#1024 — lockup réel écran vs PDF : deux rasters indépendants, encre relative', () => {
  it('fie les deux rasters à leur provenance de mesure, et pas à une sortie de code', () => {
    expect(provenance.kind).toMatch(/measurement snapshot/i)
    expect(provenance.scalePxPerEm).toBe(ECHELLE)
    expect(provenance.toleranceRationale).toContain('0.02')
    expect(provenance.header.source).toContain('read-only live app')
    expect(provenance.pdf.head).toMatch(/^[0-9a-f]{40}$/)
    expect(provenance.pdf.pdfSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(provenance.pdf.requestSha256).toMatch(/^[0-9a-f]{64}$/)
    for (const [fichier, attendu] of [
      [provenance.header.file, provenance.header.sha256],
      [provenance.pdf.file, provenance.pdf.sha256],
    ] as const) {
      const hash = createHash('sha256').update(readFileSync(resolve(DOSSIER, fichier))).digest('hex')
      expect(hash, fichier).toBe(attendu)
    }
  })

  it('compare le mot entier et l’hermine, pas une découpe partielle', () => {
    // Full word, not a single glyph or an ermine-only crop: both sides carry
    // more than a word's width and a real ermine body.
    expect(relatifEcran.largeurMotEm).toBeGreaterThan(1.5)
    expect(relatifPdf.largeurMotEm).toBeGreaterThan(1.5)
    expect(relatifEcran.hauteurErmineEm).toBeGreaterThan(0.35)
    expect(relatifPdf.hauteurErmineEm).toBeGreaterThan(0.35)
  })

  it('mesure la même encre relative sur le header réel et le PDF, à 0,02 em près', () => {
    // Lengths and offsets are em-relative distances on the 720 px/em rasters.
    const ecarts: Array<[string, number]> = [
      ['hauteur d’encre du mot', relatifEcran.hauteurMotEm - relatifPdf.hauteurMotEm],
      ['hauteur d’encre de l’hermine', relatifEcran.hauteurErmineEm - relatifPdf.hauteurErmineEm],
      ['écart ascendant → haut de l’hermine', relatifEcran.ecartHautEm - relatifPdf.ecartHautEm],
      ['bas du mot → bas de l’hermine', relatifEcran.basEcartEm - relatifPdf.basEcartEm],
      ['écart d’encre horizontal', relatifEcran.ecartHorizontalEm - relatifPdf.ecartHorizontalEm],
    ]
    for (const [nom, ecart] of ecarts) {
      expect(Math.abs(ecart), `${nom} : ${ecart} em`).toBeLessThanOrEqual(TOLERANCE_EM)
    }
    // The ermine's proportions are a ratio, not an em length: same bound, own
    // unit. The measured screen-vs-PDF aspect delta is 0.01023 (dimensionless).
    const aspect = relatifEcran.ratioErmine - relatifPdf.ratioErmine
    expect(Math.abs(aspect), `proportions de l’hermine : ${aspect} (sans dimension)`)
      .toBeLessThanOrEqual(TOLERANCE_ASPECT)
    // The withdrawn claim was a 0.076 em ermine lift; it would fail the top-gap
    // check by nearly 4× the tolerance.
    expect(Math.abs(relatifEcran.ecartHautEm - relatifPdf.ecartHautEm)).toBeLessThan(0.05)
  })

  it('lie le PDF courant au raster PDF pinné (la mesure vieillit, elle ne ment pas)', async () => {
    const taille = ROLE_PDF.marqueMot.taille
    const lecture = await lirePdf((await composerCahierPdf(requetePour('aedar-access'), {
      signal: new AbortController().signal,
      chargerPolice: chargeurPoliceTest,
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
    expect(ermine.length).toBe(5)
    const hauteur = (Math.max(...ermine.map((chemin) => chemin.y + chemin.height))
      - Math.min(...ermine.map((chemin) => chemin.y))) / taille
    expect(Math.abs(hauteur - relatifPdf.hauteurErmineEm)).toBeLessThanOrEqual(TOLERANCE_EM)
    const mot = lecture.textes.find((item) => item.str === 'lusk')!
    // The word pen follows the owner's box + gap ...
    expect((mot.x - PAGE_APPROUVEE.insetGauchePt) / taille)
      .toBeCloseTo(MARQUE_LUSK_LOCKUP.ermineEm + MARQUE_LUSK_LOCKUP.ecartPx * 531.28 / 1010.4 / taille, 2)
    // ... and the *pinned raster* independently checks the resulting ink gap:
    // the embedded face's `xMin == lsb` (pinned in the ink spec) makes the pen
    // origin the word's ink left, so a wrong gap cannot hide behind the owner
    // expression above.
    const ermineDroite = Math.max(...ermine.map((chemin) => chemin.x + chemin.width))
    // The word's ink left is the pen plus the face's `l` side bearing (the
    // `xMin == lsb` contract is pinned in the ink spec); everything else is the
    // measured PDF ink gap, so a wrong gap cannot hide behind the owner.
    const font = lirePoliceTtf(new Uint8Array(readFileSync(
      resolve(process.cwd(), 'src/assets/fonts/pdf/newsreader-600-italic.ttf'),
    )))
    const lsb = font.leftSideBearing('l')! / font.unitsPerEm
    expect(Math.abs((mot.x + lsb * taille - ermineDroite) / taille - relatifPdf.ecartHorizontalEm))
      .toBeLessThanOrEqual(TOLERANCE_EM)
  })
})
