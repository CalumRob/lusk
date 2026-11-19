/**
 * Regressions for the two owner findings on the review9 receipt (#1024):
 * the frozen map raster must still fill the circular plate (clipped, one raster,
 * native ring intact), and a table caption equal to its focal header prints once.
 */
import { describe, expect, it } from 'vitest'
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'

import { composerCahierPdf } from '@/fiche/prototype/cahierPdfComposer'
import { projeterRequeteExport } from '@/fiche/prototype/cahierExportCapture'
import { projeterRequeteExportFigures } from '@/fiche/prototype/cahierExportAdapters'
import { construireTableauxPdf } from '@/fiche/prototype/cahierPdfTableau'
import { mesurePdfTest, chargeurPoliceTest, lirePdf, cheminsPdf, type LecturePdf } from './helpers/cahierPdfRuntime'
import { capturePdfFixture } from './helpers/cahierPdfFixtures'

function requete(capture: ReturnType<typeof capturePdfFixture>) {
  const offered = capture.capabilities.selectableSeries.map((serie) => serie.id)
  const projection = projeterRequeteExport(capture, offered.slice(0, 3))
  if (projection.status !== 'ready') throw new Error(projection.reason)
  return projection.request
}

async function generate(capture: ReturnType<typeof capturePdfFixture>) {
  return lirePdf((await composerCahierPdf(requete(capture), {
    signal: new AbortController().signal,
    chargerPolice: chargeurPoliceTest,
    urlPublique: 'https://lusk.test/territoire/commune/22001?theme=mobilite#section-aedar-access',
    urlAccueil: 'https://lusk.test/',
  })).blob)
}

/** Raster xobjects actually painted, with their drawn size/position (PDF points). */
async function imagesPaintes(lecture: LecturePdf) {
  const pdf = await getDocument({ data: Uint8Array.from(lecture.octets) }).promise
  const page = await pdf.getPage(1)
  const flux = await page.getOperatorList()
  const images: Array<{ natif: string; largeur: number; hauteur: number; x: number; y: number }> = []
  for (let index = 0; index < flux.fnArray.length; index += 1) {
    if (flux.fnArray[index] !== OPS.paintImageXObject) continue
    let transform: number[] | null = null
    for (let back = index - 1; back >= Math.max(0, index - 4) && !transform; back -= 1) {
      if (flux.fnArray[back] === OPS.transform) transform = flux.argsArray[back] as number[]
    }
    const args = flux.argsArray[index]
    if (transform) {
      images.push({
        natif: `${args[1]}x${args[2]}`,
        largeur: transform[0], hauteur: transform[3], x: transform[4], y: transform[5],
      })
    }
  }
  return images
}

/** Circular plate paths: the clip/content circle and the native ring stroke. */
async function cerclesPlaque(lecture: LecturePdf) {
  const chemins = await cheminsPdf(lecture.octets, 1)
  return chemins.filter((chemin) => chemin.kind === 'stroke'
    && Math.abs(chemin.width - chemin.height) < 1 && chemin.width > 20
    && chemin.x < 120 && chemin.y > 150 && chemin.y < 260)
}

describe('plaque cartographique et légende de tableau (#1024)', () => {
  it('un seul raster figé remplit la plaque circulaire, l’anneau natif intact', async () => {
    const lecture = await generate(capturePdfFixture('aedar-car-overview'))
    const images = await imagesPaintes(lecture)
    expect(images).toHaveLength(1)
    const cercles = await cerclesPlaque(lecture)
    expect(cercles.length).toBeGreaterThanOrEqual(1)
    // The native ring is the outer circle; its stroke is the owner's 4 CSS px
    // border scaled into PDF points.
    const anneau = cercles.reduce((a, b) => (b.width > a.width ? b : a))
    expect((anneau.largeur ?? 0)).toBeGreaterThan(1.5)
    const image = images[0]!
    // Plate-sized and clipped: the raster spans the ring's inner diameter,
    // not a smaller disc floating inside the plate (the review9 regression,
    // where the frozen 200px raster shrank the grid track to 105 pt).
    const diametreInterieur = anneau.width - 2 * (anneau.largeur ?? 0)
    expect(image.largeur).toBeGreaterThan(diametreInterieur - 2)
    expect(image.largeur).toBeLessThanOrEqual(anneau.width + 2)
    expect(image.largeur).toBeCloseTo(image.hauteur, 0)
    expect(image.x).toBeCloseTo(anneau.x + (anneau.largeur ?? 0), 0)
  })

  it('la légende du tableau ne répète pas l’en-tête focal identique', async () => {
    const capture = capturePdfFixture('aedar-car-overview')
    const mesure = await mesurePdfTest()
    const table = projeterRequeteExportFigures(requete(capture))[0]!.tables[0]!
    const parts = construireTableauxPdf(table, {
      mesure, largeurDisponible: 180, nomTerritoire: capture.identity.territory.name, ownerDisplayed: true,
    })
    const caption = parts[0]!.titleLines.join(' ')
    expect(caption).toBe(table.title)
    // The approved generator puts the territory name in that header, never the
    // caption a second time (`rennes.js`: heading(title) then ['Mesure','Rennes',...]).
    const entetes = parts[0]!.columns.map((column) => column.headerLines.join(' '))
    expect(entetes).not.toContain(caption)
    expect(entetes).toContain(capture.identity.territory.name)

    const lecture = await generate(capture)
    const titre = 'En voiture en 15 minutes (moyenne par adresse)'
    // Figure caption + one table caption, but no third identical header line.
    expect(lecture.textes.filter((item) => item.str === titre)).toHaveLength(2)
    const enteteTerritoire = lecture.textes.filter((item) => item.str === capture.identity.territory.name)
    expect(enteteTerritoire.length).toBeGreaterThan(0)
  })
})
