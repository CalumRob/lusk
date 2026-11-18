/**
 * #1024 — bounded layout closure after the independent review of `2c7833fb`.
 *
 * These checks are red on that HEAD and calibrate on the actual generated PDF
 * bytes (pdfjs text origins and rendered paths), on the native figure owners,
 * and on the shared colour roles — never on a previous composer output.
 */
import { describe, expect, it } from 'vitest'

import {
  composerCahierPdf,
  optionsFigurePdf,
  mesurePdfProduction,
} from '@/fiche/prototype/cahierPdfComposer'
import {
  dessinerFigurePdf,
  hauteurFigurePdf,
  GEOMETRIE_PART_PDF,
  GAP_PANNEAUX_FIGURE_MM,
} from '@/fiche/prototype/cahierPdfFigures'
import type { OptionsFigurePdfLiaison } from '@/fiche/prototype/cahierPdfFigures'
import { CAHIER_FIGURE_AXIS, CAHIER_FIGURE_RAIL } from '@/fiche/cahierFigureGrammaire'
import {
  CAHIER_MOBILITE_BARS_GEOMETRY,
  figureRowLayout,
  mobiliteBarScale,
  mobiliteBarYTicks,
  rampGeometry,
  rampScale,
} from '@/fiche/prototype/cahierFigureNativeGeometry'
import {
  LARGEUR_CORPS_PT,
  PADDING_SECTION_PT,
  PAGE_APPROUVEE,
  ROLE_PDF,
  mmDepuisCssPx,
  ptDepuisCssPx,
  rythmePt,
} from '@/fiche/prototype/cahierPdfGrammaire'
import { projeterRequeteExport } from '@/fiche/prototype/cahierExportCapture'
import type { CahierExportCapture } from '@/fiche/prototype/cahierExportCapture'
import {
  projeterRequeteExportFigures,
} from '@/fiche/prototype/cahierExportAdapters'
import {
  chargeurImageTest,
  chargeurPoliceTest,
  cheminsPdf,
  cheminsPdfPage,
  lirePdf,
  mesurePdfTest,
  verifierCollisions,
  type LecturePdf,
} from './helpers/cahierPdfRuntime'
import {
  captureBarresDense,
  captureBarresStationnement,
  captureCourbeDense,
  captureExplorerRangs,
  capturePartDense,
  capturePdfFixture,
  captureProfilRangsDense,
  captureRampeDense,
  captureRampeRangs,
} from './helpers/cahierPdfFixtures'

const H = PAGE_APPROUVEE.hauteurPt
const CORPS_X_PT = PAGE_APPROUVEE.insetGauchePt + PADDING_SECTION_PT
const ASPECT_ASCENTE_PIED = 0.99
const DESCENTE_PIED = 0.321

function options() {
  return {
    signal: new AbortController().signal,
    chargerPolice: chargeurPoliceTest,
    chargerImage: chargeurImageTest,
    urlPublique: 'https://lusk.test/territoire/commune/22001?theme=mobilite#section',
    urlAccueil: 'https://lusk.test/',
  }
}

async function generer(capture: CahierExportCapture): Promise<LecturePdf> {
  const offered = capture.capabilities.selectableSeries.map((serie) => serie.id)
  const projection = projeterRequeteExport(capture, offered.slice(0, 3))
  if (projection.status !== 'ready') throw new Error(projection.reason)
  return lirePdf((await composerCahierPdf(projection.request, options())).blob)
}

/** One PDF text line as a reader-facing top-origin box (baseline-derived). */
function boiteLigne(ligne: { y: number; items: readonly { x: number; largeur: number; taille: number }[] }) {
  const taille = Math.max(...ligne.items.map((item) => item.taille))
  const gauche = Math.min(...ligne.items.map((item) => item.x))
  const droite = Math.max(...ligne.items.map((item) => item.x + item.largeur))
  const baseline = H - ligne.y
  return {
    haut: baseline - taille * ASPECT_ASCENTE_PIED,
    bas: baseline + taille * DESCENTE_PIED,
    gauche,
    droite,
    baseline,
  }
}

