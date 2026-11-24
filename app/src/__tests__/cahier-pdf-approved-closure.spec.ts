/**
 * #1024 closure checks for the production table builder, calibrated on the
 * approved generating source and R1–R3. No rendered-browser harness is needed.
 */
import { describe, expect, it } from 'vitest'

import { PAIRE_TABLEAUX_PT } from '@/fiche/prototype/cahierPdfComposer'
import {
  LARGEUR_CORPS_PT,
  ROLE_PDF,
} from '@/fiche/prototype/cahierPdfGrammaire'
import { construireTableauxPdf, CahierPdfTableLayoutError } from '@/fiche/prototype/cahierPdfTableau'
import { projeterRequeteExport } from '@/fiche/prototype/cahierExportCapture'
import { projeterRequeteExportFigures } from '@/fiche/prototype/cahierExportAdapters'
import { mesurePdfTest } from './helpers/cahierPdfRuntime'
import { capturePdfFixture } from './helpers/cahierPdfFixtures'

const ptMm = (pt: number) => pt * 25.4 / 72
const CORPS_PT = LARGEUR_CORPS_PT
const PAIRE_PT = PAIRE_TABLEAUX_PT.largeur

describe('clôture #1024 — sous-titre, tables appairées, rail mesuré, notes', () => {
  it('choisit une continuation mesurée plutôt que de réduire un nombre dans une demi-colonne', async () => {
    const mesure = await mesurePdfTest()
    const capture = capturePdfFixture('aedar-access')
    const projection = projeterRequeteExport(capture, capture.capabilities.selectableSeries
      .slice(0, 3).map((serie) => serie.id))
    if (projection.status !== 'ready') throw new Error(projection.reason)
    const table = projeterTables(projection.request)[0]!
    // A number wider than the measured half column is a layout error, not a
    // licence to shrink/truncate the served value.
    const large: any = structuredClone(table)
    const valeur = '123456789012'
    large.rows = large.rows.map((row: any) => ({
      ...row,
      cells: row.cells.map((cell: any, index: number) => index === 2
        ? { ...cell, display: valeur, value: Number(valeur) }
        : cell),
    }))
    expect(() => construireTableauxPdf(large, {
      mesure,
      largeurDisponible: ptMm(PAIRE_PT),
      nomTerritoire: capture.identity.territory.name,
      ownerDisplayed: true,
    })).toThrow(CahierPdfTableLayoutError)
    // The same table keeps its complete numbers at the full content width.
    expect(construireTableauxPdf(large, {
      mesure,
      largeurDisponible: ptMm(CORPS_PT),
      nomTerritoire: capture.identity.territory.name,
      ownerDisplayed: true,
    })[0]!.rows[0]!.cells.some((cell) => cell.display === valeur)).toBe(true)
  })

  it('mesure les en-têtes de groupe longs et augmente la hauteur, sans débordement', async () => {
    const mesure = await mesurePdfTest()
    const parts = construireTableauxPdf({
      key: 'large-group',
      title: 'Tableau groupé',
      rowHeader: 'Statistique',
      layout: 'grouped',
      columnSeparators: 'group',
      columns: [
        { key: 'a', label: 'Territoire', unit: null, kind: 'focal', seriesKey: 'a', groupLabel: 'Transports en commun, marche et vélo LTS2 sur voirie compartimentée', groupColor: '#a94562' },
        { key: 'b', label: 'Groupe comparé', unit: null, kind: 'comparison', seriesKey: 'a', groupLabel: 'Transports en commun, marche et vélo LTS2 sur voirie compartimentée', groupColor: '#a94562' },
      ],
      rows: [{
        key: 'row',
        label: 'Minimum',
        cells: [
          { columnKey: 'a', value: 1, display: '1', unit: null, raw: false, rank: null, rankDisplay: null, rankAria: null },
          { columnKey: 'b', value: 2, display: '2', unit: null, raw: false, rank: null, rankDisplay: '1er/2', rankAria: null },
        ],
      }],
      notes: [],
      unit: null,
    }, { mesure, largeurDisponible: 180, nomTerritoire: null })
    const part = parts[0]!
    const groupe = part.groups[0]!
    expect(groupe.labelLines.length).toBeGreaterThan(1)
    expect(part.groupHeaderHeight).toBeGreaterThan(
      (groupe.labelLines.length) * ROLE_PDF.enteteTableauMode.taille * 0.3528,
    )
    for (const ligne of groupe.labelLines) {
      expect(mesure.largeur(ligne, ROLE_PDF.enteteTableauMode.police, ROLE_PDF.enteteTableauMode.taille))
        .toBeLessThanOrEqual(groupe.width - 2 + 0.01)
    }
  })
})

function projeterTables(request: Parameters<typeof projeterRequeteExportFigures>[0]) {
  return projeterRequeteExportFigures(request).flatMap((projection) => projection.tables)
}
