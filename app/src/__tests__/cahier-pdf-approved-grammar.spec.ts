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

import { describe, expect, it } from 'vitest'
import { aedarWaffleTitre } from '@/fiche/content/aedarAccessSection'
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
import type { MesureTexte } from '@/fiche/prototype/cahierPdfMesure'
import {
  chargeurImageTest,
  chargeurPoliceTest,
  lirePdf,
  type LecturePdf,
  type TextePdf,
} from './helpers/cahierPdfRuntime'
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

  // RETIRED (#1024 native switch): Pins the deleted painter's raster roles and stroke metrics; those roles now come from the mounted native section.
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
        .toEqual([capture.capabilities.selectableSeries[0]!.label, '5', 'Indisponible', '—'])
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
      layout: 'flat',
      columnSeparators: 'none',
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

  // RETIRED (#1024 native switch): Pins the deleted painter's raster roles and stroke metrics; those roles now come from the mounted native section.
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
      expect(textePage).toContain(aedarWaffleTitre().replace(/[’']/g, "'"))
      expect(textePage).toContain('Source(s) :')
    }
    // A complete label appears once across the whole document (no cut row).
    for (const label of ['Équipement 1 (T001)', 'Équipement 15 (T015)', 'Équipement 40 (T040)']) {
      const occurrences = lecture.texteComplet.split(label).length - 1
      expect(occurrences).toBe(1)
    }
  })
})
