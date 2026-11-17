/**
 * #1024 post-review contract closure.
 *
 * Each check is calibrated on the approved generating source (`desktop.js`,
 * the mounted SFC roles) or on R1/R3 — never on a previous output of this
 * composer. The suite covers the three reachable flat access states, the
 * compared-bars header/row dimension, one `¹` per served compared cell even
 * when the table has no row dimension, the profile's per-legend-key separators,
 * and the explorer's captured horizon caption.
 */
import { describe, expect, it } from 'vitest'
import { jsPDF } from 'jspdf'

import { composerCahierPdf } from '@/fiche/prototype/cahierPdfComposer'
import { POLICES_PDF } from '@/fiche/prototype/cahierPdfFonts'
import { ROLE_PDF, LARGEUR_CORPS_PT, PAGE_APPROUVEE, ptDepuisCssPx } from '@/fiche/prototype/cahierPdfGrammaire'
import { construireTableauxPdf } from '@/fiche/prototype/cahierPdfTableau'
import type { MesureTexte } from '@/fiche/prototype/cahierPdfMesure'
import { projeterRequeteExport } from '@/fiche/prototype/cahierExportCapture'
import type { CahierExportCapture } from '@/fiche/prototype/cahierExportCapture'
import { projeterRequeteExportFigures } from '@/fiche/prototype/cahierExportAdapters'
import {
  chargeurImageTest,
  chargeurPoliceTest,
  cheminsPdf,
  lirePdf,
  occurrences,
  type LecturePdf,
} from './helpers/cahierPdfRuntime'
import {
  captureBarresDense,
  captureExplorerRangs,
  capturePartDense,
  capturePdfFixture,
  captureWaffleDense,
} from './helpers/cahierPdfFixtures'

const PAIRE_PT = (LARGEUR_CORPS_PT - ptDepuisCssPx(24)) / 2

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

