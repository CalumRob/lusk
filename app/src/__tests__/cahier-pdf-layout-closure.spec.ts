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
} from '@/fiche/prototype/cahierPdfComposer'
import {
  
  PAGE_APPROUVEE,
} from '@/fiche/prototype/cahierPdfGrammaire'
import { projeterRequeteExport } from '@/fiche/prototype/cahierExportCapture'
import type { CahierExportCapture } from '@/fiche/prototype/cahierExportCapture'
import {
  chargeurImageTest,
  chargeurPoliceTest,
  lirePdf,
  verifierCollisions,
  type LecturePdf,
} from './helpers/cahierPdfRuntime'
import {
  
  captureBarresStationnement,
  captureCourbeDense,
  captureExplorerRangs,
  capturePartDense,
  capturePdfFixture,
  captureProfilRangsDense,
  captureRampeRangs,
} from './helpers/cahierPdfFixtures'

const H = PAGE_APPROUVEE.hauteurPt
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

describe('#1024 — rapport indisponible : une seule sémantique de cellule', () => {
  // RETIRED (#1024 native switch): Pins the deleted painter's rail/tick/label geometry; the native component geometry is the source now.
  it('peint les deux cellules de rapport indisponibles avec le même libellé approuvé', async () => {
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


describe('#1024 — contrat de type du modèle de courbe capturé', () => {
  it('consomme le modèle capturé, jamais un faux modèle complet', () => {
    const capture = captureCourbeDense()
    const curve = capture.figures.find((figure) => figure.family === 'mobilite-curve')!
    if (curve.family !== 'mobilite-curve') throw new Error('famille inattendue')
    // The captured curve model is the minimal native input; it is consumed as
    //-is, with no widening to a full screen-evidence object.
    const modele = curve.model
    expect(modele).toBe(curve.model)
    expect('prose' in modele).toBe(false)
    expect('sources' in modele).toBe(false)
  })
})

