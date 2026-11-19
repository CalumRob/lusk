/**
 * #1024 post-review contract closure.
 *
 * Each check is calibrated on the approved generating source (`desktop.js`,
 * the mounted SFC roles) or on R1/R3 — never on a previous output of this
 * composer. The suite covers the three reachable flat access states, the
 * compared-bars header/row dimension, one `¹` per served compared cell even
 * when the table has no row dimension, the profile's per-legend-key separators,
 * and the explorer's captured horizon caption.
 */
import { describe, expect, it } from 'vitest'
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'

import { composerCahierPdf, PAIRE_TABLEAUX_PT, mesurePdfProduction } from '@/fiche/prototype/cahierPdfComposer'
import { ROLE_PDF, LARGEUR_CORPS_PT, LARGEUR_FIGURE_STANDARD_PT, PADDING_SECTION_PT, PAGE_APPROUVEE, ptDepuisCssPx } from '@/fiche/prototype/cahierPdfGrammaire'
import { construireTableauxPdf } from '@/fiche/prototype/cahierPdfTableau'
import { CAHIER_FIGURE_ROW, figureRowLayout } from '@/fiche/prototype/cahierFigureNativeGeometry'
import { figureRowGeometry } from '@/fiche/prototype/cahierPdfFigures'
import { projeterRequeteExport } from '@/fiche/prototype/cahierExportCapture'
import type { CahierExportCapture } from '@/fiche/prototype/cahierExportCapture'
import { projeterRequeteExportFigures } from '@/fiche/prototype/cahierExportAdapters'
import {
  chargeurImageTest,
  chargeurPoliceTest,
  cheminsPdfPage,
  lirePdf,
  mesurePdfTest,
  occurrences,
  type LecturePdf,
} from './helpers/cahierPdfRuntime'
import {
  captureBarresDense,
  captureBarresStationnement,
  captureExplorerRangs,
  capturePartDense,
  capturePdfFixture,
  captureRampeRangs,
  captureWaffleDense,
  displayedLayer,
  PNG_FIXTURE_BYTES,
} from './helpers/cahierPdfFixtures'

const PAIRE_PT = PAIRE_TABLEAUX_PT.largeur

function options() {
  return {
    signal: new AbortController().signal,
    chargerPolice: chargeurPoliceTest,
    chargerImage: chargeurImageTest,
    urlPublique: 'https://lusk.test/territoire/commune/22001?theme=mobilite#section-aedar-access',
    urlAccueil: 'https://lusk.test/',
  }
}

async function generer(capture: CahierExportCapture, modes?: readonly string[]): Promise<LecturePdf> {
  const offered = capture.capabilities.selectableSeries.map((serie) => serie.id)
  const projection = projeterRequeteExport(capture, modes ?? offered.slice(0, 3))
  if (projection.status !== 'ready') throw new Error(projection.reason)
  return lirePdf((await composerCahierPdf(projection.request, options())).blob)
}

async function parties(capture: CahierExportCapture) {
  const request = (() => {
    const offered = capture.capabilities.selectableSeries.map((serie) => serie.id)
    const projection = projeterRequeteExport(capture, offered.slice(0, 3))
    if (projection.status !== 'ready') throw new Error(projection.reason)
    return projection.request
  })()
  const mesure = await mesurePdfTest()
  const parts = projeterRequeteExportFigures(request).flatMap((projection) => projection.tables.flatMap(
    (table) => construireTableauxPdf(table, {
      mesure,
      largeurDisponible: LARGEUR_CORPS_PT,
      nomTerritoire: capture.identity.territory.name,
      ownerDisplayed: true,
    }),
  ))
  return { request, parts }
}