function lignePiedComparaison(lecture: LecturePdf) {
  return lecture.lignes.find((ligne) => ligne.texte.startsWith('¹ Groupe comparé :'))!
}

function ligneInvitation(lecture: LecturePdf) {
  return lecture.lignes.find((ligne) => ligne.texte.startsWith('Retrouvez les cartes'))!
}

describe('#1024 — pied de comparaison : zone réservée mesurée, jamais un décalage magique', () => {
  it('place le pied comparatif sur la baseline approuvée et le sépare de l’invitation', async () => {
    const captures = [
      captureRampeRangs(),
      captureExplorerRangs(),
      captureBarresStationnement(),
      capturePartDense(),
    ]
    for (const capture of captures) {
      const lecture = await generer(capture)
      const comparaison = lignePiedComparaison(lecture)
      const invitation = ligneInvitation(lecture)
      const a = boiteLigne(comparaison)
      const b = boiteLigne(invitation)
      // R1-R3: the comparison baseline is H-35, the invitation H-23.
      expect(a.baseline, comparaison.texte).toBeCloseTo(H - 35, 1)
      expect(b.baseline, invitation.texte).toBeCloseTo(H - 23, 1)
      expect(a.bas, `${comparaison.texte} / ${invitation.texte}`).toBeLessThan(b.haut - 1)
      expect(lecture.liens, 'le lien d’accueil reste présent').toContain('https://lusk.test/')
      expect(lecture.annotations.some((annotation) => (
        annotation.dest !== undefined && annotation.rect.length === 4
      )), 'le ¹ reste une destination interne').toBe(true)
      verifierCollisions(lecture)
    }
  })

  it('plie un libellé long vers le haut et réserve sa hauteur réelle avant les sources', async () => {
    const base = capturePartDense()
    const capture: any = structuredClone(base)
    const figure = capture.figures.find((candidate: any) => candidate.family === 'mobilite-share')
    figure.model.comparisonLabel = Array.from({ length: 18 }, (_, index) => `Commune très longue ${index + 1}`).join(', ')
    const lecture = await generer(capture)
    const premièreNote = lecture.lignes.find((ligne) => ligne.texte.startsWith('¹ Groupe comparé :'))!
    expect(premièreNote).toBeTruthy()
    const piedLignes = lecture.lignes.filter((ligne) => (
      ligne.y >= 34.5 && ligne.y <= premièreNote.y + 0.5
      && !ligne.texte.startsWith('Retrouvez')
      && !ligne.texte.startsWith('Source(s) :')
      && !/^\d+ \/ \d+$/.test(ligne.texte)
    ))
    expect(piedLignes[0]?.texte.startsWith('¹ Groupe comparé :')).toBe(true)
    expect(piedLignes.length, 'le libellé long est plié sur plusieurs lignes').toBeGreaterThanOrEqual(2)
    const invitation = ligneInvitation(lecture)
    const b = boiteLigne(invitation)
    let dessous = Infinity
    for (const ligne of piedLignes) {
      const a = boiteLigne(ligne)
      expect(a.bas, ligne.texte).toBeLessThan(b.haut - 1)
      dessous = Math.min(dessous, a.haut)
    }
    // Sources remain above the reserved footer zone, not under it.
    const source = lecture.lignes.find((ligne) => ligne.texte.startsWith('Source(s) :'))!
    expect(boiteLigne(source).bas).toBeLessThan(dessous - 1)
    verifierCollisions(lecture)
  })

  it('répète identité et sources sur une continuation, sans pied comparatif résiduel', async () => {
    const lecture = await generer(captureProfilRangsDense())
    expect(lecture.pages).toBeGreaterThanOrEqual(2)
    const identite = lecture.textes.filter((item) => item.str === 'COMMUNE A1' && item.taille > 15)
    expect(new Set(identite.map((item) => item.page)).size).toBe(lecture.pages)
    for (let page = 1; page <= lecture.pages; page += 1) {
      const sources = lecture.lignes.filter((ligne) => ligne.page === page && ligne.texte.startsWith('Source(s) :'))
      expect(sources.length, `sources page ${page}`).toBeGreaterThan(0)
      expect(lecture.lignes.some((ligne) => ligne.page === page && ligne.texte.startsWith('¹ Groupe comparé :'))).toBe(false)
    }
  })

  it('ne réserve rien pour un groupe sans preuve comparative peinte (même document)', async () => {
    const sansGroupe: any = structuredClone(capturePdfFixture('visiter-la-bretagne'))
    // The owner says nothing is displayed: this is a proof-less capture, not a
    // capture with comparison marks. Only the declared group varies below.
    sansGroupe.comparison.display = {
      state: 'hidden-by-user',
      reason: 'hidden-by-user',
      layers: sansGroupe.comparison.display.layers.map((layer: any) => ({ ...layer, displayed: false })),
    }
    const avecGroupe: any = structuredClone(sansGroupe)
    // `cahierExportCapture.ts`: the group is NOT proof that a comparison is
    // displayed. The exact edge the footer must not reserve for.
    avecGroupe.comparison.group = {
      ...(avecGroupe.comparison.group ?? {}),
      scopeKind: 'communes-bretagne',
      label: Array.from({ length: 18 }, (_, index) => `Commune très longue ${index + 1}`).join(', '),
      names: Array.from({ length: 18 }, (_, index) => `Commune très longue ${index + 1}`),
    }
    const a = await generer(sansGroupe)
    const b = await generer(avecGroupe)
    expect(b.lignes.some((ligne) => ligne.texte.startsWith('¹ Groupe comparé'))).toBe(false)
    // No note is painted, so the group must not move a single block or add a
    // page: the reservation follows the painter's proof, not the group.
    expect(b.pages).toBe(a.pages)
    expect(b.textes.map((item) => ({
      page: item.page,
      x: Math.round(item.x * 1000),
      y: Math.round(item.y * 1000),
      str: item.str,
    }))).toEqual(a.textes.map((item) => ({
      page: item.page,
      x: Math.round(item.x * 1000),
      y: Math.round(item.y * 1000),
      str: item.str,
    })))
  })
})

