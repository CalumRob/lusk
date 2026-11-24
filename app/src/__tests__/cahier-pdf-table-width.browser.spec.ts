/**
 * Real-PDF regressions for the natural-width value-table layout (#1024).
 *
 * These assertions read painted bytes (text items and content-stream paths),
 * not only the composer's layout objects, so they hold the owner decision:
 * a narrow table hugs its measured content and is centred on the figure's
 * axis, a wide table still fits the body, and no cell that fit on one line is
 * forced to wrap.
 */
import { describe, expect, it } from 'vitest'

import { composerCahierPdf } from '@/fiche/prototype/cahierPdfComposer'
import {
  LARGEUR_CORPS_PT,
  PADDING_SECTION_PT,
  PAGE_APPROUVEE,
} from '@/fiche/prototype/cahierPdfGrammaire'
import { projeterRequeteExport } from '@/fiche/prototype/cahierExportCapture'
import { projeterRequeteExportFigures } from '@/fiche/prototype/cahierExportAdapters'
import { construireTableauxPdf } from '@/fiche/prototype/cahierPdfTableau'
import type { CahierExportCapture, CahierExportRequest } from '@/fiche/prototype/cahierExportCapture'
import {
  chargeurPoliceTest,
  cheminsPdf,
  lirePdf,
  mesurePdfTest,
  type LecturePdf,
} from './helpers/cahierPdfRuntime'
import { captureExplorerRangs, capturePartDense, capturePdfFixture } from './helpers/cahierPdfFixtures'

const PT_PAR_MM = 72 / 25.4
const CORPS_GAUCHE_PT = PAGE_APPROUVEE.insetGauchePt + PADDING_SECTION_PT
const CORPS_DROIT_PT = CORPS_GAUCHE_PT + LARGEUR_CORPS_PT

function requete(capture: CahierExportCapture, modes?: readonly string[]): CahierExportRequest {
  const offered = capture.capabilities.selectableSeries.map((serie) => serie.id)
  const projection = projeterRequeteExport(capture, modes ?? offered.slice(0, 3))
  if (projection.status !== 'ready') throw new Error(projection.reason)
  return projection.request
}

async function generate(capture: CahierExportCapture, modes?: readonly string[]) {
  return lirePdf((await composerCahierPdf(requete(capture, modes), {
    signal: new AbortController().signal,
    chargerPolice: chargeurPoliceTest,
    urlPublique: 'https://lusk.test/territoire/commune/22001?theme=mobilite#section-aedar-access',
    urlAccueil: 'https://lusk.test/',
  })).blob)
}

/** Table rule strokes: horizontal strokes below the page header, shorter than a full page. */
async function reglesTable(lecture: LecturePdf) {
  const chemins = await cheminsPdf(lecture.octets, lecture.pages)
  return chemins.filter((chemin) => chemin.kind === 'stroke'
    && chemin.height < 0.6 && chemin.width > 100 && chemin.width < 500 && chemin.y > 100)
}

describe('largeur naturelle des tableaux de valeur (#1024)', () => {
  it('une table étroite s’arrête à sa largeur de contenu mesurée, centrée dans le corps', async () => {
    const capture = capturePdfFixture('visiter-la-bretagne')
    const lecture = await generate(capture)
    const regles = await reglesTable(lecture)
    expect(regles.length).toBeGreaterThan(0)
    const largeurPeinte = Math.max(...regles.map((chemin) => chemin.width))
    // Every rule of one table shares the same width — no per-column stretch.
    for (const chemin of regles) expect(chemin.width).toBeCloseTo(largeurPeinte, 0)

    // The painted width equals the font-measured natural width the grammar
    // produces from the same frozen model (not a stretched full-body box).
    const mesure = await mesurePdfTest()
    const naturels = projeterRequeteExportFigures(requete(capture)).flatMap((projection) => projection.tables.flatMap(
      (table) => construireTableauxPdf(table, {
        mesure,
        largeurDisponible: LARGEUR_CORPS_PT * 25.4 / 72,
        nomTerritoire: capture.identity.territory.name,
        ownerDisplayed: true,
      }),
    ))
    const attenduPt = Math.max(...naturels.map((part) => part.naturalWidth)) * PT_PAR_MM
    expect(largeurPeinte).toBeCloseTo(attenduPt, 0)

    const droite = Math.max(...regles.map((chemin) => chemin.x + chemin.width))
    const gauche = Math.min(...regles.map((chemin) => chemin.x))
    expect(droite).toBeLessThan(CORPS_DROIT_PT - 50)
    expect(gauche).toBeGreaterThan(CORPS_GAUCHE_PT + 50)
    // Centred: equal slack on both sides of the body.
    expect(Math.abs((gauche - CORPS_GAUCHE_PT) - (CORPS_DROIT_PT - droite))).toBeLessThan(2)
  })

  it('une table large (neuf colonnes groupées) tient encore dans le corps', async () => {
    const capture = captureExplorerRangs()
    const lecture = await generate(capture, ['car', 'bike_lts2', 'transit'])
    const regles = await reglesTable(lecture)
    expect(regles.length).toBeGreaterThan(0)
    for (const chemin of regles) {
      expect(chemin.x).toBeGreaterThanOrEqual(CORPS_GAUCHE_PT - 1)
      expect(chemin.x + chemin.width).toBeLessThanOrEqual(CORPS_DROIT_PT + 1)
    }
    // The wide table really needs more width than the narrow curve table.
    expect(Math.max(...regles.map((chemin) => chemin.width))).toBeGreaterThan(400)
  })

  it('aucune cellule qui tenait sur une ligne n’est forcée à plier', async () => {
    const lecture = await generate(capturePartDense())
    // The compared header and the served rank keep their one-line display:
    // a natural-width table must not reintroduce a wrap inside a cell.
    expect(lecture.textes.some((item) => item.str.includes('Groupe comparé ¹'))).toBe(true)
    expect(lecture.textes.filter((item) => item.str === '1er/38')).toHaveLength(1)
  })
})
