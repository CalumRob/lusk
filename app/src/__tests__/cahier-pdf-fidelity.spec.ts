/**
 * Independent, source-grounded visual contract of the shared Cahier PDF
 * (#1024 / PRD #1014).
 *
 * The expectations below come from the *approved generating rules*: the app's
 * own token/font roles, the approved prototype artifacts (R1–R3) and the
 * owner-fixed comparison subtitle contract (18 px CSS = 13.5 pt). They are
 * never derived from a previous output of this composer.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { composerCahierPdf } from '@/fiche/prototype/cahierPdfComposer'
import { PALETTE_PDF } from '@/fiche/prototype/cahierPdfPalette'
import { POLICES_PDF } from '@/fiche/prototype/cahierPdfFonts'
import {
  PAGE_APPROUVEE,
  ROLE_PDF,
  RYTHME_PX,
  TAILLE_COMPARAISON_PT,
  ptDepuisCssPx,
} from '@/fiche/prototype/cahierPdfGrammaire'
import type { CahierExportCapture, CahierExportRequest } from '@/fiche/prototype/cahierExportCapture'
import { projeterRequeteExport } from '@/fiche/prototype/cahierExportCapture'
import {
  chargeurImageTest,
  chargeurPoliceTest,
  cheminsPdf,
  lirePdf,
  type LecturePdf,
} from './helpers/cahierPdfRuntime'
import {
  captureExplorerRangs,
  captureProfilRangsDense,
  capturePdfFixture,
} from './helpers/cahierPdfFixtures'
import { communeMembers } from './helpers/cahierExportFixtures'

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
  const choisis = modes ?? offered.slice(0, 3)
  const projection = projeterRequeteExport(capture, choisis)
  if (projection.status !== 'ready') throw new Error(projection.reason)
  return projection.request
}

async function generer(capture: CahierExportCapture, modes?: readonly string[]) {
  const artifact = await composerCahierPdf(requete(capture, modes), options())
  return { artifact, lecture: await lirePdf(artifact.blob) }
}

/** Untracked width of one run, measured with the same embedded face. */
async function largeurSansEspacement(policeId: string, taillePt: number, texte: string): Promise<number> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const face = POLICES_PDF.find((candidate) => candidate.id === policeId)!
  const bytes = readFileSync(resolve(process.cwd(), 'src/assets/fonts/pdf', face.file))
  doc.addFileToVFS(`${face.id}.ttf`, bytes.toString('base64'))
  doc.addFont(`${face.id}.ttf`, face.id, 'normal')
  doc.setFont(face.id, 'normal')
  doc.setFontSize(taillePt)
  return doc.getTextWidth(texte)
}

function texteDe(lecture: LecturePdf, value: string, minSize = 0) {
  return lecture.textes.find((item) => item.str === value && item.taille >= minSize)
}

function centre(item: { x: number; largeur: number }): number {
  return item.x + item.largeur / 2
}

/** Reader-facing top-origin y (pdfjs exposes the PDF bottom-origin baseline). */
function haut(item: { y: number }): number {
  return PAGE_APPROUVEE.hauteurPt - item.y
}

/** sRGB hex proximity (the PDF writer rounds each channel independently). */
function couleurProche(a: string, b: string, tolerance = 3): boolean {
  const canaux = (hex: string) => [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16))
  const [x, y] = [canaux(a), canaux(b)]
  return x.every((value, index) => Math.abs(value - y[index]!) <= tolerance)
}