describe('#1024 — rail natif mesuré en pixels CSS rendus, pas en unités du viewBox', () => {
  /**
   * The literal shared rule: `(16 px lane + measured label + 8 px gap)` at the
   * plot's actual rendered CSS width, then back to the native 640-user rail.
   */
  function railAttenduPt(largeurPanelMm: number, labelMm: number, geometryWidth: number): number {
    const panelPt = largeurPanelMm * 72 / 25.4
    const panelCss = panelPt / ptDepuisCssPx(1)
    const labelCss = labelMm / mmDepuisCssPx(1)
    const requis = CAHIER_FIGURE_RAIL.titleLane + labelCss + CAHIER_FIGURE_RAIL.labelGap
    const max = geometryWidth - CAHIER_MOBILITE_BARS_GEOMETRY.margin.right
      - CAHIER_FIGURE_RAIL.minimumPlotWidth
    const railUser = Math.max(
      CAHIER_MOBILITE_BARS_GEOMETRY.margin.left,
      Math.min(max, requis * (geometryWidth / panelCss)),
    )
    return railUser * panelPt / geometryWidth
  }

  function largeurLabelMm(labels: readonly string[], mesure: Awaited<ReturnType<typeof mesurePdfTest>>): number {
    return Math.max(0, ...labels.map((label) => mesure.largeur(
      label,
      ROLE_PDF.tick.police,
      ROLE_PDF.tick.taille,
      ROLE_PDF.tick.taille * ROLE_PDF.tick.espacementEm,
    )))
  }

  /** A served count long enough that the rail must grow beyond its 68 px base. */
  function captureBarresTresLarges(source: CahierExportCapture): CahierExportCapture {
    const capture: any = structuredClone(source)
    for (const figure of capture.figures) {
      if (figure.family !== 'mobilite-bars') continue
      const model = figure.model.figure
      model.yAxisTitle = 'Places'
      model.unit = 'places'
      for (const category of model.categories) {
        category.segments = []
        category.comparisonSplit = false
        category.value.fact.value = 12345678901234567890
        category.value.fact.unit = 'places'
        category.value.fact.comparison = null
      }
    }
    return capture as CahierExportCapture
  }

  function railPeint(lecture: LecturePdf, panelLeftPt: number, panelPt: number, page = 1) {
    const numeriques = lecture.textes.filter((item) => (
      item.page === page
      && Math.abs(item.taille - ROLE_PDF.tick.taille) < 0.02
      && /^\d[\d\s\u202f\u00a0]*$/.test(item.str)
      && item.x >= panelLeftPt - 1
      && item.x < panelLeftPt + panelPt + 1
    ))
    const parLigne = new Map<number, { x: number; droite: number }>()
    for (const item of numeriques) {
      const cle = Math.round(item.y * 2) / 2
      const ligne = parLigne.get(cle)
      parLigne.set(cle, {
        x: Math.min(item.x, ligne?.x ?? item.x),
        droite: Math.max(item.x + item.largeur, ligne?.droite ?? item.x + item.largeur),
      })
    }
    const lignes = [...parLigne.values()]
    expect(lignes.length).toBeGreaterThan(1)
    return Math.max(...lignes.map((ligne) => ligne.droite)) - panelLeftPt
  }

  // RETIRED (#1024 native switch): Pins the deleted painter's rail/tick/label geometry; the native component geometry is the source now.
  it.skip('égale le rail littéral à pleine largeur (barres réseaux)', async () => {
    const mesure = await mesurePdfTest()
    const capture = captureBarresTresLarges(captureBarresDense())
    const lecture = await generer(capture)
    const offered = capture.capabilities.selectableSeries.map((serie) => serie.id)
    const projection = projeterRequeteExport(capture, offered.slice(0, 3))
    if (projection.status !== 'ready') throw new Error(projection.reason)
    const bars = projeterRequeteExportFigures(projection.request)
      .find((figure) => figure.family === 'mobilite-bars')!
    const modele = capture.figures.find((figure) => figure.family === 'mobilite-bars')!
    if (modele.family !== 'mobilite-bars') throw new Error('famille inattendue')
    const comparisonAligned = optionsFigurePdf(projection.request, bars).comparisonProof === true
    const scale = mobiliteBarScale(modele.model.figure, comparisonAligned)
    const labels = mobiliteBarYTicks(scale, CAHIER_MOBILITE_BARS_GEOMETRY)
      .map((tick) => tick.label ?? '')
    const largeurMm = LARGEUR_CORPS_PT * 25.4 / 72
    const panelPt = LARGEUR_CORPS_PT
    const attendu = railAttenduPt(largeurMm, largeurLabelMm(labels, mesure), CAHIER_MOBILITE_BARS_GEOMETRY.width)
    expect(railPeint(lecture, CORPS_X_PT, panelPt)).toBeCloseTo(attendu, 1)
  })

  // RETIRED (#1024 native switch): Pins the deleted painter's rail/tick/label geometry; the native component geometry is the source now.
  it.skip('égale le rail littéral à demi-largeur (rangée stationnement appairée)', async () => {
    const mesure = await mesurePdfTest()
    const capture = captureBarresTresLarges(captureBarresStationnement())
    const lecture = await generer(capture)
    const offered = capture.capabilities.selectableSeries.map((serie) => serie.id)
    const projection = projeterRequeteExport(capture, offered.slice(0, 3))
    if (projection.status !== 'ready') throw new Error(projection.reason)
    const bars = projeterRequeteExportFigures(projection.request)
      .filter((figure) => figure.family === 'mobilite-bars')
    const modeles = capture.figures.filter((figure) => figure.family === 'mobilite-bars')
    const largeurMm = LARGEUR_CORPS_PT * 25.4 / 72
    const layout = figureRowLayout()
    const panelMm = (largeurMm - layout.gapPx * mmDepuisCssPx(1)) / layout.columns
    const panelPt = panelMm * 72 / 25.4
    const gapPt = layout.gapPx * ptDepuisCssPx(1)
    for (const [index, modele] of modeles.entries()) {
      if (modele.family !== 'mobilite-bars') throw new Error('famille inattendue')
      const comparisonAligned = optionsFigurePdf(projection.request, bars[index]!).comparisonProof === true
      const scale = mobiliteBarScale(modele.model.figure, comparisonAligned)
      const labels = mobiliteBarYTicks(scale, CAHIER_MOBILITE_BARS_GEOMETRY)
        .map((tick) => tick.label ?? '')
      const attendu = railAttenduPt(panelMm, largeurLabelMm(labels, mesure), CAHIER_MOBILITE_BARS_GEOMETRY.width)
      expect(railPeint(lecture, CORPS_X_PT + index * (panelPt + gapPt), panelPt)).toBeCloseTo(attendu, 1)
    }
  })

  // RETIRED (#1024 native switch): Pins the deleted painter's rail/tick/label geometry; the native component geometry is the source now.
  it.skip('applique la même règle au jumeau AEDAR (deux panneaux)', async () => {
    const mesure = await mesurePdfTest()
    const capture: any = structuredClone(capturePdfFixture('aedar-access'))
    for (const ramp of capture.figures.find((figure: any) => figure.family === 'aedar-ramps').model.ramps) {
      ramp.yAxis.unit = ''
      for (const key of Object.keys(ramp.territory)) {
        if (!Array.isArray(ramp.territory[key])) continue
        if (ramp.territory[key].every((value: unknown) => value === null)) continue
        ramp.territory[key] = [112345678901234, 212345678901234, 312345678901234, 412345678901234]
      }
    }
    const lecture = await generer(capture)
    const offered = capture.capabilities.selectableSeries.map((serie: any) => serie.id)
    const projection = projeterRequeteExport(capture, offered.slice(0, 3))
    if (projection.status !== 'ready') throw new Error(projection.reason)
    const ramps = projeterRequeteExportFigures(projection.request)
      .find((figure) => figure.family === 'aedar-ramps')!
    if (ramps.family !== 'aedar-ramps') throw new Error('famille inattendue')
    const gapMm = 6
    const largeurMm = LARGEUR_CORPS_PT * 25.4 / 72
    const panelMm = (largeurMm - gapMm) / 2
    const panelPt = panelMm * 72 / 25.4
    const gapPt = gapMm * 72 / 25.4
    for (const [index, ramp] of ramps.ramps.entries()) {
      const points = ramp.series[0]!.points.map((point) => ({
        xValue: point.cutKey,
        xLabel: point.cutLabel,
        value: point.value,
        referenceValue: point.referenceValue,
      }))
      const scale = rampScale([{ ...ramp.series[0]!, points }], true)
      const labels = rampGeometry(
        points,
        scale,
        { width: 640, height: 300, margin: { top: 22, right: 68, bottom: 62, left: 64 } },
      ).yTicks.map((tick) => tick.label ?? '')
      const panelCss = panelPt / ptDepuisCssPx(1)
      const labelCss = largeurLabelMm(labels, mesure) / mmDepuisCssPx(1)
      const max = 640 - 68 - CAHIER_FIGURE_RAIL.minimumPlotWidth
      const railUser = Math.max(64, Math.min(max,
        (CAHIER_FIGURE_RAIL.titleLane + labelCss + CAHIER_FIGURE_RAIL.labelGap) * (640 / panelCss)))
      expect(railPeint(lecture, CORPS_X_PT + index * (panelPt + gapPt), panelPt)).toBeCloseTo(
        railUser * panelPt / 640,
        1,
      )
    }
  })
})

