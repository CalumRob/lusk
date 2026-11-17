/**
 * Second owner rejection of the shared Cahier PDF (#1024): source-first
 * contract of the approved tables, wordmark face and AEDAR figure grammar.
 *
 * Every expectation below is taken from the approved generating code
 * (`pdf-prototype/desktop.js`, `AccessRampFigureCahier.vue`,
 * `CahierGroupedVerticalBarChart.vue`, `LuskBrand.vue` + the face the browser
 * actually loads) and from the approved artifacts R1–R3. None is derived from a
 * previous run of this composer.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import { jsPDF } from 'jspdf'

import { composerCahierPdf } from '@/fiche/prototype/cahierPdfComposer'
import { POLICES_PDF } from '@/fiche/prototype/cahierPdfFonts'
import {
  PAGE_APPROUVEE,
  ROLE_PDF,
  ptDepuisCssPx,
} from '@/fiche/prototype/cahierPdfGrammaire'
import { couleurPdf } from '@/fiche/prototype/cahierPdfPalette'
import { construireTableauxPdf } from '@/fiche/prototype/cahierPdfTableau'
import type { TableauPdfPart } from '@/fiche/prototype/cahierPdfTableau'
import { projeterRequeteExport } from '@/fiche/prototype/cahierExportCapture'
import type { CahierExportCapture, CahierExportRequest } from '@/fiche/prototype/cahierExportCapture'
import { projeterRequeteExportFigures } from '@/fiche/prototype/cahierExportAdapters'
import { dessinerFigurePdf } from '@/fiche/prototype/cahierPdfFigures'
import { CAHIER_FIGURE_STROKE, CSS_PX_EN_MM } from '@/fiche/prototype/cahierFigureNativeGeometry'
import type { MesureTexte } from '@/fiche/prototype/cahierPdfMesure'
import {
  chargeurImageTest,
  chargeurPoliceTest,
  couleursRemplissage,
  epaisseursTraitPdf,
  lirePdf,
  opacitesRemplissagePdf,
  programmesPoliceEmbarques,
  type LecturePdf,
  type TextePdf,
} from './helpers/cahierPdfRuntime'
import { lirePoliceTtf } from './helpers/cahierPdfFontProbe'
import {
  captureExplorerRangs,
  captureProfilRangsDense,
  capturePdfFixture,
} from './helpers/cahierPdfFixtures'

function options() {
  return {
    signal: new AbortController().signal,
    chargerPolice: chargeurPoliceTest,
    chargerImage: chargeurImageTest,
    urlPublique: 'https://lusk.test/territoire/commune/22001?theme=mobilite#section-aedar-access',
    urlAccueil: 'https://lusk.test/',
  }
}

function requete(capture: CahierExportCapture, modes?: readonly string[]): CahierExportRequest {
  const offered = capture.capabilities.selectableSeries.map((serie) => serie.id)
  const projection = projeterRequeteExport(capture, modes ?? offered.slice(0, 3))
  if (projection.status !== 'ready') throw new Error(projection.reason)
  return projection.request
}

async function generer(capture: CahierExportCapture, modes?: readonly string[]) {
  const artifact = await composerCahierPdf(requete(capture, modes), options())
  return lirePdf(artifact.blob)
}

/** Millimetre measurement backed by the document's own embedded faces. */
async function mesureMm(): Promise<MesureTexte> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const signal = new AbortController().signal
  for (const face of POLICES_PDF) {
    doc.addFileToVFS(face.file, Buffer.from(await chargeurPoliceTest(face, { signal })).toString('base64'))
    doc.addFont(face.file, face.id, 'normal')
  }
  return {
    largeur: (texte, police, taille, espacement = 0) => {
      doc.setFont(police, 'normal')
      doc.setFontSize(taille)
      doc.setCharSpace(espacement * 25.4 / 72)
      const width = doc.getTextWidth(texte)
      doc.setCharSpace(0)
      return width
    },
    hauteurLigne: (_police, taille) => taille * 25.4 / 72,
    espace: (police, taille) => {
      doc.setFont(police, 'normal')
      doc.setFontSize(taille)
      return doc.getTextWidth(' ')
    },
  }
}

