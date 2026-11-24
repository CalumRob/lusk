/**
 * #1024 — production adapter/table-builder contracts that do not require a
 * rendered browser: approved colgroups and explicitly declared table shape.
 */
import { describe, expect, it } from 'vitest'

import { LARGEUR_CORPS_PT } from '@/fiche/prototype/cahierPdfGrammaire'
import { construireTableauxPdf } from '@/fiche/prototype/cahierPdfTableau'
import { projeterRequeteExport } from '@/fiche/prototype/cahierExportCapture'
import type { CahierExportCapture } from '@/fiche/prototype/cahierExportCapture'
import { projeterRequeteExportFigures } from '@/fiche/prototype/cahierExportAdapters'
import { mesurePdfTest } from './helpers/cahierPdfRuntime'
import { capturePdfFixture, captureWaffleDense } from './helpers/cahierPdfFixtures'

async function parties(capture: CahierExportCapture) {
  const offered = capture.capabilities.selectableSeries.map((serie) => serie.id)
  const projection = projeterRequeteExport(capture, offered.slice(0, 3))
  if (projection.status !== 'ready') throw new Error(projection.reason)
  const request = projection.request
  const mesure = await mesurePdfTest()
  const parts = projeterRequeteExportFigures(request).flatMap((item) => item.tables.flatMap(
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
})