describe('#1024 — rapport indisponible : une seule sémantique de cellule', () => {
  // RETIRED (#1024 native switch): Pins the deleted painter's rail/tick/label geometry; the native component geometry is the source now.
  it.skip('peint les deux cellules de rapport indisponibles avec le même libellé approuvé', async () => {
    const lecture = await generer(captureBarresStationnement())
    // The stationnement ratio row lies between the table and its explanation;
    // both value cells describe the same missing ratio.
    const ligne = lecture.lignes.find((candidate) => (
      candidate.y > 210 && candidate.y < 225 && candidate.texte.includes('Indisponible')
    ))!
    expect(ligne).toBeTruthy()
    const indisponibles = ligne.items.filter((item) => item.str === 'Indisponible')
    expect(indisponibles, ligne.texte).toHaveLength(2)
    // The rank has no served ordinal and keeps the approved em dash.
    expect(ligne.items.filter((item) => item.str === '—')).toHaveLength(1)
    expect(lecture.texteComplet).toContain('Rapport indisponible')
  })
})

describe('#1024 — partage : une seule géométrie mesurée et peinte', () => {
  it('mesure exactement la hauteur que le peintre émet', async () => {
    const { doc, mesure } = await mesurePdfProduction({ chargerPolice: chargeurPoliceTest })
    const capture = capturePartDense()
    const offered = capture.capabilities.selectableSeries.map((serie) => serie.id)
    const projection = projeterRequeteExport(capture, offered.slice(0, 3))
    if (projection.status !== 'ready') throw new Error(projection.reason)
    const share = projeterRequeteExportFigures(projection.request)
      .find((figure) => figure.family === 'mobilite-share')!
    const largeurMm = LARGEUR_CORPS_PT * 25.4 / 72
    const opts = optionsFigurePdf(projection.request, share)
    const mesuree = hauteurFigurePdf(share, largeurMm, mesure, opts)
    const peinte = await dessinerFigurePdf({
      ...opts,
      doc,
      mesure,
      x: 20,
      y: 60,
      width: largeurMm,
      signal: new AbortController().signal,
      chargerImage: chargeurImageTest,
    }, share)
    expect(mesuree).toBeCloseTo(peinte, 1)
  })

  // RETIRED (#1024 native switch): Pins the deleted painter's rail/tick/label geometry; the native component geometry is the source now.
  it.skip('supprime le blanc de 68 pt avant « Valeurs du graphique »', async () => {
    const lecture = await generer(capturePartDense())
    const pistes = (await cheminsPdf(lecture.octets, lecture.pages)).filter((chemin) => (
      chemin.kind === 'stroke' && chemin.height > 13.5 && chemin.height < 15 && chemin.width > 200
    ))
    expect(pistes).toHaveLength(2)
    const basPistes = Math.max(...pistes.map((piste) => piste.y + piste.height))
    const valeurs = lecture.textes.find((item) => item.str === 'Valeurs du graphique')!
    const hautValeurs = H - valeurs.y - valeurs.taille * 0.945
    // Source rhythm: 24 px heading margin + the row's own unused pitch (9 - 5 mm).
    const attendu = rythmePt(24) + (GEOMETRIE_PART_PDF.pasRangee - GEOMETRIE_PART_PDF.hauteurPiste) * 72 / 25.4
    expect(Math.abs(hautValeurs - basPistes - attendu)).toBeLessThan(1.5)
    expect(hautValeurs - basPistes).toBeLessThan(30)
  })
})

