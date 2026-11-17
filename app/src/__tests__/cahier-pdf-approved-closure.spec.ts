/**
 * #1024 closure checks, calibrated on the approved generating source and on
 * R1–R3. Each assertion names the fact it protects; none reads a previous
 * output of the composer.
 */
import { describe, expect, it } from 'vitest'
import { jsPDF } from 'jspdf'

import { composerCahierPdf } from '@/fiche/prototype/cahierPdfComposer'
import { POLICES_PDF } from '@/fiche/prototype/cahierPdfFonts'
import {
  LARGEUR_CORPS_PT,
  PAGE_APPROUVEE,
  PADDING_SECTION_PT,
  ROLE_PDF,
  ptDepuisCssPx,
} from '@/fiche/prototype/cahierPdfGrammaire'
import { construireTableauxPdf, CahierPdfTableLayoutError } from '@/fiche/prototype/cahierPdfTableau'
import type { MesureTexte } from '@/fiche/prototype/cahierPdfMesure'
import { projeterRequeteExport } from '@/fiche/prototype/cahierExportCapture'
import type { CahierExportCapture } from '@/fiche/prototype/cahierExportCapture'
import { projeterRequeteExportFigures } from '@/fiche/prototype/cahierExportAdapters'
import {
  chargeurImageTest,
  chargeurPoliceTest,
  cheminsPdf,
  epaisseursTraitPdf,
  lirePdf,
  occurrences,
  type LecturePdf,
} from './helpers/cahierPdfRuntime'
import {
  captureExplorerRangs,
  capturePdfFixture,
  captureProfilRangsDense,
  captureRampeRangs,
} from './helpers/cahierPdfFixtures'

const ptMm = (pt: number) => pt * 25.4 / 72
const CORPS_PT = LARGEUR_CORPS_PT
const CORPS_X_PT = PAGE_APPROUVEE.insetGauchePt + PADDING_SECTION_PT
const PAIRE_PT = (CORPS_PT - ptDepuisCssPx(24)) / 2
const GAP_PT = ptDepuisCssPx(24)

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
  const artifact = await composerCahierPdf(projection.request, options())
  return lirePdf(artifact.blob)
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

