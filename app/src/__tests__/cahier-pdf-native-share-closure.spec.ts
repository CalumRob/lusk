/**
 * #1024 — the bounded share-figure and table-builder contracts that remain
 * meaningful without rendered layout: native row grammar and flat-table shape.
 */
import { describe, expect, it } from 'vitest'

import { CAHIER_FIGURE_ROW } from '@/fiche/prototype/cahierFigureNativeGeometry'
import { construireTableauxPdf } from '@/fiche/prototype/cahierPdfTableau'
import { projeterRequeteExport } from '@/fiche/prototype/cahierExportCapture'
import { projeterRequeteExportFigures, projectShare } from '@/fiche/prototype/cahierExportAdapters'
import { mesurePdfTest } from './helpers/cahierPdfRuntime'
import { captureBarresStationnement, capturePartDense } from './helpers/cahierPdfFixtures'

describe('#1024 — rang de la colonne « Près d’un arrêt » (table, pas de pastille de figure)', () => {
  it('peint le rang servi de la comparaison dans la colonne Rang du tableau', () => {
    const capture = capturePartDense()
    const figure = capture.figures.find((candidate) => candidate.family === 'mobilite-share')!
    if (figure.family !== 'mobilite-share') throw new Error('famille inattendue')
    const servi = figure.model.value.fact.comparison
    if (!servi) throw new Error('comparaison servie absente')
    expect(servi.rank).toEqual({ position: 1, size: 38, ties: null })
    expect(servi.scope).toEqual({ kind: 'communes-epci', label: 'communes de EPCI X' })

    const offered = capture.capabilities.selectableSeries.map((serie) => serie.id)
    const projection = projeterRequeteExport(capture, offered.slice(0, 3))
    if (projection.status !== 'ready') throw new Error(projection.reason)
    const share = projectShare(projection.request.capture, figure)
    expect(share.comparisonRank).toEqual(servi.rank)
    expect(share.comparisonRankDisplay).toBe('1er/38')

    const table = share.tables[0]!
    const rang = table.columns.findIndex((column) => column.kind === 'comparison')
    expect(rang).toBeGreaterThanOrEqual(0)
    expect(table.rows[0]!.cells[rang]!.rankDisplay).toBe('1er/38')
  })

  it('n’invente aucun rang quand la comparaison n’en sert pas', () => {
    const capture: any = structuredClone(capturePartDense())
    const figure = capture.figures.find((candidate: any) => candidate.family === 'mobilite-share')
    figure.model.value.fact.comparison.rank = { position: 1, size: 1, ties: null }
    const share = projectShare(capture, figure)
    expect(share.comparisonRank).toBeNull()
    expect(share.comparisonRankDisplay).toBeNull()
    const table = share.tables[0]!
    const rang = table.columns.findIndex((column) => column.kind === 'comparison')
    expect(rang).toBeGreaterThanOrEqual(0)
    expect(table.rows[0]!.cells[rang]!.rankDisplay).toBeNull()
    expect(JSON.stringify(share)).not.toContain('1er/1')
  })
})

describe('#1024 — rangée appairée : la source, pas un littéral transplanté', () => {
  it('déclare la grammaire native de la rangée et son viewport de lecture', () => {
    const capture = captureBarresStationnement()
    const offered = capture.capabilities.selectableSeries.map((serie) => serie.id)
    const projection = projeterRequeteExport(capture, offered.slice(0, 3))
    if (projection.status !== 'ready') throw new Error(projection.reason)
    const bars = projeterRequeteExportFigures(projection.request)
      .filter((figure) => figure.family === 'mobilite-bars')
    expect(bars).toHaveLength(2)
    for (const figure of bars) {
      const row = figure.row as unknown as { key: string; columns: number; viewportPx: number } | null
      expect(row).not.toBeNull()
      expect(row!.key).toBe('mobilite-paired')
      expect(row!.columns).toBe(CAHIER_FIGURE_ROW.columns)
      expect(row!.viewportPx).toBe(CAHIER_FIGURE_ROW.desktopViewportPx)
      expect(row).not.toHaveProperty('gapPx')
    }
  })
})

describe('#1024 — formes et états déclarés, jamais devinés', () => {
  it('n’ajoute aucune bande de groupe à un tableau déclaré plat', async () => {
    const mesure = await mesurePdfTest()
    const parts = construireTableauxPdf({
      key: 'flat-with-group-label',
      title: 'Tableau plat',
      rowHeader: null,
      layout: 'flat',
      columnSeparators: 'none',
      columns: [
        { key: 'a', label: 'A', unit: null, kind: 'focal', seriesKey: null, groupLabel: 'Groupe' },
        { key: 'b', label: 'B', unit: null, kind: 'focal', seriesKey: null, groupLabel: 'Groupe' },
      ],
      rows: [{ key: 'r', label: 'Ligne', cells: [
        { columnKey: 'a', value: 1, display: '1', unit: null, raw: false, rank: null, rankDisplay: null, rankAria: null },
        { columnKey: 'b', value: 2, display: '2', unit: null, raw: false, rank: null, rankDisplay: null, rankAria: null },
      ] }],
      notes: [],
      unit: null,
    }, { mesure, largeurDisponible: 120, nomTerritoire: null })
    expect(parts[0]!.layout).toBe('flat')
    expect(parts[0]!.groupHeaderHeight).toBe(0)
    expect(parts[0]!.groups).toHaveLength(0)
  })
})
