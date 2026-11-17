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

import { composerCahierPdf, mesurePdfProduction, optionsFigurePdf } from '@/fiche/prototype/cahierPdfComposer'
import { dessinerFigurePdf, hauteurFigurePdf } from '@/fiche/prototype/cahierPdfFigures'
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
  cheminsPdf,
  lirePdf,
  mesurePdfTest,
  verifierCollisions,
  type LecturePdf,
} from './helpers/cahierPdfRuntime'
import {
  captureBarresStationnement,
  capturePartDense,
  capturePdfFixture,
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
function pistesPart(lecture: LecturePdf) {
  return cheminsPdf(lecture.octets, lecture.pages).then((chemins) => chemins.filter((chemin) => (
    chemin.kind === 'stroke'
    && chemin.height > 13.5
    && chemin.height < 15
    && chemin.width > 200
  )))
}

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

describe('#1024 — grammaire d’état de la piste de partage', () => {
  it('peint les deux pistes servies avec un filet plein de 1 px', async () => {
    const lecture = await generer(capturePartDense())
    const pistes = await pistesPart(lecture)
    expect(pistes).toHaveLength(2)
    for (const piste of pistes) {
      expect(piste.tirets, 'une piste servie n’est pas en pointillés').toBeFalsy()
      expect(piste.largeur).toBeCloseTo(ptDepuisCssPx(1), 2)
    }
    // The same border ink on both served rows (one state, one colour).
    expect(pistes[0]!.colour).toBe(pistes[1]!.colour)
  })

  it('garde le pointillé pour la seule piste vide', async () => {
    const capture: any = structuredClone(capturePartDense())
    const figure = capture.figures.find((candidate: any) => candidate.family === 'mobilite-share')
    // A served rank without a reference value: the native track stays empty,
    // and the state reads « Indisponible » inside the dashed frame.
    figure.model.value.fact.comparison.reference = null
    const lecture = await generer(capture)
    const pistes = await pistesPart(lecture)
    const pleine = pistes.filter((piste) => !piste.tirets)
    const vide = pistes.filter((piste) => piste.tirets)
    expect(pleine, 'la piste du territoire reste pleine').toHaveLength(1)
    expect(vide, 'la seule piste vide est en pointillés').toHaveLength(1)
    expect(vide[0]!.largeur).toBeCloseTo(ptDepuisCssPx(1), 2)
    expect(vide[0]!.colour).not.toBe(pleine[0]!.colour)
    const indisponible = lecture.textes.filter((item) => item.str === 'Indisponible')
    expect(indisponible.length).toBeGreaterThan(0)
    // `cheminsPdf` exposes a top-origin y; PDF text origins are bottom-origin.
    const centrePiste = PAGE_APPROUVEE.hauteurPt - (vide[0]!.y + vide[0]!.height / 2)
    const dansPiste = indisponible.find((item) => (
      item.x > vide[0]!.x + 1
      && item.x < vide[0]!.x + vide[0]!.width - 1
      && Math.abs(item.y - centrePiste) < vide[0]!.height
    ))
    expect(dansPiste, 'l’état vide est peint dans sa piste').toBeTruthy()
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

  it('suit un viewport de capture différent, à requête gelée', async () => {
    const capture: any = structuredClone(captureBarresStationnement())
    for (const figure of capture.figures) {
      if (figure.row) figure.row = { ...figure.row, viewportPx: 1024 }
    }
    const lecture = await generer(capture)
    const titres = [
      lecture.textes.find((item) => item.str === 'Stationnement vélo et voiture')!,
      lecture.textes.find((item) => item.str === 'Bornes de recharge et station-services')!,
    ]
    const centre = (item: (typeof titres)[number]) => item.x + item.largeur / 2
    // 1024 px: the source clamp resolves below its 56 px ceiling.
    const ecartPx = figureRowLayout(1024).gapPx
    expect(ecartPx).toBeLessThan(CAHIER_FIGURE_ROW.gap.maximumPx)
    const figurePx = (CONTENU_CSS_PX - ecartPx) / CAHIER_FIGURE_ROW.columns
    expect(centre(titres[1]!) - centre(titres[0]!)).toBeCloseTo((figurePx + ecartPx) * ptDepuisCssPx(1), 1)
  })
})

describe('#1024 — rail des barres mesuré comme le composant natif', () => {
  /**
   * The paired stationnement column with large served counts: at half width the
   * base 68 px rail cannot hold `12 345 678`, so only a measured rail keeps the
   * label inside the figure.
   */
  function captureBarresLarges(): CahierExportCapture {
    const capture: any = structuredClone(captureBarresStationnement())
    for (const figure of capture.figures) {
      if (figure.family !== 'mobilite-bars') continue
      const model = figure.model.figure
      model.yAxisTitle = 'Places'
      model.unit = 'places'
      model.xAxisTitle = 'Mode'
      model.categories[0].value.fact.value = 12345678
      model.categories[0].value.fact.unit = 'places'
      model.categories[1].value.fact.value = 9876543
      model.categories[1].value.fact.unit = 'places'
      for (const category of model.categories) category.value.fact.comparison = null
    }
    return capture as CahierExportCapture
  }

  it('place les graduations à partir du rail mesuré, jamais hors de la figure', async () => {
    const lecture = await generer(captureBarresLarges())
    const numeriques = lecture.textes.filter((item) => (
      Math.abs(item.taille - ROLE_PDF.tick.taille) < 0.02
      && /^\d[\d\s\u202f]*$/.test(item.str)
    ))
    expect(numeriques.length, 'des graduations numériques sont peintes').toBeGreaterThan(1)

    // Independent derivation: the source row gives the column width, the shared
    // rule turns the *measured* label into the native rail.
    const ecartPx = figureRowLayout().gapPx
    const figurePx = (CONTENU_CSS_PX - ecartPx) / CAHIER_FIGURE_ROW.columns
    const panel = figurePx * ptDepuisCssPx(1)
    const ecart = ecartPx * ptDepuisCssPx(1)
    const railBase = 68 * panel / 640

    for (let index = 0; index < CAHIER_FIGURE_ROW.columns; index += 1) {
      const bordGauche = CORPS_X_PT + index * (panel + ecart)
      const parLigne = new Map<number, { x: number; droite: number }>()
      for (const item of numeriques) {
        if (item.x < bordGauche - 0.5 || item.x >= bordGauche + panel + 0.5) continue
        const cle = Math.round(item.y * 2) / 2
        const ligne = parLigne.get(cle)
        parLigne.set(cle, {
          x: Math.min(item.x, ligne?.x ?? item.x),
          droite: Math.max(item.x + item.largeur, ligne?.droite ?? item.x + item.largeur),
        })
      }
      // A tracked y label is painted glyph by glyph; its line is the tick.
      const lignes = [...parLigne.values()]
      expect(lignes.length, `graduations de la colonne ${index + 1}`).toBeGreaterThan(1)
      const rail = Math.max(...lignes.map((ligne) => ligne.droite)) - bordGauche
      // The only rail that holds these labels is the measured one: the base
      // 68 px margin is narrower than the widest label span.
      const plusLarge = Math.max(...lignes.map((ligne) => ligne.droite - ligne.x))
      expect(rail).toBeGreaterThan(railBase + 1)
      expect(rail).toBeGreaterThan(plusLarge - 0.5)
      for (const ligne of lignes) {
        // No y label may leave the figure it belongs to.
        expect(ligne.x).toBeGreaterThanOrEqual(bordGauche - 0.05)
        // Every tick is right-aligned on that one measured rail.
        expect(ligne.droite).toBeCloseTo(bordGauche + rail, 1)
      }
    }
    verifierCollisions(lecture)
  })
})

describe('#1024 — mesure et peinture partagent le même jeu d’options', () => {
  it('mesure chaque figure avec l’objet exact que le peintre reçoit', async () => {
    const { mesure, doc } = await mesurePdfProduction({ chargerPolice: chargeurPoliceTest })
    const largeurMm = LARGEUR_CORPS_PT * 25.4 / 72
    for (const key of [
      'aedar-access',
      'aedar-equipment-explorer',
      'stationnement-ravitaillement',
      'couverture-du-territoire',
      'visiter-la-bretagne',
    ] as const) {
      const capture = key === 'stationnement-ravitaillement'
        ? captureBarresStationnement()
        : capturePdfFixture(key)
      const offered = capture.capabilities.selectableSeries.map((serie) => serie.id)
      const result = projeterRequeteExport(capture, offered.slice(0, 3))
      if (result.status !== 'ready') throw new Error(result.reason)
      for (const projection of projeterRequeteExportFigures(result.request)) {
        const options = optionsFigurePdf(result.request, projection)
        const mesuree = hauteurFigurePdf(projection, largeurMm, mesure, options)
        const peinte = await dessinerFigurePdf({
          ...options,
          doc,
          mesure,
          x: 20,
          y: 60,
          width: largeurMm,
          signal: new AbortController().signal,
          chargerImage: chargeurImageTest,
        }, projection)
        // The measured block must reserve at least what the painter emits, or
        // pagination would clip a figure the same options just drew.
        expect(mesuree + 0.01, `${key}/${projection.family}`).toBeGreaterThanOrEqual(peinte)
      }
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

  it('peint le tableau d’accès sans comparaison sur trois colonnes 18/46/36', async () => {
    const lecture = await generer(capturePdfFixture('aedar-access', { publications: [] }))
    expect(lecture.textes.filter((item) => item.str === 'Groupe')).toHaveLength(0)
    expect(lecture.textes.filter((item) => item.str === 'Rang')).toHaveLength(0)
  })
})
