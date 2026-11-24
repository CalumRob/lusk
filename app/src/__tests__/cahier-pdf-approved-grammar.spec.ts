/**
 * Source-first contract of the approved Cahier PDF tables (#1024), calibrated
 * on the approved generating code and artifacts rather than browser output.
 */
import { describe, expect, it } from 'vitest'
import { jsPDF } from 'jspdf'

import { POLICES_PDF } from '@/fiche/prototype/cahierPdfFonts'
import { PAGE_APPROUVEE, ptDepuisCssPx } from '@/fiche/prototype/cahierPdfGrammaire'
import { couleurPdf } from '@/fiche/prototype/cahierPdfPalette'
import { construireTableauxPdf } from '@/fiche/prototype/cahierPdfTableau'
import type { TableauPdfPart } from '@/fiche/prototype/cahierPdfTableau'
import { projeterRequeteExport } from '@/fiche/prototype/cahierExportCapture'
import type { CahierExportCapture, CahierExportRequest } from '@/fiche/prototype/cahierExportCapture'
import { projeterRequeteExportFigures } from '@/fiche/prototype/cahierExportAdapters'
import type { MesureTexte } from '@/fiche/prototype/cahierPdfMesure'
import { chargeurPoliceTest } from './helpers/cahierPdfRuntime'
import { captureExplorerRangs } from './helpers/cahierPdfFixtures'

function requete(capture: CahierExportCapture, modes?: readonly string[]): CahierExportRequest {
  const offered = capture.capabilities.selectableSeries.map((serie) => serie.id)
  const projection = projeterRequeteExport(capture, modes ?? offered.slice(0, 3))
  if (projection.status !== 'ready') throw new Error(projection.reason)
  return projection.request
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

    // Approved shape B: one coloured group per visible legend key, each
    // carrying [territory | Groupe | Rang].
    expect(distribution.groups.map((group) => group.label)).toEqual(['Voiture', 'Vélo (LTS2)'])
    expect(distribution.columns.map((column) => column.column.label)).toEqual([
      capture.identity.territory.name, 'Groupe', 'Rang',
      capture.identity.territory.name, 'Groupe', 'Rang',
    ])
    for (const group of distribution.groups) {
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
    expect(distribution.rows.filter((row) => row.cells.some((c) => c.display === '8,2'))).toHaveLength(1)
    expect(distribution.rows.filter((row) => row.cells.some((c) => c.display === '20,9'))).toHaveLength(1)
    expect(distribution.rows.some((row) => row.cells.some((cellule) => cellule.display === 'Indisponible')))
      .toBe(false)
    // Fixture honesty: the served cohort never contradicts the direction.
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
})