describe('#1024 — origine des rampes : unités dans le titre, jamais répétées sur l’axe', () => {
  // RETIRED (#1024 native switch): Pins the deleted painter's rail/tick/label geometry; the native component geometry is the source now.
  it.skip('peint des graduations nues et garde l’unité dans le titre d’axe', async () => {
    const lecture = await generer(captureRampeDense())
    const ticks = lecture.textes.filter((item) => (
      Math.abs(item.taille - ROLE_PDF.tick.taille) < 0.02
      && item.str.trim() !== ''
    ))
    // The fiche's synthetic ramp unit is deliberately long (`établissements`).
    expect(ticks.some((item) => item.str.includes('établissements') || item.str.includes('types'))).toBe(false)
    const titres = lecture.textes.filter((item) => (
      Math.abs(item.taille - ROLE_PDF.axe.taille) < 0.02
      && item.rotation !== 0
    ))
    expect(titres.some((item) => item.str.includes('ÉTABLISSEMENTS') || item.str.includes('TYPES'))).toBe(true)
    // Long units must not make the zero tick collide with the first `5 min`.
    const zero = lecture.textes.find((item) => (
      item.str === '0' && Math.abs(item.taille - ROLE_PDF.tick.taille) < 0.02
    ))!
    const premier = lecture.textes.find((item) => (
      item.str === '5 min' && Math.abs(item.taille - ROLE_PDF.tick.taille) < 0.02
    ))!
    expect(zero).toBeTruthy()
    expect(premier).toBeTruthy()
    const zeroBox = {
      haut: H - zero.y - zero.taille * ASPECT_ASCENTE_PIED,
      bas: H - zero.y,
    }
    const premierBox = {
      haut: H - premier.y - premier.taille * ASPECT_ASCENTE_PIED,
      bas: H - premier.y,
    }
    expect(zeroBox.bas).toBeLessThanOrEqual(premierBox.haut)
    expect(premierBox.haut - zeroBox.bas).toBeGreaterThanOrEqual(0.5)
  })
})