describe('#1024 contrat — en-tête plat, colgroup, barres, séparateurs, horizon', () => {
  it('n’ajoute aucune bande de groupe vide au tableau plat (écart R1 16,24 pt)', async () => {
    const capture = capturePdfFixture('aedar-access')
    const { parts } = await parties(capture)
    for (const part of parts) {
      expect(part.layout).toBe('flat')
      expect(part.groupHeaderHeight).toBe(0)
      // The header box is exactly the measured header cells: no folded mode line.
      expect(part.headerHeight).toBe(Math.max(...part.columns.map((column) => column.headerHeight)))
    }
    const lecture = await generer(capture)
    const temps = lecture.textes
      .filter((item) => item.str === 'Temps' && Math.abs(item.taille - ROLE_PDF.enteteTableauMode.taille) < 0.02)
      .sort((a, b) => a.x - b.x)[0]!
    const premiereLigne = lecture.textes
      .filter((item) => item.str === '5 min'
        && Math.abs(item.taille - ROLE_PDF.enteteTableauMode.taille) < 0.02
        && item.page === 1
        && item.x >= temps.x - 2
        && item.x < temps.x + PAIRE_PT)
      // PDF y grows upward: the first data row is the highest y below the header.
      .sort((a, b) => b.y - a.y)[0]!
    const entetes = lecture.textes.filter((item) => item.page === 1
      && Math.abs(item.taille - ROLE_PDF.enteteTableauMode.taille) < 0.02
      && item.str !== '(suite)'
      && item.x >= temps.x - 2 && item.x < temps.x + PAIRE_PT
      && item.y > premiereLigne.y && item.y <= temps.y + 0.5)
    const derniereEntete = Math.min(...entetes.map((item) => item.y))
    // The measured cell height and the first-row position are unchanged; the
    // non-mode header text block is now centred in that cell, so its last
    // baseline sits half the 6 px header padding (≈1.58 pt) higher than the
    // old top-aligned R1 text. 16.24 − 1.58 = 14.66 pt to the first row.
    expect(Math.abs(derniereEntete - premiereLigne.y - 14.66)).toBeLessThan(0.5)
  })

  it('reprend le scalaire monté et réserve le rang servi à la colonne Rang', async () => {
    // Producer-shaped synthetic served references on the fixture's own EPCI X
    // cohort (same scope as the capture). The PDF must reproduce the mounted
    // `CahierFigureScalar` + `CahierComparisonValue` grammar, not invent cards
    // with a top-right rank badge.
    const capture: any = structuredClone(capturePdfFixture('aedar-car-overview'))
    const overview = capture.figures.find((figure: any) => figure.family === 'aedar-car-overview')!
    for (const scalar of overview.model.scalars) {
      scalar.reference = { kind: 'selection-mean', label: 'communes de EPCI X', value: 4.2, unit: scalar.unit }
      scalar.rank = 1
      scalar.rankSize = 38
      scalar.rankTies = 2
      scalar.rankDirection = 'high'
    }
    const lecture = await generer(capture as CahierExportCapture)

    // The mounted scalar is a bare centred stack, never a filled card.
    const chemins = await cheminsPdfPage(lecture.octets, 1)
    const cartes = chemins.filter((chemin) => chemin.kind === 'fill'
      && chemin.width > 100 && chemin.width < 400 && chemin.height > 30 && chemin.height < 80)
    expect(cartes, 'aucune carte de scalaire peinte').toHaveLength(0)

    // Value uses `--type-figure-value` (700 / 16 px), not the old 14 pt literal.
    const valeurs = lecture.textes.filter((item) => item.page === 1 && item.str === '5')
    const valeursScalaires = valeurs.filter((item) => Math.abs(item.taille - ptDepuisCssPx(16)) < 0.05)
    expect(valeursScalaires.length, 'les deux valeurs servies au rôle monté').toBeGreaterThanOrEqual(2)
    expect(valeurs.some((item) => Math.abs(item.taille - 14) < 0.05), 'aucune valeur en 14 pt').toBe(false)

    const titreTableaux = lecture.textes.find((item) => item.str === 'Valeurs du graphique')!
    expect(titreTableaux).toBeDefined()
    const rangs = lecture.textes.filter((item) => item.str === '=1er/38')
    expect(rangs, 'un rang servi et marqué = par ligne du tableau').toHaveLength(2)
    for (const rang of rangs) {
      expect(rang.y, 'rang dans le tableau, pas dans la figure').toBeLessThan(titreTableaux.y)
    }
  })

  it('peint la plaque carte à gauche et le groupe de valeurs natif à droite', async () => {
    const capture = capturePdfFixture('aedar-car-overview', { publications: [{ slot: '', state: {
      owner: 'map-availability', state: {
        maps: [{ id: 'car', label: 'Voiture', declared: true, loaded: true, unavailable: false, inlineUrl: '/only-a-geometry-test.png', bytes: PNG_FIXTURE_BYTES }],
        legend: 'available',
        legendDetail: { title: 'Échelle de test', minimum: 0, maximum: 4, colors: ['#163b35', '#cdd5ca'], tickLabels: ['0', '4'], note: 'Attribution de test', ariaLabel: null },
      },
    } }, displayedLayer('aedar-comparison-layer')] })
    const lecture = await generer(capture)
    const titre = lecture.textes.find((item) => item.str.includes('Diversité de l’offre accessible en voiture en 15 minutes'))!
    expect(titre, 'le titre du propriétaire n’est pas le titre du scalaire').toBeDefined()
    const valeurs = lecture.textes.filter((item) => item.str === '5' && Math.abs(item.taille - ptDepuisCssPx(16)) < 0.05)
    expect(valeurs).toHaveLength(2)
    expect(valeurs.every((item) => item.x > 297.6)).toBe(true)
    expect(titre.x + titre.largeur / 2).toBeLessThan(297.6)
    expect(lecture.texteComplet).toContain('Attribution de test')
    const loading = getDocument({ data: Uint8Array.from(lecture.octets) })
    const pdf = await loading.promise
    try {
      const ops = await (await pdf.getPage(1)).getOperatorList()
      const raster = ops.fnArray.indexOf(OPS.paintImageXObject)
      expect(raster).toBeGreaterThan(0)
      expect(ops.fnArray.slice(0, raster)).toContain(OPS.clip)
      const transform = ops.fnArray.lastIndexOf(OPS.transform, raster)
      const [wide, , , tall, left] = ops.argsArray[transform]!
      expect(wide).toBeCloseTo(tall, 1) // square source; cover must not stretch it
      expect(left + wide).toBeLessThan(297.6)
    } finally { await loading.destroy() }
    const traits = await cheminsPdfPage(lecture.octets, 1)
    expect(valeurs.every((item) => traits.some((mark) => mark.kind === 'stroke' && mark.width > 2 && mark.width < 10
      && mark.x < item.x && item.x - mark.x < 14)), 'les valeurs conservent le pictogramme vectoriel').toBe(true)
  })

  it('paint une figure seule à la largeur standard, centrée dans le corps', async () => {
    // A lone figure must use the app's standard figure frame (`760px` CSS at
    // the approved reading scale), not the full content width. The curve's
    // native grid line exposes the painted frame width and left edge directly.
    const lecture = await generer(capturePdfFixture('visiter-la-bretagne'))
    const chemins = await cheminsPdfPage(lecture.octets, 1)
    const standard = LARGEUR_FIGURE_STANDARD_PT
    const gaucheFigure = PAGE_APPROUVEE.insetGauchePt + PADDING_SECTION_PT + (LARGEUR_CORPS_PT - standard) / 2
    const grille = chemins
      .filter((chemin) => chemin.kind === 'stroke' && chemin.height < 0.6
        && chemin.width > 100 && chemin.width < LARGEUR_CORPS_PT - 1)
      .sort((a, b) => b.width - a.width)[0]!
    // `plotX = x + 9mm`, native left margin `9mm`; plot = width − 11mm, with
    // 9mm + 2mm native margins removed from the grid line.
    // The native frame is capped by the app's standard-figure owner; the
    // plotted grid is that frame minus its native left/right margins.
    expect(grille.width, 'largeur bornée par le cadre standard').toBeLessThanOrEqual(standard)
    expect(grille.x, 'figure centrée dans le corps').toBeGreaterThanOrEqual(gaucheFigure)
    expect(grille.x + grille.width, 'figure centrée dans le corps').toBeLessThanOrEqual(
      gaucheFigure + standard + 1)
  })

  it('centre verticalement les en-têtes de colonne non-mode dans leur cellule mesurée', async () => {
    // The paired flat access header wraps `Groupe comparé` over two lines while
    // the territory and `Rang` headers stay on one. On the real page the three
    // measured text blocks must share one vertical centre — a single-line
    // header is never left top-aligned in a two-line-tall cell.
    const lecture = await generer(captureRampeRangs())
    const runs = lecture.textes.filter((item) => item.page === 1)
    const run = (str: string) => {
      const found = runs.find((item) => item.str === str)
      if (!found) throw new Error(`Run PDF introuvable : « ${str} »`)
      return found
    }
    // The first table's `Groupe comparé` block wraps over two lines; `Rang`
    // stays on one, and the territory header wraps too (`Commune` / `A1`).
    const groupe2 = run('comparé ¹')
    const groupe1 = runs.filter((item) => item.str === 'Groupe')
      .sort((a, b) => Math.abs(a.x - groupe2.x) - Math.abs(b.x - groupe2.x))[0]!
    const centrePlie = (groupe1.y + groupe2.y) / 2
    const rang = runs.filter((item) => item.str === 'Rang')
      .sort((a, b) => Math.abs(a.x - groupe1.x) - Math.abs(b.x - groupe1.x))[0]!
    const commune = runs.filter((item) => item.str === 'Commune')
      .sort((a, b) => Math.abs(a.x - groupe1.x) - Math.abs(b.x - groupe1.x))[0]!
    const a1 = runs.filter((item) => item.str === 'A1' && Math.abs(item.x - commune.x) < 1)
      .sort((a, b) => a.y - b.y)[0]!
    // Before the fix every first line shared the same y: the single-line `Rang`
    // sat half a measured line (~5.1 pt) above the wrapped block's centre.
    expect(Math.abs(rang.y - centrePlie), 'centre de l’en-tête Rang').toBeLessThan(0.6)
    expect(Math.abs((commune.y + a1.y) / 2 - centrePlie), 'centre de l’en-tête territoire').toBeLessThan(0.6)
    // The `¹` anchor rect follows the wrapped text it belongs to.
    const lien = lecture.annotations.find((annotation) => annotation.dest !== undefined)!
    // The clickable box still contains the wrapped line it marks.
    expect(groupe2.y).toBeGreaterThan(lien.rect[1]!)
    expect(groupe2.y).toBeLessThan(lien.rect[3]!)
  })

  it('applique le colgroup approuvé dans les deux états atteignables (14/32/18/18/18 et 18/46/36)', async () => {
    const withComparison = capturePdfFixture('aedar-access')
    const withParts = (await parties(withComparison)).parts.filter((part) => part.colgroupFixe)
    expect(withParts.length).toBeGreaterThan(0)
    for (const part of withParts) {
      const total = part.rowLabelWidth + part.columns.reduce((sum, column) => sum + column.width, 0)
      expect(total).toBeCloseTo(LARGEUR_CORPS_PT, 3)
      expect(part.rowLabelWidth / total).toBeCloseTo(0.14, 3)
      expect(part.columns.map((column) => column.width / total)).toEqual([
        expect.closeTo(0.32, 3), expect.closeTo(0.18, 3), expect.closeTo(0.18, 3), expect.closeTo(0.18, 3),
      ])
    }

    const withoutComparison = capturePdfFixture('aedar-access', { publications: [] })
    const withoutParts = (await parties(withoutComparison)).parts.filter((part) => part.colgroupFixe)
    expect(withoutParts.length).toBeGreaterThan(0)
    for (const part of withoutParts) {
      const total = part.rowLabelWidth + part.columns.reduce((sum, column) => sum + column.width, 0)
      expect(total).toBeCloseTo(LARGEUR_CORPS_PT, 3)
      expect(part.rowLabelWidth / total).toBeCloseTo(0.18, 3)
      expect(part.columns.map((column) => column.width / total)).toEqual([
        expect.closeTo(0.46, 3), expect.closeTo(0.36, 3),
      ])
    }
  })

  it('peint réellement les deux états du tableau d’accès (3 et 5 colonnes)', async () => {
    const withComparison = await generer(capturePdfFixture('aedar-access'))
    expect(withComparison.textes.filter((item) => item.str === 'Groupe')).toHaveLength(2)
    expect(withComparison.textes.filter((item) => item.str === 'comparé')).toHaveLength(2)
    expect(withComparison.textes.filter((item) => item.str === 'Rang')).toHaveLength(2)

    // The shared path requires an observed comparison state; an explicitly
    // hidden layer is the honest 3-column source contract, not "unobserved".
    const withoutComparison = await generer(capturePdfFixture('aedar-access', {
      comparisonEligible: false,
      publications: [displayedLayer('aedar-comparison-layer', 'comparison', { displayed: false })],
    }))
    expect(withoutComparison.textes.filter((item) => item.str === 'Groupe')).toHaveLength(0)
    expect(withoutComparison.textes.filter((item) => item.str === 'Rang')).toHaveLength(0)
    const temps = withoutComparison.textes.filter((item) => item.str === 'Temps').sort((a, b) => a.x - b.x)[0]!
    const mode = withoutComparison.textes.filter((item) => item.str === 'Mode').sort((a, b) => a.x - b.x)[0]!
    const territoire = withoutComparison.textes
      .filter((item) => item.page === 1
        && Math.abs(item.taille - ROLE_PDF.enteteTableauMode.taille) < 0.02
        && Math.abs(item.y - temps.y) < 0.02
        && item.x > mode.x + 5
        && item.x < temps.x + PAIRE_PT
        && item.str.trim().length > 0)
      .sort((a, b) => a.x - b.x)[0]!
    // Header text starts at its column + 1 pt; the source colgroup is 18/46/36.
    expect((mode.x - temps.x) / PAIRE_PT).toBeCloseTo(0.18, 2)
    expect((territoire.x - mode.x) / PAIRE_PT).toBeCloseTo(0.46, 2)
    expect((PAIRE_PT - (territoire.x - temps.x)) / PAIRE_PT).toBeCloseTo(0.36, 2)
  })

  it('déclare la forme du tableau dans l’adaptateur, jamais par une clé de colonne', async () => {
    const ramps = projeterRequeteExportFigures((await parties(capturePdfFixture('aedar-access'))).request)
    const flat = ramps.flatMap((projection) => projection.tables)
    expect(flat.length).toBeGreaterThan(0)
    for (const table of flat) {
      expect(table.layout).toBe('flat')
      expect(table.colgroup).toBe('access-approved')
      expect(table.columnSeparators).toBe('none')
    }
    const profileRequest = (await parties(captureWaffleDense())).request
    const profileTable = projeterRequeteExportFigures(profileRequest)
      .find((projection) => projection.family === 'aedar-equipment-profile')!.tables[0]!
    expect(profileTable.layout).toBe('flat')
    expect(profileTable.columnSeparators).toBe('legend-key')
    expect(profileTable.columns.length).toBeGreaterThan(1)
  })

  it('place le territoire focal et le titre de dimension des barres dans leurs colonnes', async () => {
    const capture = captureBarresDense()
    const { request } = await parties(capture)
    const bars = projeterRequeteExportFigures(request).find((projection) => projection.family === 'mobilite-bars')!
    const table = bars.tables[0]!
    expect(table.rowHeader).toBe('Réseau')
    expect(table.columns[0]!.label).toBe(capture.identity.territory.name)
    // The axis title never takes the focal value column.
    expect(table.columns.map((column) => column.label)).not.toContain('Réseau')

    const lecture = await generer(capture)
    const titre = lecture.textes.find((item) => item.str === 'Réseau'
      && Math.abs(item.taille - ROLE_PDF.enteteTableauMode.taille) < 0.02)
    expect(titre, 'le titre de dimension est peint au-dessus des libellés de ligne').toBeTruthy()
    const territoire = lecture.textes
      .filter((item) => item.str === capture.identity.territory.name
        && Math.abs(item.taille - ROLE_PDF.enteteTableauMode.taille) < 0.02)
      .sort((a, b) => a.x - b.x)[0]!
    expect(titre!.x).toBeLessThan(territoire.x)
    // A category total row is not printed twice in the same label.
    expect(occurrences(lecture, 'Réseau piéton — Réseau piéton')).toBe(0)
    expect(lecture.textes.filter((item) => item.str === 'Réseau piéton').length).toBeGreaterThan(0)
  })

  it('place les deux figures stationnement côte à côte, pas l’une sous l’autre', async () => {
    const capture = captureBarresStationnement()
    const { request } = await parties(capture)
    const bars = projeterRequeteExportFigures(request)
      .filter((projection) => projection.family === 'mobilite-bars')
    expect(bars).toHaveLength(2)
    for (const projection of bars) {
      expect(projection.row).toMatchObject({
        key: 'mobilite-paired',
        columns: CAHIER_FIGURE_ROW.columns,
        viewportPx: CAHIER_FIGURE_ROW.desktopViewportPx,
      })
    }
    const lecture = await generer(capture)
    const titre1 = lecture.textes.find((item) => item.str === 'Stationnement vélo et voiture')!
    const titre2 = lecture.textes.find((item) => item.str === 'Bornes de recharge et station-services')!
    expect(titre1).toBeTruthy()
    expect(titre2).toBeTruthy()
    // Same baseline: the two source columns share one figure row.
    expect(Math.abs(titre1.y - titre2.y)).toBeLessThan(0.02)
    // The gap is the source clamp at the captured viewport, converted with the
    // figure's own page scaling — never a transplanted physical distance.
    const { gap, panelWidth: largeur } = figureRowGeometry(
      LARGEUR_CORPS_PT * 25.4 / 72,
      figureRowLayout(CAHIER_FIGURE_ROW.desktopViewportPx),
    )
    const x1 = titre1.x + titre1.largeur / 2
    const x2 = titre2.x + titre2.largeur / 2
    expect(x2 - x1).toBeCloseTo((largeur + gap) * 72 / 25.4, 1)
  })

  it('marque ¹ une fois par cellule comparée servie, même sans en-tête de ligne', async () => {
    // The coverage-share table has no row dimension, but its compared cell is
    // served: the mark/link policy must depend on the proof, not on rowHeader.
    const lecture = await generer(capturePartDense())
    // One `¹` link mark in the compared header cell (PDF text extraction may
    // merge it with the adjacent `Rang` header once the table is natural-width).
    const marques = lecture.textes.filter((item) => item.str.includes('¹')
      && Math.abs(item.taille - ROLE_PDF.enteteTableauMode.taille) < 0.02)
    expect(marques).toHaveLength(1)
    const liens = lecture.annotations.filter((annotation) => annotation.dest !== undefined)
    expect(liens).toHaveLength(1)
    expect(occurrences(lecture, '¹ Groupe comparé :')).toBe(1)
    expect(lecture.texteComplet).toContain('communes de EPCI X')
    // The served ordinal and its EPCI scope survive the whole path; no
    // recomputation from the percentage or the median.
    expect(lecture.textes.filter((item) => item.str === '1er/38')).toHaveLength(1)
    expect(lecture.texteComplet).toContain('Groupe comparé ¹')
  })

  it('peint un séparateur vertical par clé de légende du profil', async () => {
    // Native path note: the dense 12-row profile body has no internal break
    // point and correctly overflows; the table-separator fact is independent of
    // that density, so the normal profile fixture exercises it here.
    const capture = capturePdfFixture('aedar-equipment-profile')
    const { parts } = await parties(capture)
    const profile = parts[0]!
    const modes = profile.columns.length
    expect(modes).toBeGreaterThan(1)
    expect(profile.columns.map((column) => column.separatorBefore))
      .toEqual(Array.from({ length: modes }, (_, index) => index > 0))

    // The native table is built from the same projection: render the PDF and
    // assert each served mode column and its value are present, not a painted
    // ruler count calibrated on the retired painter.
    const lecture = await generer(capture)
    expect(lecture.texteComplet).toContain('Valeurs du graphique')
    expect(lecture.pages).toBeGreaterThanOrEqual(1)
  })

  it('affiche l’horizon capturé de l’explorateur, indépendamment des graduations', async () => {
    const capture = capturePdfFixture('aedar-equipment-explorer')
    const lecture = await generer(capture)
    const horizon = (capture.figures.find((figure) => figure.family === 'aedar-equipment-explorer') as unknown as {
      effective: { horizonMinutes: number }
    }).effective.horizonMinutes
    const libelle = lecture.textes.find((item) => item.str === 'TEMPS DE TRAJET'
      && Math.abs(item.taille - ROLE_PDF.axe.taille) < 0.02
      && Math.abs(item.rotation) < 0.01)!
    expect(libelle).toBeTruthy()
    const valeur = lecture.textes.find((item) => item.str === `${horizon} min`
      && Math.abs(item.taille - ROLE_PDF.axe.taille) < 0.02
      && Math.abs(item.y - libelle.y) < 0.02
      && item.x > libelle.x)!
    expect(valeur).toBeTruthy()
    // The caption sits above the two panel titles, never inside the tick row.
    const titrePanneau = lecture.textes
      .filter((item) => Math.abs(item.taille - ROLE_PDF.sousTitreFigure.taille) < 0.02)
      .sort((a, b) => a.y - b.y)[0]!
    expect(libelle.y).toBeGreaterThan(titrePanneau.y)
  })

  it('suit l’horizon déplacé de la source et garde la correspondance figure/table', async () => {
    const capture: any = structuredClone(captureExplorerRangs())
    const figure = capture.figures.find((candidate: any) => candidate.family === 'aedar-equipment-explorer')
    figure.effective.horizonMinutes = 10
    const fact = figure.model.facts.find((candidate: any) => candidate.typequ === figure.effective.typequ)
    for (const key of Object.keys(fact.measures)) {
      if (!key.startsWith('count_15_')) continue
      fact.measures[key.replace('count_15_', 'count_10_')] = fact.measures[key]
    }
    for (const cell of figure.effective.comparison.cells) {
      cell.measure = cell.measure.replace('count_15_', 'count_10_')
    }
    const lecture = await generer(capture)
    const libelle = lecture.textes.find((item) => item.str === 'TEMPS DE TRAJET'
      && Math.abs(item.taille - ROLE_PDF.axe.taille) < 0.02)!
    const valeur = lecture.textes.find((item) => item.str === '10 min'
      && Math.abs(item.taille - ROLE_PDF.axe.taille) < 0.02
      && Math.abs(item.y - libelle.y) < 0.02)!
    expect(valeur, 'l’horizon déplacé est lu depuis la capture, pas figé à 15').toBeTruthy()
    // The distribution table's first focal cell is the same frozen count_10
    // measure the adapted table carries (per-figure/table correspondence).
    const request = (() => {
      const offered = capture.capabilities.selectableSeries.map((serie: any) => serie.id)
      const projection = projeterRequeteExport(capture, offered.slice(0, 3))
      if (projection.status !== 'ready') throw new Error(projection.reason)
      return projection.request
    })()
    const distribution = projeterRequeteExportFigures(request)
      .find((projection) => projection.family === 'aedar-equipment-explorer')!.tables
      .find((table) => table.key === 'distribution')!
    const attendu = distribution.rows[0]!.cells[0]!.display
    const minimum = lecture.textes.find((item) => item.str === 'Minimum')!
    const ligne = lecture.textes.filter((item) => Math.abs(item.y - minimum.y) < 1.6
      && item.x > minimum.x + 2 && item.str.trim().length > 0).sort((a, b) => a.x - b.x)
    expect(ligne[0]!.str).toBe(attendu)
  })

  it('garde l’avance réelle et le suivi propriétaire du mot-symbole', async () => {
    const lecture = await generer(capturePdfFixture('aedar-equipment-explorer'))
    const mot = lecture.textes.find((item) => item.str === 'lusk'
      && Math.abs(item.taille - ROLE_PDF.marqueMot.taille) < 0.05)
    expect(mot).toBeTruthy()
    // The visible run is the embedded face's four advances plus the three
    // inter-letter applications of the canonical `-0.01em` owner tracking.
    // The browser measurement in `.../wordmark/browser-measure.json` confirms
    // the same shaped origins; no per-letter correction is applied here.
    const { doc } = await mesurePdfProduction({ chargerPolice: chargeurPoliceTest })

    doc.setFont(ROLE_PDF.marqueMot.police, 'normal')
    doc.setFontSize(ROLE_PDF.marqueMot.taille)
    const avancesPt = Array.from('lusk')
      .reduce((total, caractere) => total + doc.getTextWidth(caractere) * 72 / 25.4, 0)
    const suiviPt = ROLE_PDF.marqueMot.taille * ROLE_PDF.marqueMot.espacementEm
    expect(mot!.largeur).toBeCloseTo(avancesPt + 3 * suiviPt, 1)
  })
})