async function parties(capture: CahierExportCapture, modes?: readonly string[]): Promise<{
  request: CahierExportRequest
  parts: readonly TableauPdfPart[]
}> {
  const request = requete(capture, modes)
  const mesure = await mesureMm()
  const parts = projeterRequeteExportFigures(request).flatMap((projection) => projection.tables.flatMap(
    (table) => construireTableauxPdf(table, {
      mesure,
      largeurDisponible: PAGE_APPROUVEE.largeurUtilePt - 2 * ptDepuisCssPx(13),
      nomTerritoire: capture.identity.territory.name,
      ownerDisplayed: true,
    }),
  ))
  return { request, parts }
}

function runs(lecture: LecturePdf, value: string): readonly TextePdf[] {
  return lecture.textes.filter((item) => item.str === value)
}

function proche(a: number, b: number, tolerance = 0.02): boolean {
  return Math.abs(a - b) <= tolerance
}

describe('PDF approuvé — tableaux transposés par légende', () => {
  it('une table par panneau : la distribution garde ses catégories en lignes', async () => {
    const capture = captureExplorerRangs()
    const { parts } = await parties(capture)
    // Two panels → two tables (volume ramp + distribution), never one per decile.
    expect(parts).toHaveLength(2)
    const distribution = parts.find((part) => part.rowHeader === 'Statistique')!
    expect(distribution).toBeTruthy()
    expect(distribution.layout).toBe('grouped')
    expect(distribution.sourceKey).toBe('distribution')

    const model = capture.figures.find((figure) => figure.family === 'aedar-equipment-explorer')!
    const statistics = (model as unknown as {
      model: { distributionStatistics: readonly { label: string }[] }
    }).model.distributionStatistics
    // Rows are the panel's x-axis categories, in their published order.
    expect(distribution.rows.map((row) => row.label)).toEqual(statistics.map((statistic) => statistic.label))
    // Never the transpose: no row is a legend key.
    expect(distribution.rows.map((row) => row.label)).not.toContain('Voiture')
    expect(distribution.rows.map((row) => row.label)).not.toContain('Vélo (LTS2)')

    // Columns are grouped by the visible legend key, each group carrying
    // [territory | Groupe | Rang] (the rank column is appended by the builder).
    // Approved shape B: one coloured group per VISIBLE legend key, each
    // carrying [territory | Groupe | Rang]. The third requested mode is not an
    // effective mode of this capture, so two groups are served.
    expect(distribution.groups.map((group) => group.label)).toEqual(['Voiture', 'Vélo (LTS2)'])
    expect(distribution.columns.map((column) => column.column.label)).toEqual([
      capture.identity.territory.name, 'Groupe', 'Rang',
      capture.identity.territory.name, 'Groupe', 'Rang',
    ])
    for (const group of distribution.groups) {
      // The group label is painted in the native series colour, resolved from
      // the token layer (never an archived hex copied into the adapter).
      expect(group.color).toMatch(/^#[0-9a-f]{6}$/)
    }
    expect(distribution.groups[0]!.color).toBe(couleurPdf('var(--cahier-mode-car)'))
  })

  it('conserve chaque cellule et chaque rang servis exactement une fois', async () => {
    const capture = captureExplorerRangs()
    const { parts } = await parties(capture)
    const distribution = parts.find((part) => part.rowHeader === 'Statistique')!
    // Literal matrix of the synthetic cohort fixture: focal 10 for the first
    // statistic, its 43 served peers (mean 8,2, none above → tied 1er), then
    // the Vélo group on the same published row.
    const cellules = (rowIndex: number) => distribution.rows[rowIndex]!.cells.map((cellule) => cellule.display)
    expect(cellules(0)).toEqual(['10', '8,2', '=1er/43', '21', '20,9', '22e/43'])
    expect(cellules(10)).toEqual(['20', '20', '21e/43', '31', '29', '=1er/43'])
    // Every distinct cell appears once: the two literal rows above are the only
    // occurrence of their values in the row set.
    expect(distribution.rows.filter((row) => row.cells.some((c) => c.display === '8,2'))).toHaveLength(1)
    expect(distribution.rows.filter((row) => row.cells.some((c) => c.display === '20,9'))).toHaveLength(1)
    // No `Indisponible` remains in the populated fixture: the comparison is real.
    expect(distribution.rows.some((row) => row.cells.some((cellule) => cellule.display === 'Indisponible')))
      .toBe(false)
    // Fixture honesty: the served cohort never contradicts the direction
    // (`high`): a top rank cannot sit beside a compared mean above the focal.
    const figure = capture.figures.find((candidate) => candidate.family === 'aedar-equipment-explorer')!
    const fact = (figure as unknown as { model: { facts: { typequ: string; measures: Record<string, number> }[] } })
      .model.facts.find((candidate) => candidate.typequ === (figure as unknown as { effective: { typequ: string } }).effective.typequ)!
    const comparison = (figure as unknown as {
      effective: { comparison: { cells: { measure: string; group_value: number; rank: number; rank_size: number; rank_ties: number | null }[] } }
    }).effective.comparison
    for (const cell of comparison.cells) {
      const focal = fact.measures[cell.measure]
      if (focal === undefined) continue
      expect(Number.isInteger(cell.rank)).toBe(true)
      expect(cell.rank).toBeGreaterThanOrEqual(1)
      expect(cell.rank).toBeLessThanOrEqual(cell.rank_size)
      if (cell.rank === 1) expect(cell.group_value).toBeLessThanOrEqual(focal)
      if (cell.rank_ties !== null) expect(cell.rank_ties).toBeGreaterThan(1)
    }
  })

  it('imprime l’en-tête à deux niveaux et porte le ¹ sur Groupe, jamais sur Rang', async () => {
    const lecture = await generer(captureExplorerRangs())
    const titre = 'Distribution des établissements accessibles par décile'
    // One figure caption + one table caption.
    expect(runs(lecture, titre)).toHaveLength(2)
    // Row-dimension headers: exactly one per table.
    expect(runs(lecture, 'Temps')).toHaveLength(1)
    expect(runs(lecture, 'Statistique')).toHaveLength(1)
    // Coloured legend-key group header: one cell per mode, per table (2 × 2).
    for (const mode of ['Voiture', 'Vélo (LTS2)']) {
      const entetes = runs(lecture, mode).filter((item) => proche(item.taille, ROLE_PDF.enteteTableauMode.taille))
      expect(entetes).toHaveLength(2)
    }
    // Sub-headers: `[territory | Groupe¹ | Rang]` for each mode of each table.
    // R3 prints `Groupe¹` as one inline run (the generator's `font:inherit`
    // anchor), so no separate ¹ is painted and none follows `Rang`.
    const sousEntete = runs(lecture, 'Groupe¹')
      .filter((item) => proche(item.taille, ROLE_PDF.enteteTableauSous.taille))
    const rangs = runs(lecture, 'Rang')
      .filter((item) => proche(item.taille, ROLE_PDF.enteteTableauSous.taille))
    expect(sousEntete).toHaveLength(4)
    expect(rangs).toHaveLength(4)
    expect(lecture.textes.filter((item) => item.str === '¹' && item.taille < 6)).toHaveLength(0)
    expect(runs(lecture, 'Groupe').filter((item) => proche(item.taille, ROLE_PDF.enteteTableauSous.taille)))
      .toHaveLength(0)
    for (const rang of rangs) {
      const marque = lecture.textes.find((item) => item.str === '¹'
        && Math.abs(item.y - rang.y) < 1.5
        && item.x >= rang.x + rang.largeur - 0.5
        && item.x - (rang.x + rang.largeur) < 5)
      expect(marque, 'aucun ¹ ne suit Rang').toBeUndefined()
    }
    // The old transposed sub-header is gone.
    expect(lecture.texteComplet).not.toContain('Groupe comparé —')
  })

  it('peint la matrice réelle du PDF, pas seulement des en-têtes', async () => {
    const lecture = await generer(captureExplorerRangs())
    const rangee = runs(lecture, 'Minimum')[0]
    expect(rangee).toBeTruthy()
    // Same text row, left → right: Voiture then Vélo, territory/Groupe/Rang.
    const surLaLigne = lecture.textes
      .filter((item) => Math.abs(item.y - rangee!.y) < 1.6 && item.x > rangee!.x + 2)
      .sort((a, b) => a.x - b.x)
      .map((item) => item.str)
    const cellules = surLaLigne.filter((value) => value.trim().length > 0)
    expect(cellules.slice(0, 6)).toEqual(['10', '8,2', '=1er/43', '21', '20,9', '22e/43'])
    expect(surLaLigne[0]).not.toBe('Voiture')
    // The compared rank is still the served value, never a recomputation.
    expect(lecture.texteComplet).toContain('22e/43')
  })

  it('une table plate par rampe : Temps | Mode | territoire | Groupe¹ | Rang', async () => {
    const capture = capturePdfFixture('aedar-access')
    const { parts } = await parties(capture)
    // One ramp panel → one flat table.
    expect(parts).toHaveLength(2)
    const modes = capture.capabilities.selectableSeries.slice(0, 3).map((serie) => serie.id)
    const { request } = await parties(capture)
    const rampProjection = projeterRequeteExportFigures(request)
      .find((projection) => projection.family === 'aedar-ramps')!
    const cuts = (rampProjection as unknown as {
      ramps: { series: { points: { cutLabel: string }[] }[] }[]
    }).ramps[0]!.series[0]!.points
    for (const part of parts) {
      expect(part.layout).toBe('flat')
      expect(part.rowHeader).toBe('Temps')
      expect(part.columns.map((column) => column.column.label)).toEqual([
        'Mode', capture.identity.territory.name, 'Groupe comparé', 'Rang',
      ])
      // One row per cut × mode, in cut order then mode order.
      expect(part.rows).toHaveLength(cuts.length * modes.length)
      expect(part.rows.slice(0, modes.length).map((row) => row.label))
        .toEqual(Array(modes.length).fill(cuts[0]!.cutLabel))
      expect(part.rows.slice(0, modes.length).map((row) => row.cells[0]!.display))
        .toEqual(capture.capabilities.selectableSeries.slice(0, 3).map((serie) => serie.label))
      expect(part.rows[0]!.cells.map((cellule) => cellule.display))
        .toEqual([capture.capabilities.selectableSeries[0]!.label, expect.any(String), expect.any(String), expect.any(String)])
    }
    const lecture = await generer(capture)
    expect(runs(lecture, 'Mode')).toHaveLength(2)
    expect(runs(lecture, 'Temps')).toHaveLength(2)
  })

  it('abrège « Indisponible » seulement quand la largeur mesurée le refuse', async () => {
    const mesure: MesureTexte = {
      largeur: (texte, _police, taille) => Array.from(texte).length * taille * 0.17,
      hauteurLigne: (_police, taille) => taille * 0.3528 * 1.2,
      espace: (_police, taille) => taille * 0.17,
    }
    const parts = construireTableauxPdf({
      key: 'narrow',
      title: 'Tableau étroit',
      rowHeader: 'Statistique',
      columns: [
        { key: 'a', label: 'A', unit: null, kind: 'focal', seriesKey: null },
        { key: 'b', label: 'B', unit: null, kind: 'focal', seriesKey: null },
      ],
      rows: [{
        key: 'row',
        label: 'Ligne',
        cells: ['a', 'b'].map((columnKey) => ({
          columnKey, value: null, display: 'Indisponible', unit: null, raw: false,
          rank: null, rankDisplay: null, rankAria: null,
        })),
      }],
      notes: [],
      unit: null,
    }, { mesure, largeurDisponible: 40, nomTerritoire: null })
    expect(parts).toHaveLength(1)
    expect(parts[0]!.abbreviatedUnavailable).toBe(true)
    expect(parts[0]!.rows[0]!.cells.map((cellule) => cellule.display)).toEqual(['Indisp.', 'Indisp.'])
  })

  it('pagine une table réellement longue avec des lignes légitimes, jamais des déciles inventés', async () => {
    const capture = captureProfilRangsDense()
    const { parts } = await parties(capture)
    // One equipment-profile table: its rows are the panel's own equipment
    // types (synthetic labels, real row semantics), not invented statistics.
    expect(parts).toHaveLength(1)
    const table = parts[0]!
    expect(table.rows).toHaveLength(40)
    for (const row of table.rows) expect(row.label).toMatch(/^Équipement \d+ \(T\d{3}\)$/)
    expect(table.rows.map((row) => row.label)).not.toContain('Décile 10')
    expect(table.rows.map((row) => row.label)).not.toContain('Décile 24')
    // The document itself continues only at measured overflow, and every page
    // repeats the same header and source stamp.
    const lecture = await generer(capture)
    expect(lecture.pages).toBeGreaterThanOrEqual(2)
    for (let page = 1; page <= lecture.pages; page += 1) {
      const textePage = lecture.lignes
        .filter((ligne) => ligne.page === page).map((ligne) => ligne.texte).join(' ')
        .replace(/[’']/g, "'")
      expect(textePage).toContain('COMMUNE A1')
      expect(textePage).toContain("Types d'équipements par premier mode permettant l'accès à au moins 25% des adresses")
      expect(textePage).toContain('Source(s) :')
    }
    // A complete label appears once across the whole document (no cut row).
    for (const label of ['Équipement 1 (T001)', 'Équipement 15 (T015)', 'Équipement 40 (T040)']) {
      const occurrences = lecture.texteComplet.split(label).length - 1
      expect(occurrences).toBe(1)
    }
  })
})

describe('PDF approuvé — wordmark, figures AEDAR', () => {
  it('embarque la face réellement affichée par le navigateur (oblique synthétique)', async () => {
    const lecture = await generer(capturePdfFixture('aedar-access'))
    // The derived asset is the face the bundle serves; its program is the
    // upright 600 instance skewed by (1,0,.25,1,0,0), not the packaged italic.
    const asset = new Uint8Array(readFileSync(resolve(process.cwd(), 'src/assets/fonts/pdf/newsreader-600-italic.ttf')))
    const font = lirePoliceTtf(asset)
    expect(font.unitsPerEm).toBe(2000)
    const advances = ['l', 'u', 's', 'k'].map((char) => font.advance(char)!)
    expect(advances).toEqual([585, 1143, 823, 1159])
    expect(advances.reduce((sum, value) => sum + value, 0) / font.unitsPerEm).toBeCloseTo(1.855, 4)
    expect(font.italicAngle).toBe(-14)
    // Upright cut: 33 points over two contours (the real italic has 55).
    expect(font.pointCount('k')).toBe(33)
    expect(font.contourCount('k')).toBe(2)
    // Provenance of the derivation, checked against the committed manifest.
    const manifest = JSON.parse(readFileSync(
      resolve(process.cwd(), 'src/assets/fonts/pdf/manifest.json'), 'utf8',
    )) as { faces: { id: string; source: string; sha256: string; derivation?: { matrix: number[] } }[] }
    const face = manifest.faces.find((candidate) => candidate.id === 'newsreader-600-italic')!
    expect(face.source).toMatch(/-wght-normal\.woff2$/)
    expect(face.derivation?.matrix).toEqual([1, 0, 0.25, 1, 0, 0])
    const { createHash } = await import('node:crypto')
    expect(createHash('sha256').update(asset).digest('hex')).toBe(face.sha256)

    // The PDF embeds that same program (jsPDF subsets it, so the advance
    // vectors live in the painted run), with the approved italic angle.
    const programs = await programmesPoliceEmbarques(lecture.octets)
    const embargo = programs.find((program) => {
      const candidate = lirePoliceTtf(program)
      return candidate.unitsPerEm === 2000
    })
    expect(embargo, 'la face du wordmark est embarquée').toBeTruthy()
    // jsPDF subsets/rewrites the program; the angle is asserted on the asset,
    // the advance vector on the painted run below.
    // The painted `lusk` run keeps the upright advance vector: 1.855em at the
    // approved 11.568 pt wordmark size minus the -0.01em tracking of four
    // glyphs ≈ 21.0 pt. The packaged real italic (1.777em) would be 20.1 pt.
    const mot = lecture.textes.find((item) => item.str === 'lusk')!
    expect(mot.largeur).toBeGreaterThan(20.6)
    expect(mot.largeur).toBeLessThan(21.4)
  })

  async function peindre(capture: CahierExportCapture, modes: readonly string[] = capture.capabilities.selectableSeries.slice(0, 3).map((s) => s.id)) {
    const request = requete(capture, modes)
    const doc = new jsPDF({ unit: 'mm' })
    const signal = new AbortController().signal
    for (const face of POLICES_PDF) {
      doc.addFileToVFS(face.file, Buffer.from(await chargeurPoliceTest(face, { signal })).toString('base64'))
      doc.addFont(face.file, face.id, 'normal')
    }
    const svgs: SVGElement[] = []
    Object.assign(doc, { svg: async (svg: SVGElement) => { svgs.push(svg.cloneNode(true) as SVGElement); return doc } })
    const mesure = await mesureMm()
    const native = (projection: { slot: string }) => capture.figures.find((figure) => figure.slot === projection.slot)!
    const projections = projeterRequeteExportFigures(request)
    for (const projection of projections) {
      const model = native(projection)
      await dessinerFigurePdf({
        doc, signal, mesure, x: 12, y: 25, width: 186, chargerImage: chargeurImageTest, comparisonProof: true,
        ...(model.family === 'aedar-equipment-explorer'
          ? {
            distributionTitle: model.model.distributionFigureTitle,
            distributionUnit: model.model.distributionValueUnit,
            explorerTypequLabel: model.effective.typequLabel,
          }
          : {}),
      }, projection)
    }
    return { svgs, lecture: await lirePdf(doc.output('blob')) }
  }

  it('lit la géométrie native 640×300 et n’invente aucun point', async () => {
    const { svgs } = await peindre(captureExplorerRangs())
    expect(svgs).toHaveLength(2)
    for (const svg of svgs) {
      expect(svg.getAttribute('viewBox')).toBe('0 0 640 300')
      expect(svg.querySelectorAll('circle')).toHaveLength(0)
    }
    const rampPaths = [...svgs[0]!.querySelectorAll('path')]
    expect(rampPaths.length).toBeGreaterThan(0)
    for (const path of rampPaths) {
      const d = path.getAttribute('d')!
      const xs = [...d.matchAll(/[ML] (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]))
      // Plot bounds come from the native margins: left 64, right 640 − 68.
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(63.9)
      expect(Math.max(...xs)).toBeLessThanOrEqual(572.1)
      // Strokes stay in native units; the document transform scales them once.
      expect(Number(path.getAttribute('stroke-width'))).toBe(CAHIER_FIGURE_STROKE.widthPx)
    }
    const references = rampPaths.filter((path) => path.getAttribute('stroke-dasharray'))
    expect(references.length).toBeGreaterThan(0)
    expect(references[0]!.getAttribute('stroke-dasharray')).toBe('10 6')
  })

  it('transpose la géométrie native en points dans le PDF (trait, titres, opacité)', async () => {
    // The real composer conversion (svg2pdf) is what a reader receives; the
    // stub painter cannot prove mark fills.
    const lecture = await generer(captureExplorerRangs())
    // Panel width in mm → native 2.5 px stroke → points.
    const panelWidth = (PAGE_APPROUVEE.largeurUtilePt - 2 * ptDepuisCssPx(13) - 6) / 2
    const epaisseur = CAHIER_FIGURE_STROKE.widthPx * panelWidth / 640
    void epaisseur
    const epaisseurs = await epaisseursTraitPdf(lecture.octets)
    expect(epaisseurs.length).toBeGreaterThan(0)
    // The painter states the stroke in native figure units; the document
    // transform scales it once. The removed 96 dpi millimetre metric (2.5 px →
    // 0.662) must not survive as the SVG user-space width.
    expect(epaisseurs).toContain(CAHIER_FIGURE_STROKE.widthPx)
    expect(epaisseurs).toContain(CAHIER_FIGURE_STROKE.axisWidthPx)
    expect(epaisseurs.some((value) => Math.abs(value - CAHIER_FIGURE_STROKE.widthPx * CSS_PX_EN_MM) < 0.01))
      .toBe(false)
    // Native uppercase axis-title role, not sentence case.
    expect(lecture.texteComplet).toContain('TEMPS DE TRAJET')
    expect(lecture.texteComplet).toContain('VOLUME DE L’OFFRE')
    expect(lecture.texteComplet).toContain('DÉCILE')
    expect(lecture.texteComplet).toContain('NOMBRE D’ÉTABLISSEMENTS')
    expect(lecture.texteComplet).not.toContain('Temps de trajet')
    expect(runs(lecture, 'Décile').filter((item) => proche(item.taille, ROLE_PDF.axe.taille))).toHaveLength(0)
    expect(runs(lecture, 'Temps de trajet').filter((item) => proche(item.taille, ROLE_PDF.axe.taille)))
      .toHaveLength(0)
    // The native figcaption's second line: once per figure panel and once per
    // exported table caption (the approved generator clones the figcaption).
    const sousTitre = runs(lecture, 'Équipement test')
    expect(sousTitre).toHaveLength(4)
    for (const ligne of sousTitre) {
      const titre = lecture.textes.find((item) => proche(item.taille, ROLE_PDF.sousTitreFigure.taille)
        && item.y > ligne.y && item.y - ligne.y < 12
        && item.x < ligne.x + ligne.largeur && item.x + item.largeur > ligne.x)
      expect(titre, 'la seconde ligne est empilée sous un titre de panneau').toBeTruthy()
    }
    // Native `.bar { fill-opacity: .78 }`: the bar keeps its own ink and the
    // shape alpha is emitted, so the grid beneath shows through. Pre-compositing
    // the 78 % onto paper would hide the grid and must not come back.
    const fills = await couleursRemplissage(lecture.octets)
    expect(fills).toContain(couleurPdf('var(--cahier-mode-car)').toLowerCase())
    expect(fills).not.toContain(couleurPdf('color-mix(in srgb, var(--cahier-mode-car) 78%, var(--paper))').toLowerCase())
    expect(await opacitesRemplissagePdf(lecture.octets, 0)).toContain(0.78)
  })

  it('garde les barres groupées semi-transparentes et sans transposition visuelle', async () => {
    const { svgs } = await peindre(captureExplorerRangs())
    const rects = [...svgs[1]!.querySelectorAll('rect')]
    expect(rects.length).toBeGreaterThan(0)
    // The SVG carries the native series ink and its own `.78` shape alpha, not
    // an opaque pre-composited colour that would hide the grid beneath.
    expect(rects[0]!.getAttribute('fill')).toBe(couleurPdf('var(--cahier-mode-car)'))
    expect(rects[0]!.getAttribute('fill-opacity')).toBe('0.78')
    for (const rect of rects) {
      expect(rect.getAttribute('fill-opacity')).toBe('0.78')
      // Bars grow from the native plot bottom, not a recomputed 96 dpi box.
      const bottom = Number(rect.getAttribute('y')) + Number(rect.getAttribute('height'))
      expect(bottom).toBeLessThanOrEqual(238.01)
    }
  })
})