async function parties(capture: CahierExportCapture) {
  const request = (() => {
    const offered = capture.capabilities.selectableSeries.map((serie) => serie.id)
    const projection = projeterRequeteExport(capture, offered.slice(0, 3))
    if (projection.status !== 'ready') throw new Error(projection.reason)
    return projection.request
  })()
  const mesure = await mesureMm()
  const parts = projeterRequeteExportFigures(request).flatMap((projection) => projection.tables.flatMap(
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
  it('n’ajoute aucune bande de groupe vide au tableau plat (écart R1 16,24 pt)', async () => {
    const capture = capturePdfFixture('aedar-access')
    const { parts } = await parties(capture)
    for (const part of parts) {
      expect(part.layout).toBe('flat')
      expect(part.groupHeaderHeight).toBe(0)
      // The header box is exactly the measured header cells: no folded mode line.
      expect(part.headerHeight).toBe(Math.max(...part.columns.map((column) => column.headerHeight)))
    }
    const lecture = await generer(capture)
    const temps = lecture.textes
      .filter((item) => item.str === 'Temps' && Math.abs(item.taille - ROLE_PDF.enteteTableauMode.taille) < 0.02)
      .sort((a, b) => a.x - b.x)[0]!
    const premiereLigne = lecture.textes
      .filter((item) => item.str === '5 min'
        && Math.abs(item.taille - ROLE_PDF.enteteTableauMode.taille) < 0.02
        && item.page === 1
        && item.x >= temps.x - 2
        && item.x < temps.x + PAIRE_PT)
      // PDF y grows upward: the first data row is the highest y below the header.
      .sort((a, b) => b.y - a.y)[0]!
    const entetes = lecture.textes.filter((item) => item.page === 1
      && Math.abs(item.taille - ROLE_PDF.enteteTableauMode.taille) < 0.02
      && item.str !== '(suite)'
      && item.x >= temps.x - 2 && item.x < temps.x + PAIRE_PT
      && item.y > premiereLigne.y && item.y <= temps.y + 0.5)
    const derniereEntete = Math.min(...entetes.map((item) => item.y))
    // R1 measures 16.24 pt between the last header baseline and the first row;
    // the wrapped-header line advance explains the 0.3 pt residual.
    expect(Math.abs(derniereEntete - premiereLigne.y - 16.24)).toBeLessThan(0.5)
  })

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

  it('peint réellement les deux états du tableau d’accès (3 et 5 colonnes)', async () => {
    const withComparison = await generer(capturePdfFixture('aedar-access'))
    expect(withComparison.textes.filter((item) => item.str === 'Groupe')).toHaveLength(2)
    expect(withComparison.textes.filter((item) => item.str === 'comparé')).toHaveLength(2)
    expect(withComparison.textes.filter((item) => item.str === 'Rang')).toHaveLength(2)

    const withoutComparison = await generer(capturePdfFixture('aedar-access', { publications: [] }))
    expect(withoutComparison.textes.filter((item) => item.str === 'Groupe')).toHaveLength(0)
    expect(withoutComparison.textes.filter((item) => item.str === 'Rang')).toHaveLength(0)
    const temps = withoutComparison.textes.filter((item) => item.str === 'Temps').sort((a, b) => a.x - b.x)[0]!
    const mode = withoutComparison.textes.filter((item) => item.str === 'Mode').sort((a, b) => a.x - b.x)[0]!
    const territoire = withoutComparison.textes
      .filter((item) => item.page === 1
        && Math.abs(item.taille - ROLE_PDF.enteteTableauMode.taille) < 0.02
        && Math.abs(item.y - temps.y) < 0.02
        && item.x > mode.x + 5
        && item.x < temps.x + PAIRE_PT
        && item.str.trim().length > 0)
      .sort((a, b) => a.x - b.x)[0]!
    // Header text starts at its column + 1 pt; the source colgroup is 18/46/36.
    expect((mode.x - temps.x) / PAIRE_PT).toBeCloseTo(0.18, 2)
    expect((territoire.x - mode.x) / PAIRE_PT).toBeCloseTo(0.46, 2)
    expect((PAIRE_PT - (territoire.x - temps.x)) / PAIRE_PT).toBeCloseTo(0.36, 2)
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

  it('place le territoire focal et le titre de dimension des barres dans leurs colonnes', async () => {
    const capture = captureBarresDense()
    const { request } = await parties(capture)
    const bars = projeterRequeteExportFigures(request).find((projection) => projection.family === 'mobilite-bars')!
    const table = bars.tables[0]!
    expect(table.rowHeader).toBe('Type de stationnement')
    expect(table.columns[0]!.label).toBe(capture.identity.territory.name)
    // The axis title never takes the focal value column.
    expect(table.columns.map((column) => column.label)).not.toContain('Type de stationnement')

    const lecture = await generer(capture)
    const titre = lecture.textes.find((item) => item.str === 'Type de stationnement'
      && Math.abs(item.taille - ROLE_PDF.enteteTableauMode.taille) < 0.02)
    expect(titre, 'le titre de dimension est peint au-dessus des libellés de ligne').toBeTruthy()
    const territoire = lecture.textes
      .filter((item) => item.str === capture.identity.territory.name
        && Math.abs(item.taille - ROLE_PDF.enteteTableauMode.taille) < 0.02)
      .sort((a, b) => a.x - b.x)[0]!
    expect(titre!.x).toBeLessThan(territoire.x)
    // A category total row is not printed twice in the same label.
    expect(occurrences(lecture, 'Réseau piéton — Réseau piéton')).toBe(0)
    expect(lecture.textes.filter((item) => item.str === 'Réseau piéton').length).toBeGreaterThan(0)
  })

  it('marque ¹ une fois par cellule comparée servie, même sans en-tête de ligne', async () => {
    // The coverage-share table has no row dimension, but its compared cell is
    // served: the mark/link policy must depend on the proof, not on rowHeader.
    const lecture = await generer(capturePartDense())
    const marques = lecture.textes.filter((item) => item.str.endsWith('¹')
      && Math.abs(item.taille - ROLE_PDF.enteteTableauMode.taille) < 0.02)
    expect(marques).toHaveLength(1)
    const liens = lecture.annotations.filter((annotation) => annotation.dest !== undefined)
    expect(liens).toHaveLength(1)
    expect(occurrences(lecture, '¹ Groupe comparé :')).toBe(1)
  })

  it('peint un séparateur vertical par clé de légende du profil', async () => {
    const capture = captureWaffleDense()
    const { parts } = await parties(capture)
    const profile = parts[0]!
    const modes = profile.columns.length
    expect(modes).toBeGreaterThan(1)
    expect(profile.columns.map((column) => column.separatorBefore))
      .toEqual(Array.from({ length: modes }, (_, index) => index > 0))

    const lecture = await generer(capture)
    const heading = lecture.textes.find((item) => item.str === 'Valeurs du graphique')!
    const hautTableaux = PAGE_APPROUVEE.hauteurPt - heading.y
    const chemins = await cheminsPdf(lecture.octets, 1)
    const separateurs = chemins.filter((chemin) => chemin.kind === 'stroke'
      && chemin.largeur !== null
      && Math.abs(chemin.largeur - ptDepuisCssPx(1)) < 0.01
      && chemin.height > 10
      && chemin.y > hautTableaux)
    expect(separateurs).toHaveLength(modes - 1)
  })

  it('affiche l’horizon capturé de l’explorateur, indépendamment des graduations', async () => {
    const capture = capturePdfFixture('aedar-equipment-explorer')
    const lecture = await generer(capture)
    const horizon = (capture.figures.find((figure) => figure.family === 'aedar-equipment-explorer') as unknown as {
      effective: { horizonMinutes: number }
    }).effective.horizonMinutes
    const libelle = lecture.textes.find((item) => item.str === 'TEMPS DE TRAJET'
      && Math.abs(item.taille - ROLE_PDF.axe.taille) < 0.02
      && Math.abs(item.rotation) < 0.01)!
    expect(libelle).toBeTruthy()
    const valeur = lecture.textes.find((item) => item.str === `${horizon} min`
      && Math.abs(item.taille - ROLE_PDF.axe.taille) < 0.02
      && Math.abs(item.y - libelle.y) < 0.02
      && item.x > libelle.x)!
    expect(valeur).toBeTruthy()
    // The caption sits above the two panel titles, never inside the tick row.
    const titrePanneau = lecture.textes
      .filter((item) => Math.abs(item.taille - ROLE_PDF.sousTitreFigure.taille) < 0.02)
      .sort((a, b) => a.y - b.y)[0]!
    expect(libelle.y).toBeGreaterThan(titrePanneau.y)
  })

  it('suit l’horizon déplacé de la source et garde la correspondance figure/table', async () => {
    const capture: any = structuredClone(captureExplorerRangs())
    const figure = capture.figures.find((candidate: any) => candidate.family === 'aedar-equipment-explorer')
    figure.effective.horizonMinutes = 10
    const fact = figure.model.facts.find((candidate: any) => candidate.typequ === figure.effective.typequ)
    for (const key of Object.keys(fact.measures)) {
      if (!key.startsWith('count_15_')) continue
      fact.measures[key.replace('count_15_', 'count_10_')] = fact.measures[key]
    }
    for (const cell of figure.effective.comparison.cells) {
      cell.measure = cell.measure.replace('count_15_', 'count_10_')
    }
    const lecture = await generer(capture)
    const libelle = lecture.textes.find((item) => item.str === 'TEMPS DE TRAJET'
      && Math.abs(item.taille - ROLE_PDF.axe.taille) < 0.02)!
    const valeur = lecture.textes.find((item) => item.str === '10 min'
      && Math.abs(item.taille - ROLE_PDF.axe.taille) < 0.02
      && Math.abs(item.y - libelle.y) < 0.02)!
    expect(valeur, 'l’horizon déplacé est lu depuis la capture, pas figé à 15').toBeTruthy()
    // The distribution table's first focal cell is the same frozen count_10
    // measure the adapted table carries (per-figure/table correspondence).
    const request = (() => {
      const offered = capture.capabilities.selectableSeries.map((serie: any) => serie.id)
      const projection = projeterRequeteExport(capture, offered.slice(0, 3))
      if (projection.status !== 'ready') throw new Error(projection.reason)
      return projection.request
    })()
    const distribution = projeterRequeteExportFigures(request)
      .find((projection) => projection.family === 'aedar-equipment-explorer')!.tables
      .find((table) => table.key === 'distribution')!
    const attendu = distribution.rows[0]!.cells[0]!.display
    const minimum = lecture.textes.find((item) => item.str === 'Minimum')!
    const ligne = lecture.textes.filter((item) => Math.abs(item.y - minimum.y) < 1.6
      && item.x > minimum.x + 2 && item.str.trim().length > 0).sort((a, b) => a.x - b.x)
    expect(ligne[0]!.str).toBe(attendu)
  })
})
