/**
 * #1024 — the bounded corrections the parent review actually confirmed.
 *
 * Scope note (user correction, authoritative): the share FIGURE does **not**
 * get a rank badge. The user asked for the existing table `Rang` cell to be
 * populated from the producer-served comparison rank; the figure keeps the
 * screen's own scope and is not an acceptance surface for a badge. What is
 * checked here is therefore the table rank chain (retained, never recomputed)
 * and the share track's real state grammar, not a badge.
 *
 * The other checks calibrate on owners, not on a previous output of this
 * composer: the source clause `clamp(24px, 4vw, 56px)` at the approved desktop
 * viewport, the native measured y rail, and the capture's own comparison
 * identity.
 */
import { describe, expect, it } from 'vitest'

import { composerCahierPdf } from '@/fiche/prototype/cahierPdfComposer'
import {
  CAHIER_FIGURE_ROW,
  figureRowLayout,
} from '@/fiche/prototype/cahierFigureNativeGeometry'
import {
  ECHELLE_LECTURE_CSS_PX,
  LARGEUR_CORPS_PT,
  PAGE_APPROUVEE,
  PADDING_SECTION_PT,
  ROLE_PDF,
  ptDepuisCssPx,
} from '@/fiche/prototype/cahierPdfGrammaire'
import { construireTableauxPdf } from '@/fiche/prototype/cahierPdfTableau'
import { projeterRequeteExport } from '@/fiche/prototype/cahierExportCapture'
import type { CahierCaptureFigure, CahierExportCapture } from '@/fiche/prototype/cahierExportCapture'
import {
  projeterRequeteExportFigures,
  projectShare,
} from '@/fiche/prototype/cahierExportAdapters'
import {
  chargeurImageTest,
  chargeurPoliceTest,
  lirePdf,
  mesurePdfTest,
  type LecturePdf,
} from './helpers/cahierPdfRuntime'
import {
  captureBarresStationnement,
  capturePartDense,
} from './helpers/cahierPdfFixtures'

const CORPS_X_PT = PAGE_APPROUVEE.insetGauchePt + PADDING_SECTION_PT

/** The document content box expressed back in screen CSS pixels. */
const CONTENU_CSS_PX = LARGEUR_CORPS_PT / ECHELLE_LECTURE_CSS_PX

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

/** The two share tracks of one page: full-width 5 mm rows. */
describe('#1024 — rang de la colonne « Près d’un arrêt » (table, pas de pastille de figure)', () => {
  it('peint le rang servi de la comparaison dans la colonne Rang du tableau', async () => {
    const capture = capturePartDense()
    const figure = capture.figures.find((candidate) => candidate.family === 'mobilite-share')!
    // The chain starts at the captured served fact, never at a recomputation.
    const servi = (figure.model as unknown as {
      value: { fact: { comparison: { rank: unknown; scope: { kind: string; label: string } } } }
    }).value.fact.comparison
    expect(servi.rank).toEqual({ position: 1, size: 38, ties: null })
    expect(servi.scope).toEqual({ kind: 'communes-epci', label: 'communes de EPCI X' })

    const offered = capture.capabilities.selectableSeries.map((serie) => serie.id)
    const projection = projeterRequeteExport(capture, offered.slice(0, 3))
    if (projection.status !== 'ready') throw new Error(projection.reason)
    const share = projectShare(
      projection.request.capture,
      figure as Extract<CahierCaptureFigure, { family: 'mobilite-share' }>,
    )
    expect(share.comparisonRank).toEqual(servi.rank)
    expect(share.comparisonRankDisplay).toBe('1er/38')

    const table = share.tables[0]!
    const rang = table.columns.findIndex((column) => column.kind === 'comparison')
    expect(rang).toBeGreaterThanOrEqual(0)
    expect(table.rows[0]!.cells[1]!.rankDisplay).toBe('1er/38')

    const lecture = await generer(capture)
    const entete = lecture.textes.find((item) => item.str === 'Rang'
      && Math.abs(item.taille - ROLE_PDF.enteteTableauMode.taille) < 0.02)!
    const cellule = lecture.textes.find((item) => item.str === '1er/38'
      && Math.abs(item.taille - ROLE_PDF.valeurTableau.taille) < 0.02)!
    expect(entete, 'l’en-tête Rang est peint').toBeTruthy()
    expect(cellule, 'la cellule Rang est peinte').toBeTruthy()
    // The value sits under its own header column, not in the compared value column.
    expect(cellule.x).toBeGreaterThan(entete.x - 1)
    expect(cellule.x).toBeLessThan(entete.x + 30)
  })

  it('n’invente aucun rang quand la comparaison n’en sert pas', async () => {
    const capture: any = structuredClone(capturePartDense())
    const figure = capture.figures.find((candidate: any) => candidate.family === 'mobilite-share')
    figure.model.value.fact.comparison.rank = { position: 1, size: 1, ties: null }
    const lecture = await generer(capture)
    // A served 1/1 has no position to show: the shared display rule folds it.
    expect(lecture.textes.some((item) => item.str === '1er/1')).toBe(false)
    const rang = lecture.textes.find((item) => item.str === 'Rang'
      && Math.abs(item.taille - ROLE_PDF.enteteTableauMode.taille) < 0.02)!
    // The value row keeps the served absence, printed under its own header.
    const cellules = lecture.textes.filter((item) => item.str === '—'
      && item.x > rang.x - 1
      && item.x < rang.x + 30)
    expect(cellules).toHaveLength(1)
  })
})