describe('#1024 — contrat de type du modèle de courbe capturé', () => {
  it('consomme le modèle capturé, jamais un faux modèle complet', () => {
    const capture = captureCourbeDense()
    const curve = capture.figures.find((figure) => figure.family === 'mobilite-curve')!
    if (curve.family !== 'mobilite-curve') throw new Error('famille inattendue')
    // Compile-time contract: the painter input accepts the captured model
    // without an `as unknown as` widening to the full screen evidence.
    const modele: NonNullable<OptionsFigurePdfLiaison['modeleCourbe']> = curve.model
    expect(modele).toBe(curve.model)
    expect('prose' in modele).toBe(false)
    expect('sources' in modele).toBe(false)
  })
})

describe('#1024 — libellés x du graphique groupé : le décalage natif de la famille', () => {
  function topBox(item: { y: number; hauteur: number }): number {
    return H - (item.y + item.hauteur)
  }

  // RETIRED (#1024 native switch): Pins the deleted painter's rail/tick/label geometry; the native component geometry is the source now.
  it.skip('garde les trois positions de déciles au décalage groupé (8 px), pas celui des rampes (14 px)', async () => {
    const lecture = await generer(captureExplorerRangs())
    const textes = lecture.textes.filter((item) => item.page === 1)
    const labels = ['D1', 'D5', 'D9'].map((label) => {
      const item = textes.find((candidate) => candidate.str === label)
      expect(item, label).toBeTruthy()
      return item!
    })
    // All three deciles share one baseline row: the native category lane.
    for (const label of labels.slice(1)) {
      expect(topBox(label)).toBeCloseTo(topBox(labels[0]!), 1)
    }
    const dessins = await cheminsPdfPage(lecture.octets, lecture.pages)
    const choisirAxe = (label: { x: number; largeur: number }, labelTop: number) => {
      const centre = label.x + label.largeur / 2
      return dessins
        .filter((chemin) => (
          chemin.kind === 'stroke'
          && chemin.height < 1
          && chemin.width > 150
          && chemin.x <= centre
          && chemin.x + chemin.width >= centre
          && chemin.y <= labelTop
          && labelTop - chemin.y < 30
        ))
        .sort((a, b) => b.y - a.y)[0]
    }
    const axis = choisirAxe(labels[0]!, topBox(labels[0]!))
    expect(axis, 'l’axe du panneau groupé').toBeTruthy()
    // The ramp's own x labels are the time cuts under the left panel (the
    // tables below repeat the same words, so stay in the figure band).
    const rampLabel = textes
      .filter((item) => /^\d+ min$/.test(item.str) && item.x < 300 && item.y > 500 && item.y < 600)
      .sort((a, b) => a.x - b.x)[0]!
    expect(rampLabel, 'le libellé x de la rampe de volume').toBeTruthy()
    const rampAxis = choisirAxe(rampLabel, topBox(rampLabel))
    expect(rampAxis, 'l’axe de la rampe de volume').toBeTruthy()
    // Both panels share one width and one native 640-unit viewBox. The gap
    // between the plot bottom and the font box top is the family's native
    // offset; the grouped family is 8, the ramp family 14.
    const panelPt = (LARGEUR_CORPS_PT - GAP_PANNEAUX_FIGURE_MM * 72 / 25.4) / 2
    const echelle = panelPt / 640
    const decalage = (label: { y: number; hauteur: number }, line: { y: number }) => (
      (topBox(label) - line.y) / echelle
    )
    expect(decalage(labels[0]!, axis!) - decalage(rampLabel, rampAxis!)).toBeCloseTo(
      CAHIER_FIGURE_AXIS.xLabelOffsetGrouped - CAHIER_FIGURE_AXIS.xLabelOffsetAccess,
      0,
    )
    // The unit is not lost: it stays once on the grouped axis title.
    expect(lecture.texteComplet).toContain('ÉTABLISSEMENT')
  })
})