describe('clôture #1024 — sous-titre, tables appairées, rail mesuré, notes', () => {
  it('peint l’espace explicite du préfixe de comparaison sur la même ligne de base', async () => {
    const lecture = await generer(captureExplorerRangs())
    const prefixe = lecture.textes.find((item) => item.str === 'Groupe comparé :')
    expect(prefixe, 'le préfixe approuvé est peint').toBeTruthy()
    const espace = lecture.textes.find((item) => item.str === ' '
      && Math.abs(item.y - prefixe!.y) < 0.01
      && item.x >= prefixe!.x + prefixe!.largeur - 0.01)
    expect(espace, 'un espace explicite est peint dans la face du préfixe').toBeTruthy()
    const nom = lecture.textes.find((item) => item.str === 'EPCI X')!
    // The painted space advance separates the runs; the name starts exactly at
    // the space's right edge like R2.
    expect(Math.abs(nom.x - (espace!.x + espace!.largeur))).toBeLessThan(0.02)
    expect(Math.abs(nom.y - prefixe!.y)).toBeLessThan(0.01)
    expect(nom.taille).toBeCloseTo(13.5, 2)
    // One explicit space only; the text is not double-spaced.
    expect(lecture.texteComplet).toContain('Groupe comparé : EPCI X')
    expect(lecture.texteComplet).not.toContain('Groupe comparé :  EPCI X')
  })

  it('apparie les deux tables d’accès sur la grille source (24 px, deux colonnes égales)', async () => {
    const lecture = await generer(capturePdfFixture('aedar-access'))
    const temps = lecture.textes.filter((item) => item.str === 'Temps'
      && Math.abs(item.taille - ROLE_PDF.enteteTableauMode.taille) < 0.02
      && item.page === 1)
    expect(temps).toHaveLength(2)
    // Same row, and the second table starts after one half column + the native
    // 24 px gap (the source `display:grid; grid-template-columns:repeat(2…)`).
    expect(Math.abs(temps[0]!.y - temps[1]!.y)).toBeLessThan(0.02)
    expect(Math.abs((temps[1]!.x - temps[0]!.x) - (PAIRE_PT + GAP_PT))).toBeLessThan(0.4)
    // Both table captions share one baseline and the heading is plural.
    const heading = lecture.textes.find((item) => item.str === 'Valeurs des graphiques')!
    const titres = lecture.textes.filter((item) => item.y < heading.y
      && Math.abs(item.taille - ROLE_PDF.titreTableau.taille) < 0.02
      && (item.str.startsWith('Diversité de l’offre') || item.str.startsWith('Établissements accessibles')))
    expect(titres).toHaveLength(2)
    expect(Math.abs(titres[0]!.y - titres[1]!.y)).toBeLessThan(0.02)
    expect(lecture.texteComplet).toContain('Valeurs des graphiques')
    // The caption/table geometry is the approved page box, not a per-section
    // full-width stack: the left table starts at the section body inset.
    expect(Math.abs(temps[0]!.x - (CORPS_X_PT + 1))).toBeLessThan(2.5)
  })

  it('choisit une continuation mesurée plutôt que de réduire un nombre dans une demi-colonne', async () => {
    const mesure = await mesureMm()
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

  it('élargit le rail avec la face embarquée et ne croise jamais titre et graduations', async () => {
    const lecture = await generer(captureRampeRangs())
    const ticks = lecture.textes.filter((item) => Math.abs(item.taille - ROLE_PDF.tick.taille) < 0.05
      && /établissements|types/.test(item.str))
    expect(ticks.length).toBeGreaterThan(0)
    const quarante = ticks.find((item) => item.str === '40 établissements')!
    expect(quarante).toBeTruthy()
    const titres = lecture.textes.filter((item) => Math.abs(item.rotation) > 1.4
      && item.largeur > 40 && item.taille < 6.4)
    expect(titres.length).toBe(2)
    // Panel 2 of the access figure: two equal panels with the painter's 6 mm gap.
    const gapPt = 6 * 72 / 25.4
    const panelWidth = (CORPS_PT - gapPt) / 2
    const panelX = CORPS_X_PT + panelWidth + gapPt
    const titre = titres.find((item) => item.x > panelX)!
    const rail = quarante.x + quarante.largeur - panelX
    // The rail grew beyond the native 64-unit base because the measured label
    // needs it; it never exceeds the native maximum rail.
    expect(rail).toBeGreaterThan(64 * panelWidth / 640 + 5)
    expect(rail).toBeLessThanOrEqual(452 * panelWidth / 640 + 0.6)
    // The title's rotated baseline sits on the title lane; the tick labels start
    // at least the native label gap to its right.
    expect(titre.x - panelX).toBeCloseTo(16 * panelWidth / 640, 2)
    expect(quarante.x).toBeGreaterThan(titre.x + 4 * panelWidth / 640)
  })

  it('peint le séparateur de mode à la largeur CSS native (1 px), pas 0,2 pt', async () => {
    const lecture = await generer(captureExplorerRangs())
    const heading = lecture.textes.find((item) => item.str === 'Valeurs des graphiques')!
    const hautTableaux = PAGE_APPROUVEE.hauteurPt - heading.y
    const chemins = await cheminsPdf(lecture.octets, 1)
    // Vertical rules inside the table block only (below the heading): the two
    // legend-key boundaries of this two-table fixture.
    const separateurs = chemins.filter((chemin) => chemin.kind === 'stroke'
      && chemin.width < 0.5 && chemin.height > 10 && chemin.y > hautTableaux)
    expect(separateurs.length).toBeGreaterThanOrEqual(2)
    for (const separateur of separateurs) {
      expect(separateur.largeur).not.toBeNull()
      expect(Math.abs(separateur.largeur! - ptDepuisCssPx(1))).toBeLessThan(0.01)
    }
    // And the generic operator list carries the native width, not 0,2 pt/mm.
    const epaisseurs = await epaisseursTraitPdf(lecture.octets, 0)
    expect(epaisseurs.some((value) => Math.abs(value - ptDepuisCssPx(1)) < 0.01)).toBe(true)
  })

  it('marque ¹ une seule fois par cellule comparée, même quand l’en-tête est plié', async () => {
    const lecture = await generer(captureRampeRangs())
    // The paired flat header wraps `Groupe comparé` in two lines; the mark is
    // appended once to the last line, with the approved flat space (`comparé ¹`).
    expect(lecture.texteComplet).toContain('Groupe')
    expect(lecture.texteComplet).toContain('comparé ¹')
    expect(lecture.texteComplet).not.toContain('Groupe¹')
    expect(lecture.texteComplet).not.toContain('¹comparé')
    // Real in-document link to the page footer, two compared cells → two links.
    const liensInternes = lecture.annotations.filter((annotation) => annotation.dest !== undefined)
    expect(liensInternes).toHaveLength(2)
    for (const lien of liensInternes) {
      const dest = lien.dest as [{ num: number }, { name: string }, number, number, number]
      expect(dest[1].name).toBe('XYZ')
      expect(dest[3]).toBeCloseTo(38, 1)
    }
    // The footer the link targets is the served comparison sentence.
    expect(occurrences(lecture, '¹ Groupe comparé : communes de EPCI X')).toBe(1)
  })

  it('rend le cas groupé à trois modes (neuf colonnes) et un ¹ par groupe', async () => {
    const capture = captureExplorerRangs()
    const modes = ['car', 'bike_lts2', 'transit']
    const lecture = await generer(capture, modes)
    // Two tables × three groups → six compared cells and six marks/links.
    expect(lecture.textes.filter((item) => item.str === 'Groupe¹')).toHaveLength(6)
    expect(lecture.annotations.filter((annotation) => annotation.dest !== undefined)).toHaveLength(6)
    // Nine value columns under the row dimension of each table.
    const minimum = lecture.textes.find((item) => item.str === 'Minimum')!
    const valeurs = lecture.textes.filter((item) => Math.abs(item.y - minimum.y) < 1.2
      && item.x > minimum.x + 4).map((item) => item.str).filter((value) => value.trim().length > 0)
    expect(valeurs).toHaveLength(9)
    // The distribution groups follow the visible ramp order (approved
    // `orderedBars`): Voiture, Vélo (LTS2), Transports en commun.
    const groupes = lecture.textes.filter((item) => ['Voiture', 'Vélo (LTS2)', 'Transports en commun']
      .includes(item.str) && Math.abs(item.taille - ROLE_PDF.enteteTableauMode.taille) < 0.02)
    expect(groupes).toHaveLength(6)
    const auDessus = groupes.filter((item) => item.y > minimum.y)
    const yGroupeDistribution = Math.min(...auDessus.map((item) => item.y))
    const distribution = auDessus.filter((item) => Math.abs(item.y - yGroupeDistribution) < 0.5)
      .sort((a, b) => a.x - b.x)
    expect(distribution.map((item) => item.str)).toEqual(['Voiture', 'Vélo (LTS2)', 'Transports en commun'])
  })

  it('mesure les en-têtes de groupe longs et augmente la hauteur, sans débordement', async () => {
    const mesure = await mesureMm()
    const parts = construireTableauxPdf({
      key: 'large-group',
      title: 'Tableau groupé',
      rowHeader: 'Statistique',
      columns: [
        { key: 'a', label: 'Territoire', unit: null, kind: 'focal', seriesKey: 'a', groupLabel: 'Transports en commun et marche', groupColor: '#a94562' },
        { key: 'b', label: 'Groupe comparé', unit: null, kind: 'comparison', seriesKey: 'a', groupLabel: 'Transports en commun et marche', groupColor: '#a94562' },
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
    }, { mesure, largeurDisponible: 60, nomTerritoire: null })
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

  it('abandonne le mot plein seulement quand la largeur mesurée le refuse, avec une seule explication', async () => {
    const access = await generer(capturePdfFixture('aedar-access'))
    expect(access.texteComplet).toContain('Indisp.')
    expect(occurrences(access, 'Indisp. : valeur indisponible.')).toBe(1)
    // A full-width grouped table keeps the earned full word: no global shrink.
    const explorer = await generer(capturePdfFixture('aedar-equipment-explorer'))
    expect(explorer.texteComplet).toContain('Indisponible')
    expect(explorer.texteComplet).not.toContain('Indisp. :')
  })

  it('compte la continuation par identité de table et par page, pas sur tous les titres', async () => {
    const lecture = await generer(captureProfilRangsDense())
    expect(lecture.pages).toBeGreaterThanOrEqual(2)
    const heading = lecture.textes.find((item) => item.page === 1
      && item.str === 'Valeurs du graphique')!
    for (let page = 1; page <= lecture.pages; page += 1) {
      const textesPage = lecture.lignes.filter((ligne) => ligne.page === page)
        .map((ligne) => ligne.texte).join(' ').replace(/[’']/g, "'")
      // Exactly one table caption per page part. On page 1 the figure title
      // carries the same wording; the gate counts the caption below the value
      // heading, never every matching run on the page.
      const captions = lecture.textes.filter((item) => item.page === page
        && item.str.replace(/[’']/g, "'").startsWith("Types d'équipements par premier mode")
        && Math.abs(item.taille - ROLE_PDF.titreTableau.taille) < 0.02
        && (page > 1 || item.y < heading.y))
      expect(captions).toHaveLength(1)
      // …and exactly one continuation marker per continued part.
      expect(textesPage.split('(suite)').length - 1).toBe(page === 1 ? 0 : 1)
    }
    // Every complete row is printed exactly once across the parts.
    for (const label of ['Équipement 1 (T001)', 'Équipement 20 (T020)', 'Équipement 40 (T040)']) {
      expect(occurrences(lecture, label)).toBe(1)
    }
  })
})

function projeterTables(request: Parameters<typeof projeterRequeteExportFigures>[0]) {
  return projeterRequeteExportFigures(request).flatMap((projection) => projection.tables)
}