describe('#1024 — rangée appairée : la source, pas un littéral transplanté', () => {
  it('aligne le périmètre comparé des barres stationnement sur le groupe de la capture', async () => {
    const capture = captureBarresStationnement()
    const groupe = capture.comparison.group!
    expect(groupe.scopeKind).toBe('communes-epci')
    expect(groupe.label).toBe('communes de EPCI X')
    const bars: any[] = capture.figures.filter((figure) => figure.family === 'mobilite-bars')
    expect(bars).toHaveLength(2)
    for (const figure of bars) {
      for (const category of figure.model.figure.categories) {
        const comparaison = category.value.fact.comparison
        expect(comparaison.scope).toEqual({ kind: groupe.scopeKind, label: groupe.label })
        // A served ordinal from that same declared pair, never null-by-policy.
        expect(comparaison.rank).toEqual({ position: 1, size: 2, ties: null })
      }
    }
    const lecture = await generer(capture)
    expect(lecture.texteComplet).toContain('¹ Groupe comparé : Médiane des communes de EPCI X')
    expect(lecture.texteComplet).not.toContain('communes bretonnes')
    // The table paints the same served ordinal as the fixture declares.
    expect(lecture.textes.filter((item) => item.str === '1er/2')).toHaveLength(bars.length * 2)
  })

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

  it('convertit l’écart de la source avec l’échelle de page de la figure', async () => {
    const lecture = await generer(captureBarresStationnement())
    const titres = [
      lecture.textes.find((item) => item.str === 'Stationnement vélo et voiture')!,
      lecture.textes.find((item) => item.str === 'Bornes de recharge et station-services')!,
    ]
    const centre = (item: (typeof titres)[number]) => item.x + item.largeur / 2
    const ecartPx = figureRowLayout().gapPx
    const figurePx = (CONTENU_CSS_PX - ecartPx) / CAHIER_FIGURE_ROW.columns
    const pasPt = (figurePx + ecartPx) * ptDepuisCssPx(1)
    expect(centre(titres[1]!) - centre(titres[0]!)).toBeCloseTo(pasPt, 1)
    // Two native 640×300 panels side by side: the pair fills the content box.
    const colonnePt = figurePx * ptDepuisCssPx(1)
    expect(centre(titres[0]!) - colonnePt / 2).toBeCloseTo(CORPS_X_PT, 1)
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