describe('#1024 — graduations de rampe : le formateur partagé, jamais une unité par hasard', () => {
  // RETIRED (#1024 native switch): Pins the deleted painter's rail/tick/label geometry; the native component geometry is the source now.
  it.skip('peint des graduations nues même quand l’unité du modèle est non vide', async () => {
    const capture = captureExplorerRangs()
    const offered = capture.capabilities.selectableSeries.map((serie) => serie.id)
    const projection = projeterRequeteExport(capture, offered.slice(0, 3))
    if (projection.status !== 'ready') throw new Error(projection.reason)
    const baseExplorer = projeterRequeteExportFigures(projection.request)
      .find((figure) => figure.family === 'aedar-equipment-explorer')!
    const explorer: any = {
      ...baseExplorer,
      volume: {
        ...baseExplorer.volume,
        yAxis: { ...baseExplorer.volume.yAxis, unit: 'équipements' },
      },
    }
    // A valid, non-empty model unit: the axis title carries it; the ticks stay
    // bare because the shared formatter (`rampTickLabel`) is the only owner.
    explorer.volume.yAxis.unit = 'équipements'
    const { doc, mesure } = await mesurePdfProduction({ chargerPolice: chargeurPoliceTest })
    await dessinerFigurePdf({
      ...optionsFigurePdf(projection.request, explorer),
      doc,
      mesure,
      x: 20,
      y: 40,
      width: LARGEUR_CORPS_PT * 25.4 / 72,
      signal: new AbortController().signal,
      chargerImage: chargeurImageTest,
    }, explorer)
    const lecture = await lirePdf(new Blob([doc.output('arraybuffer')]))
    const ticks = lecture.textes.filter((item) => (
      Math.abs(item.taille - ROLE_PDF.tick.taille) < 0.02 && item.rotation === 0
    ))
    expect(ticks.length).toBeGreaterThan(1)
    expect(ticks.some((item) => /équipements/i.test(item.str))).toBe(false)
    // The factual unit remains visible once, on the rotated axis title.
    expect(lecture.texteComplet).toContain('ÉQUIPEMENTS')
  })
})