describe('grammaire PDF — rôles approuvés et métriques réelles', () => {
  it('peint l’identité focale au rôle --text-page-heading, mutée, avec l’approche 0.08em', async () => {
    const { lecture } = await generer(capturePdfFixture('aedar-access'))
    const identite = texteDe(lecture, 'COMMUNE A1', 15)
    expect(identite).toBeTruthy()
    expect(identite!.taille).toBeCloseTo(ptDepuisCssPx(38.4), 1)
    expect(identite!.taille).toBeCloseTo(20.19, 1)
    // The approved role is `--editorial-muted`; the resolver keeps one owner.
    expect(PALETTE_PDF.editorialMuted).toBe('#62706c')
    // Six glyphs carry 0.08em of the 20.19 pt role; the emitted advance must
    // include that tracking (a reader receives the same letter-spaced run).
    const sans = await largeurSansEspacement(ROLE_PDF.identite.police, identite!.taille, 'COMMUNE A1')
    const approche = identite!.taille * ROLE_PDF.identite.espacementEm
    const avec = sans + 'COMMUNE A1'.length * approche
    // The run's advance carries the tracking after each glyph; the trailing
    // gap after the last glyph is not part of the visible run.
    expect(identite!.largeur).toBeGreaterThanOrEqual(avec - approche - 0.6)
    expect(identite!.largeur).toBeLessThanOrEqual(avec + 0.6)
    // Centred on the A4 content box.
    expect(centre(identite!)).toBeCloseTo(PAGE_APPROUVEE.largeurPt / 2, 1)
  })

  it('garde le titre de page et le wordmark aux proportions approuvées', async () => {
    const { lecture } = await generer(capturePdfFixture('aedar-access'))
    const titre = lecture.textes
      .filter((item) => haut(item) < 60 && item.str.includes('accès'))
      .sort((a, b) => b.taille - a.taille)[0]
    const mot = texteDe(lecture, 'lusk')
    expect(titre!.taille).toBeCloseTo(20.19, 1)
    expect(mot!.taille).toBeCloseTo(11.57, 1)
    expect(mot!.taille / titre!.taille).toBeGreaterThanOrEqual(0.45)
    expect(mot!.taille / titre!.taille).toBeLessThanOrEqual(0.7)
    expect(mot!.taille / titre!.taille).toBeCloseTo(11.57 / 20.19, 2)
    expect(PALETTE_PDF.textPrimary).toBe('#2d3748')
    expect(PALETTE_PDF.accentPrimary).toBe('#57726f')
  })

  it('aligne le préfixe et les noms comparés sur une seule ligne de base, couleur focale', async () => {
    const capture = capturePdfFixture('visiter-la-bretagne', {
      selection: { etat: 'membres', membres: communeMembers() },
    })
    const { lecture } = await generer(capture, [])
    const prefixe = lecture.textes.find((item) => item.str.startsWith('Groupe comparé'))
    expect(prefixe).toBeTruthy()
    const noms = lecture.textes.find((item) => item.str.includes('COMMUNE A1, COMMUNE B'))
    expect(noms).toBeTruthy()
    // Owner-fixed comparison names: 18 px CSS = 13.5 pt (never the prototype's
    // uniform 0.5258 shrink), same face/weight as the focal identity.
    expect(TAILLE_COMPARAISON_PT).toBe(13.5)
    expect(noms!.taille).toBeCloseTo(13.5, 1)
    expect(prefixe!.taille).toBeCloseTo(ptDepuisCssPx(13), 1)
    // Inline runs share one alphabetic baseline: measured bottom delta <= 2 pt.
    expect(Math.abs(noms!.y - prefixe!.y)).toBeLessThanOrEqual(2)
    expect(PALETTE_PDF.editorialMuted).toBe('#62706c')
  })

  it('garde une seule ligne de légende centrée, marque du propriétaire et rôle caption', async () => {
    const { artifact, lecture } = await generer(capturePdfFixture('aedar-access'))
    const ancre = lecture.textes.find((item) => item.str === 'Voiture'
      && Math.abs(item.taille - ptDepuisCssPx(12)) < 0.05)!
    expect(ancre).toBeTruthy()
    const items = lecture.textes.filter((item) => Math.abs(item.y - ancre.y) < 0.6
      && Math.abs(item.taille - ptDepuisCssPx(12)) < 0.05
      && item.str.trim().length > 0)
    const texteLegende = items.map((item) => item.str).join(' ')
    expect(texteLegende).toContain('Vélo (LTS2)')
    expect(texteLegende).toContain('Vélo (LTS4)')
    const gauche = Math.min(...items.map((item) => item.x))
    const droite = Math.max(...items.map((item) => item.x + item.largeur))
    expect(Math.abs((gauche + droite) / 2 - PAGE_APPROUVEE.largeurPt / 2)).toBeLessThanOrEqual(5)
    // `.cahier-figure-legend-mark` owner geometry: 18 × 3 px at the approved scale.
    const marques = (await cheminsPdf(lecture.octets, lecture.pages)).filter((chemin) => (
      chemin.kind === 'fill'
      && Math.abs(chemin.width - ptDepuisCssPx(RYTHME_PX.marqueLargeur)) < 0.2
      && Math.abs(chemin.height - ptDepuisCssPx(RYTHME_PX.marqueHauteur)) < 0.2
    ))
    expect(marques.length).toBeGreaterThanOrEqual(3)
    void artifact
  })

  it('encadre la section et n’imprime aucun filet rouge pleine hauteur', async () => {
    const { lecture } = await generer(capturePdfFixture('aedar-access'))
    const chemins = await cheminsPdf(lecture.octets, lecture.pages)
    const horizontales = chemins.filter((chemin) => chemin.kind === 'stroke'
      && Math.abs(chemin.width - PAGE_APPROUVEE.largeurUtilePt) < 0.6
      && chemin.height < 0.6)
    const verticales = chemins.filter((chemin) => chemin.kind === 'stroke'
      && Math.abs(chemin.height - 0) > 0.6
      && Math.abs(chemin.width) < 0.6
      && chemin.height >= 250)
    expect(horizontales.length).toBeGreaterThanOrEqual(2)
    expect(verticales.length).toBeGreaterThanOrEqual(2)
    // The approved header rule is the live `.page-heading` border, at y = 51 pt.
    const filet = horizontales.find((chemin) => Math.abs(chemin.y - PAGE_APPROUVEE.filetEnTetePt) < 1)
    expect(filet).toBeTruthy()
    expect(couleurProche(filet!.colour!, PALETTE_PDF.marginSoft)).toBe(true)
    // No full-height *red margin* rule (the rejected prototype chrome).
    const rouges = chemins.filter((chemin) => chemin.kind === 'stroke'
      && chemin.height > 700 && chemin.width < 1.2
      && chemin.colour === PALETTE_PDF.margin)
    expect(rouges).toEqual([])
  })

  it('applique l’espacement source des tableaux (24 / 20 / 12 px)', async () => {
    const { lecture } = await generer(capturePdfFixture('aedar-access'))
    const valeurs = lecture.textes.find((item) => item.str.startsWith('Valeurs des graphiques'))!
    const yValeurs = haut(valeurs)
    const legende = lecture.textes.find((item) => item.str === 'Voiture'
      && Math.abs(item.taille - ptDepuisCssPx(12)) < 0.05 && haut(item) < yValeurs)!
    expect(yValeurs - haut(legende)).toBeGreaterThanOrEqual(10)
    const titres = lecture.textes
      .filter((item) => item.taille >= 7.5 && haut(item) > yValeurs
        && /accessibles|Diversité/.test(item.str))
      .sort((a, b) => haut(a) - haut(b))
    expect(titres.length).toBeGreaterThanOrEqual(2)
    const precedent = lecture.textes
      .filter((item) => haut(item) < haut(titres[1]!) - 0.4)
      .reduce((max, item) => Math.max(max, haut(item) + item.taille * 0.75), 0)
    expect(haut(titres[1]!) - precedent).toBeGreaterThanOrEqual(10)
  })

  it('imprime le rang servi dans une colonne Rang explicite, jamais en micro-ligne', async () => {
    const { lecture } = await generer(captureExplorerRangs())
    // Two value tables: volume ramp + decile distribution.
    const titres = lecture.textes.filter((item) => item.taille >= 7.5
      && item.str.startsWith('Établissements accessibles'))
    expect(titres.length).toBeGreaterThanOrEqual(2)
    // Approved shape B for this fixture: two visible modes × two tables, so
    // one explicit `Rang` header per legend-key group.
    const rangs = lecture.textes.filter((item) => item.str === 'Rang')
    expect(rangs).toHaveLength(4)
    expect(lecture.texteComplet).toContain('=1er/43')
    // The served rank has its own cell: same row as the compared value and to
    // its right, not a second line under the number.
    const rang = lecture.textes.find((item) => item.str === '=1er/43')!
    const valeurs = lecture.textes.filter((item) => item.y === rang.y && item.x < rang.x
      && /^\d+([.,]\d+)?$/.test(item.str))
    expect(valeurs.length).toBeGreaterThan(0)
    expect(rang.x).toBeGreaterThan(Math.max(...valeurs.map((item) => item.x)))
    // No rank text sits inside the value cell's own line box.
    const memeLigne = lecture.textes.filter((item) => item.y === rang.y)
    expect(memeLigne.every((item) => item.str !== 'Indisponible' || item.x !== rang.x)).toBe(true)
  })

  it('garde une terminaison compacte et une continuation sans réduction globale', async () => {
    const base = captureExplorerRangs()
    const compact = await generer(base, [base.capabilities.selectableSeries[0]!.id])
    expect(compact.lecture.pages).toBe(1)
    // The dense two-table document is the measured continuation: both value
    // tables continue with complete rows, ranks and repeated identity/sources.
    const dense = captureProfilRangsDense()
    const continuation = await generer(dense)
    expect(continuation.lecture.pages).toBeGreaterThanOrEqual(2)
    // Same role size on both pages (no whole-document shrink).
    const tailles = new Set(
      continuation.lecture.textes
        .filter((item) => item.str === 'COMMUNE A1')
        .map((item) => item.taille.toFixed(2)),
    )
    expect(tailles.size).toBe(1)
    for (let page = 1; page <= continuation.lecture.pages; page += 1) {
      const textePage = continuation.lecture.lignes
        .filter((ligne) => ligne.page === page).map((ligne) => ligne.texte).join(' ')
      expect(textePage).toContain('COMMUNE A1')
      expect(textePage).toContain('Source(s) :')
    }
  })
})
