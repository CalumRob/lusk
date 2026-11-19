import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  composerCahierPdf,
} from '@/fiche/prototype/cahierPdfComposer'
import { MARQUE_LUSK_ERMINE, REMPLISSAGES_MARQUE_LUSK } from '@/components/luskBrandMark'
import { COULEUR_CYCLE_PARTAGE } from '@/fiche/prototype/cahierColorRoles'
import { sousTitreComparaison, texteSousTitre } from '@/fiche/prototype/cahierPdfComparaison'
import type { SousTitreComparaison } from '@/fiche/prototype/cahierPdfComparaison'
import { POLICES_PDF } from '@/fiche/prototype/cahierPdfFonts'
import { PALETTE_PDF } from '@/fiche/prototype/cahierPdfPalette'
import { couleurPdf } from '@/fiche/prototype/cahierPdfPalette'
import { ANCRAGES_THEMES, rolesRampesTheme } from '@/carte/couleurs'
import { construireTableauxPdf } from '@/fiche/prototype/cahierPdfTableau'
import {
  curveGeometry,
  curveSeriesPath,
  mobiliteBarGeometry,
  mobiliteBarScale,
  rampScale,
  shareFillPercent,
} from '@/fiche/prototype/cahierFigureNativeGeometry'
import { visibleGroupedBarSeries } from '@/fiche/prototype/cahierFigureReadings'
import type { CahierTableColumn, CahierTableRow } from '@/fiche/prototype/cahierExportAdapters'
import type { CahierCaptureComparison } from '@/fiche/prototype/cahierExportCapture'
import type { MesureTexte } from '@/fiche/prototype/cahierPdfMesure'
import type { CahierExportRequest } from '@/fiche/prototype/cahierExportCapture'
import { projeterRequeteExport } from '@/fiche/prototype/cahierExportCapture'
import { projeterCaptureExportFigures } from '@/fiche/prototype/cahierExportAdapters'
import { TABLEAU_TEMPS_LABEL } from '@/fiche/content/cahierTableauWording'
import {
  chargeurPoliceTest,
  contientTout,
  enregistrerArtefact,
  lirePdf,
  occurrences,
  policesEmbarquees,
  requetePour,
  toutesLesRequetes,
  verifierDansPage,
  verifierCollisions,
  verifierAlphaTexte,
  couleursRemplissage,
} from './helpers/cahierPdfRuntime'
import { communeMembers } from './helpers/cahierExportFixtures'
import {
  capturePdfFixture, captureCourbeTrous, captureCourbeDense, capturePartDense,
  captureRampeDense, captureBarresDense, captureBarresContinuation,
} from './helpers/cahierPdfFixtures'
import type { LecturePdf } from './helpers/cahierPdfRuntime'

const signal = () => new AbortController().signal

function options() {
  return {
    signal: signal(),
    chargerPolice: chargeurPoliceTest,
    urlPublique: 'https://lusk.test/territoire/commune/22001?theme=mobilite#section-aedar-access',
    urlAccueil: 'https://lusk.test/',
  }
}

function requeteSansMode(capture: CahierExportRequest['capture']): CahierExportRequest {
  const projection = projeterRequeteExport(capture, [])
  if (projection.status !== 'ready') throw new Error(projection.reason)
  return projection.request
}

function requeteAvecModes(capture: CahierExportRequest['capture']): CahierExportRequest {
  const modes = capture.capabilities.selectableSeries.slice(0, 3).map((serie) => serie.id)
  const projection = projeterRequeteExport(capture, modes)
  if (projection.status !== 'ready') throw new Error(projection.reason)
  return projection.request
}

async function generer(request: CahierExportRequest, nom: string) {
  const avant = process.memoryUsage().heapUsed
  const debut = performance.now()
  const artifact = await composerCahierPdf(request, options())
  const duree = performance.now() - debut
  const lecture = await lirePdf(artifact.blob)
  enregistrerArtefact(nom, lecture.octets)
  if (process.env.CAHIER_PDF_REPORT) {
    const delta = process.memoryUsage().heapUsed - avant
    console.log(nom, 'pages', lecture.pages, 'bytes', artifact.blob.size, 'ms', Math.round(duree), 'heapDelta', delta)
  }
  return { artifact, lecture, duree }
}

/** Independent literal audit. A wrong number/column/group throws. */
function auditerTexte(lecture: LecturePdf, attendu: readonly string[]): void {
  for (const valeur of attendu) {
    if (!lecture.texteComplet.includes(valeur)) {
      throw new Error(`Audit PDF : « ${valeur} » absent.`)
    }
  }
}

describe('compositeur PDF Cahier — matrice des neuf sections', () => {
  it('génère un vrai fichier A4 pour chaque section et famille', async () => {
    const resultats: { key: string; lecture: LecturePdf; taille: number }[] = []
    for (const { key, request } of toutesLesRequetes()) {
      const { artifact, lecture } = await generer(request, `${key}.pdf`)
      expect(artifact.fileName).toBe(`lusk-cahier-${key}-22001.pdf`)
      expect(artifact.blob.size).toBeGreaterThan(20_000)
      expect(lecture.pages).toBeGreaterThanOrEqual(1)
      for (const format of lecture.pagesFormat) {
        expect(format.width).toBeCloseTo(595.28, 1)
        expect(format.height).toBeCloseTo(841.89, 1)
      }
      // The document embeds only the faces its roles use (putOnlyUsedFonts);
      // a short section legitimately uses five of the six role faces.
      expect(await policesEmbarquees(lecture.octets)).toBeGreaterThanOrEqual(5)
      verifierDansPage(lecture)
      verifierCollisions(lecture)
      await verifierAlphaTexte(lecture.octets)
      expect(lecture.metadonnees.author).toBe('Lusk')
      expect(lecture.metadonnees.title).toContain('Commune A1')
      expect(lecture.liens).toContain('https://lusk.test/')
      resultats.push({ key, lecture, taille: artifact.blob.size })
    }
    expect(resultats.map((resultat) => resultat.key)).toEqual([
      'aedar-car-overview',
      'aedar-diversity-loss',
      'aedar-access',
      'aedar-equipment-profile',
      'aedar-equipment-explorer',
      'reseaux',
      'stationnement-ravitaillement',
      'couverture-du-territoire',
      'visiter-la-bretagne',
    ])
  })
})

describe('compositeur PDF Cahier — faits, tableaux et provenance', () => {

  it('audite les barres comparées et rangs de réseaux, page par page', async () => {
    // Dense stand-in matching the real section's table density: its value table
    // continues onto the last page, which must repeat the title and identity.
    const captureDense = captureBarresContinuation()
    const projectionDense = projeterRequeteExport(captureDense, [])
    if (projectionDense.status !== 'ready') throw new Error(projectionDense.reason)
    const { lecture } = await generer(projectionDense.request, 'audit-reseaux.pdf')
    expect(lecture.pages).toBeGreaterThanOrEqual(1)
    contientTout(lecture, [
      'Le partage de l’espace public',
      'Longueur du réseau par habitant',
      '10,93',
      '11,54',
      '2e/2',
      '0,01',
      '1er/2',
      '134,8',
      '84,58',
      'Réseau piéton',
      'Réseau cyclable',
      'Réseau automobile',
      'Groupe comparé',
      '¹ Groupe comparé : Médiane des communes de EPCI X',
      'Source(s) : OpenStreetMap',
    ])
    // Rank text is a second line under its value; the row stays one table row.
    expect(lecture.lignes.some((candidate) => candidate.texte.includes('2e/2'))).toBe(true)
    // The dense fixture must actually continue onto a second page, like the
    // real section: that continuation repeats the table title and identity.
    expect(lecture.pages).toBeGreaterThan(1)
    const pageDerniere = lecture.lignes.filter((ligne) => ligne.page === lecture.pages).map((ligne) => ligne.texte).join(' ')
    contientTout({ ...lecture, texteComplet: pageDerniere } as LecturePdf, [
      'COMMUNE A1',
      'Longueur du réseau par habitant',
      'Groupe comparé',
      'Source(s) : OpenStreetMap',
      `${lecture.pages} / ${lecture.pages}`,
    ])
    // Every page that carries comparative proof carries the footer, with the
    // owner's actual comparison sentence (its statistic AND its cohort, once).
    // The note is page-local: a page carries it exactly once when that page
    // actually shows comparative proof (native body or compared table cells).
    const note = '¹ Groupe comparé : Médiane des communes de EPCI X'
    expect(occurrences(lecture, note)).toBeGreaterThanOrEqual(1)
    for (let page = 1; page <= lecture.pages; page += 1) {
      const pageText = lecture.lignes.filter((ligne) => ligne.page === page).map((ligne) => ligne.texte).join(' ')
      expect(pageText.split(note).length - 1).toBeLessThanOrEqual(1)
    }
    expect(lecture.texteComplet).not.toContain('Médiane des communes de EPCI X — communes de EPCI X')
    // No row is cut: the six native rows appear once across the two pages, and
    // a category total is not joined to itself.
    for (const label of [
      'Réseau piéton — Longueur brute — à pied (valeur brute)',
      'Réseau cyclable — Total vélo',
      'Réseau cyclable — Longueur brute — à vélo (valeur brute)',
      'Réseau automobile — Longueur brute — en voiture (valeur brute)',
    ]) {
      expect(occurrences(lecture, label)).toBe(1)
    }
    expect(lecture.textes.filter((item) => item.str === 'Réseau piéton')).toHaveLength(1)
    expect(lecture.textes.filter((item) => item.str === 'Réseau automobile')).toHaveLength(1)
    expect(lecture.texteComplet).not.toContain('Réseau piéton — Réseau piéton')
    expect(lecture.texteComplet).not.toContain('Réseau automobile — Réseau automobile')
    // Cell font size is identical on both pages: no global document shrink.
    const tailles = new Set(
      lecture.textes
        .filter((item) => ['10,93', '0,01', '134,8'].includes(item.str))
        .map((item) => item.taille.toFixed(2)),
    )
    expect(tailles.size).toBe(1)
  })

  it('imprime les catégories publiées en lignes, sans abréger un mot qui tient', async () => {
    const { lecture } = await generer(requetePour('aedar-equipment-explorer'), 'audit-explorer.pdf')
    // Approved shape B: the row dimension is the published statistic label,
    // never the short axis tick (`D1`) and never a mode.
    for (const label of ['Minimum', 'Décile 1', 'Décile 9', 'Maximum']) {
      expect(lecture.texteComplet).toContain(label)
    }
    // The grouped columns are wide enough for the full word: no abbreviation
    // is invented, and no explanation note appears.
    expect(lecture.texteComplet).toContain('Indisponible')
    expect(lecture.texteComplet).not.toContain('Indisp. :')
  })

  it('garde le groupe comparé conditionnel à la preuve réellement servie', async () => {
    const { lecture } = await generer(requetePour('couverture-du-territoire'), 'audit-share.pdf')
    // The fixture's comparison value is explicitly unavailable; the group
    // footer must not claim comparative proof.
    expect(lecture.lignes.some((ligne) => ligne.texte.startsWith('¹ Groupe comparé :'))).toBe(false)
    contientTout(lecture, [
      'Part des bâtiments près d’un arrêt (à 500 m)',
      'Valeurs du graphique',
      '0,0 %',
      'Indisponible',
      'Aucun repère de groupe comparé disponible pour cette sélection.',
    ])
  })



  it('génère une carte à partir des octets figés dans la capture, sans nouvel appel réseau', async () => {
    const artifact = await composerCahierPdf(requetePour('aedar-car-overview'), {
      ...options(),
    })
    const lecture = await lirePdf(artifact.blob)
    expect(lecture.pages).toBe(1)
    expect(artifact.blob.size).toBeGreaterThan(40_000)
    verifierDansPage(lecture)
  })

  it('mesure une sélection personnalisée triée en français dans un vrai PDF', async () => {
    const capture = capturePdfFixture('visiter-la-bretagne', {
      selection: { etat: 'membres', membres: communeMembers() },
    })
    const projection = requeteSansMode(capture)
    const { lecture } = await generer(projection, 'selection-personnalisee.pdf')
    expect(lecture.texteComplet).toContain('Groupe comparé :')
    expect(lecture.texteComplet).toContain('COMMUNE A1, COMMUNE B, COMMUNE D')
    expect(lecture.texteComplet).not.toContain('ET 1 AUTRE')
    expect(lecture.texteComplet).not.toContain('SÉLECTION DE')
  })


})

describe('scènes natives peuplées — géométrie partagée écran/PDF', () => {

  it('garde l’en-tête « Temps » de la courbe à trous sur chaque page, avec ses valeurs', async () => {
    const capture = captureCourbeTrous()
    const [projection] = projeterCaptureExportFigures(capture)
    expect(projection!.tables[0]!.rowHeader).toBe(TABLEAU_TEMPS_LABEL)
    const { lecture } = await generer(requeteSansMode(capture), 'dense-curve-gaps.pdf')
    expect(lecture.pages).toBeGreaterThanOrEqual(2)
    for (let page = 1; page <= lecture.pages; page += 1) {
      const entetes = lecture.lignes.filter((ligne) => ligne.page === page
        && ligne.items.some((item) => item.str.startsWith('Groupe comparé'))
        && ligne.items.some((item) => item.str === 'Commune A1'))
      expect(entetes.length, `en-tête page ${page}`).toBe(1)
      expect(entetes[0]!.items.some((item) => item.str === TABLEAU_TEMPS_LABEL), `page ${page}`).toBe(true)
      // Every page still carries its own time rows and values.
      expect(lecture.lignes.some((ligne) => ligne.page === page
        && ligne.items.some((item) => /^\d+ min$/.test(item.str))), `lignes page ${page}`).toBe(true)
    }
    // The served gaps stay in the table where they occur (first page here).
    expect(lecture.texteComplet).toContain('Indisponible')
    verifierDansPage(lecture)
    verifierCollisions(lecture)
    await verifierAlphaTexte(lecture.octets)
  })

  it('garde la part native 99,6 % et son unité au lieu de forcer 100 %', async () => {
    const { lecture } = await generer(requeteSansMode(capturePartDense()), 'dense-share.pdf')
    expect(lecture.texteComplet).toContain('99,6 %')
    expect(lecture.texteComplet).not.toContain('100,0 %')
    expect(shareFillPercent(0.9957355, '%')).toBeCloseTo(99.57355, 4)
    expect(shareFillPercent(0.5, 'parts / 1 000')).toBe(0.5)
    const couleurs = await couleursRemplissage(lecture.octets)
    expect(couleurs).toContain('#577370')
    verifierCollisions(lecture)
  })



  it('ne relie pas les points nuls de la courbe et suit le path natif', async () => {
    const capture: any = captureCourbeTrous()
    const figure = capture.figures.find((candidate: any) => candidate.family === 'mobilite-curve').model
    const geometry = curveGeometry(figure, {
      width: 640,
      height: 300,
      margin: { top: 22, right: 68, bottom: 62, left: 64 },
    })
    const path = curveSeriesPath(figure.points, figure, geometry)
    expect((path.match(/M/g) ?? []).length).toBeGreaterThanOrEqual(2)
    const { lecture } = await generer(requeteAvecModes(capture), 'dense-curve-gaps.pdf')
    contientTout(lecture, ['0 %', '100 %', 'Valeurs du graphique'])
    verifierCollisions(lecture)
  })

  it('respecte la propagation comparisonFor quand le focal est masqué', () => {
    const figure: any = {
      categories: [{ key: 'c', label: 'C', axisLabel: 'C' }],
      series: [
        { key: 'car', label: 'Voiture', color: '#a94562', values: [1] },
        { key: 'car:comparison', label: 'Voiture comparée', color: '#bbb', values: [2], comparisonFor: 'car' },
      ],
      xAxisTitle: 'X',
      yAxisTitle: 'Y',
      description: '',
    }
    const visible = visibleGroupedBarSeries(figure, ['car'])
    expect(visible).toEqual([])
  })

  it('centre une barre focale unique quand la comparaison est masquée', () => {
    const scale = { maximum: 4, ticks: [0, 1, 2, 3, 4] }
    const geometry = { width: 640, height: 300, margin: { top: 22, right: 24, bottom: 62, left: 68 } }
    const one = mobiliteBarGeometry(geometry, 1, scale, 1)
    const two = mobiliteBarGeometry(geometry, 1, scale, 2)
    const centreUn = one.x(0, 0) + one.barWidth / 2
    const centreDeux = two.x(0, 0) + two.barWidth / 2
    const groupCentre = geometry.margin.left + one.groupWidth / 2
    expect(centreUn).toBeCloseTo(groupCentre, 2)
    expect(centreDeux).toBeLessThan(groupCentre)
    expect(one.barWidth).toBeGreaterThanOrEqual(two.barWidth)
  })

  it('rend chaque panneau de rampe à son échelle native indépendante', async () => {
    const capture: any = captureRampeDense()
    const first = rampScale([{ key: 'car', label: 'Voiture', points: [
      { xValue: 5, xLabel: '5 min', value: 0.2, referenceValue: null },
      { xValue: 10, xLabel: '10 min', value: 1.4, referenceValue: null },
    ] }], false)
    const second = rampScale([{ key: 'car', label: 'Voiture', points: [
      { xValue: 5, xLabel: '5 min', value: 10, referenceValue: null },
      { xValue: 10, xLabel: '10 min', value: 40, referenceValue: null },
    ] }], false)
    expect(first.ticks).toEqual([0, 1, 2])
    expect(second.ticks.at(-1)).toBeGreaterThan(30)
    const { lecture } = await generer(requeteAvecModes(capture), 'dense-ramp-panels.pdf')
    contientTout(lecture, ['Diversité de l’offre accessible', 'Établissements accessibles'])
    verifierCollisions(lecture)
  })

  it('résout les rôles brand/theme réels sans retomber sur l’encre', () => {
    expect(PALETTE_PDF.themeMobiliteStrong).toBe(rolesRampesTheme(ANCRAGES_THEMES.mobilite).strong)
    expect(couleurPdf('var(--brand-500)')).toBe('#57726f')
    expect(couleurPdf('var(--cahier-theme-strong)')).toBe('#446b74')
    expect(couleurPdf('color-mix(in srgb, var(--cahier-theme-strong) 45%, var(--paper))')).toBe('#a5b5b5')
    expect(couleurPdf('var(--cahier-cycle-protected, var(--cahier-mode-bike, var(--mode-bike)))')).toBe('#2e6171')
  })


  it('ne réserve pas de seconde barre quand la comparaison est masquée', async () => {
    const capture: any = captureBarresDense()
    const avant = JSON.stringify(capture)
    const hidden = {
      ...capture,
      comparison: {
        ...capture.comparison,
        display: {
          state: 'not-displayed',
          reason: 'hidden-by-user',
          layers: capture.comparison.display.layers.map((layer: any) => ({ ...layer, displayed: false })),
        },
      },
    }
    const { lecture } = await generer(requeteAvecModes(hidden), 'bars-hidden-comparison.pdf')
    expect(JSON.stringify(capture)).toBe(avant)
    expect(lecture.lignes.some((ligne) => ligne.texte.startsWith('¹ Groupe comparé :'))).toBe(false)
    verifierCollisions(lecture)
  })

  it('partage les mêmes primitives de domaine entre écran et PDF', () => {
    const bars: any = captureBarresDense()
    const barFigure = bars.figures.find((candidate: any) => candidate.family === 'mobilite-bars').model.figure
    const bike = barFigure.categories.find((category: any) => category.key === 'bike')
    const single = { ...barFigure, categories: [bike] }
    const barScale = mobiliteBarScale(single, true)
    expect(barScale.ticks).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5])
    expect(barScale.maximum).toBe(3.5)

    const curve: any = captureCourbeDense()
    const curveFigure = curve.figures.find((candidate: any) => candidate.family === 'mobilite-curve').model
    const geometry = curveGeometry(curveFigure, {
      width: 640,
      height: 300,
      margin: { top: 22, right: 68, bottom: 62, left: 64 },
    })
    expect(geometry.yTicks.map((tick) => tick.label)).toEqual(['0 %', '25 %', '50 %', '75 %', '100 %'])
    expect(geometry.xTicks).toHaveLength(73)
  })

})

describe('compositeur PDF Cahier — refus explicites', () => {
  it('refuse une famille non prise en charge', async () => {
    const request = requetePour('aedar-access')
    const capture = {
      ...request.capture,
      figures: [{ ...request.capture.figures[0]!, family: 'waffle-inconnu' }],
    } as unknown as CahierExportRequest['capture']
    await expect(composerCahierPdf({ ...request, capture }, options()))
      .rejects.toMatchObject({ code: 'unsupported-family' })
  })

  it('refuse une carte déclarée non observée comme erreur d’actif', async () => {
    const capture: any = structuredClone(capturePdfFixture('aedar-car-overview'))
    capture.capabilities.maps.items[0].loaded = false
    await expect(composerCahierPdf({ ...requetePour('aedar-car-overview'), capture }, options()))
      .rejects.toMatchObject({ code: 'asset' })
  })




  it('charge les polices par le chemin de production (fetch des actifs bundlés)', async () => {
    const original = globalThis.fetch
    const dossier = resolve(process.cwd(), 'src/assets/fonts/pdf')
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      const nom = url.split('/').pop()
      if (nom?.endsWith('.ttf')) {
        const bytes = readFileSync(resolve(dossier, nom))
        return new Response(bytes, { status: 200 })
      }
      return original(input)
    }) as typeof fetch
    try {
      const artifact = await composerCahierPdf(requetePour('aedar-access'), {
        signal: signal(),
        urlPublique: 'https://lusk.test/territoire/commune/22001?theme=mobilite#section-aedar-access',
        urlAccueil: 'https://lusk.test/',
      })
      const lecture = await lirePdf(artifact.blob)
      // headline-400, text-400/500/600, fira-code-500, newsreader-600-italic.
    expect(await policesEmbarquees(lecture.octets)).toBeGreaterThanOrEqual(6)
    } finally {
      globalThis.fetch = original
    }
  })

  it('ne crée aucune URL objet (le compositeur ne fait pas la livraison)', async () => {
    const spy = vi.spyOn(URL, 'createObjectURL')
    await generer(requetePour('aedar-access'), 'sans-url-objet.pdf')
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('un nombre corrompu reste fidèlement le nombre corrompu', async () => {
    const request = requetePour('reseaux')
    const capture = structuredClone(request.capture)
    const figure = capture.figures.find((candidate) => candidate.family === 'mobilite-bars')!
    figure.model.figure.categories[0]!.value.fact.value = 10.94466
    const corrompu = { ...request, capture } as CahierExportRequest
    const { lecture } = await generer(corrompu, 'negatif-nombre-corrompu.pdf')
    expect(lecture.texteComplet).toContain('10,94')
    expect(lecture.texteComplet).not.toContain('10,93')
    // The independent literal audit must fail on the original expected number.
    expect(() => auditerTexte(lecture, ['10,93'])).toThrow(/10,93/)
  })

  it('l’audit indépendant rejette une colonne ou un groupe corrompu', async () => {
    const { lecture } = await generer(requetePour('aedar-access'), 'negatif-colonne.pdf')
    expect(() => auditerTexte(lecture, ['colonne inexistante'])).toThrow(/colonne inexistante/)
    expect(() => auditerTexte(lecture, ['Groupe comparé : groupe inventé'])).toThrow(/groupe inventé/)
  })


  it('rejette un groupe réellement corrompu dans le PDF produit', async () => {
    const bon = await generer(requeteAvecModes(captureBarresDense()), 'negatif-groupe-bon.pdf')
    const capture: any = captureBarresDense()
    capture.comparison.group = {
      ...capture.comparison.group,
      names: ['GROUPE CORROMPU'],
      label: 'GROUPE CORROMPU',
    }
    // The footer carries the owner's served comparison sentence. Corrupting the
    // *group* identity can only reach the subtitle: it must never be glued to
    // the statistic sentence as if it named the compared cohort.
    capture.comparison.group = {
      ...capture.comparison.group,
      names: ['GROUPE CORROMPU'],
      label: 'GROUPE CORROMPU',
    }
    const corrompu = await generer(requeteAvecModes(capture), 'negatif-groupe-reel.pdf')
    expect(corrompu.lecture.texteComplet).toContain('GROUPE CORROMPU')
    expect(corrompu.lecture.texteComplet).toContain('¹ Groupe comparé : Médiane des communes de EPCI X')
    expect(occurrences(corrompu.lecture, '¹ Groupe comparé : GROUPE CORROMPU')).toBe(0)
    // The independent audit still catches the corrupted group identity.
    expect(() => auditerTexte(corrompu.lecture, ['Groupe comparé : EPCI X']))
      .toThrow(/Groupe comparé : EPCI X/)
    expect(occurrences(corrompu.lecture, 'GROUPE CORROMPU'))
      .toBeGreaterThan(occurrences(bon.lecture, 'GROUPE CORROMPU'))
  })
})

describe('sous-titre de comparaison — règle mesurée approuvée', () => {
  const mesure: MesureTexte = {
    largeur: (texte, _police, taille, espacement = 0) => Array.from(texte).length * taille * 0.17 + espacement * texte.length,
    hauteurLigne: (_police, taille) => taille * 0.3528 * 1.2,
    espace: (_police, taille) => taille * 0.17,
  }

  const optionsSousTitre = (largeur: number) => ({
    mesure,
    largeur,
    police: 'display',
    taillePt: 13.5,
    policePrefixe: 'body',
    taillePrefixePt: 7.5,
  })

  function comparison(over: Partial<CahierCaptureComparison> = {}): CahierCaptureComparison {
    const { group: groupOver, ...rest } = over
    const group = {
      label: 'communes de EPCI X',
      names: ['EPCI X'],
      preset: null,
      level: 'commune',
      scopeKind: 'communes-epci',
      selectedMemberCount: null,
      eligibleContributorCount: null,
      ...(groupOver ?? {}),
    }
    return {
      status: 'ready',
      error: null,
      referenceStatus: 'ready',
      eligible: true,
      capable: true,
      selection: {
        known: true,
        state: 'membres',
        preset: null,
        defaultPreset: 'epci',
        level: 'commune',
        members: [],
        memberCount: null,
      },
      absent: null,
      none: false,
      display: {
        state: 'displayed',
        reason: 'shown',
        layers: [{ slot: 'comparison', toggle: true, referenceAvailable: true, visibleReferenceAvailable: true, displayed: true }],
      },
      ...rest,
      group,
    } as CahierCaptureComparison
  }

  function texte(sousTitre: SousTitreComparaison | null): string {
    return sousTitre ? texteSousTitre(sousTitre) : ''
  }

  it('affiche le nom exact d’un EPCI, jamais le libellé de portée', () => {
    const resultat = sousTitreComparaison(comparison({ group: { ...comparison().group!, preset: 'epci', names: ['Rennes Métropole'] } }), optionsSousTitre(140))
    expect(resultat?.strategie).toBe('preset-epci')
    expect(texte(resultat)).toBe('Groupe comparé : RENNES MÉTROPOLE')
  })

  it('applique les trois noms Bretagne selon le niveau réel', () => {
    for (const [niveau, attendu] of [
      ['commune', 'COMMUNES BRETONNES'],
      ['epci', 'EPCI BRETONS'],
      ['departement', 'DÉPARTEMENTS BRETONS'],
    ] as const) {
      const resultat = sousTitreComparaison(comparison({
        group: { ...comparison().group!, preset: 'bretagne', level: niveau, names: [] },
      }), optionsSousTitre(140))
      expect(texte(resultat)).toBe(`Groupe comparé : ${attendu}`)
    }
  })

  it('trie les noms en français et affiche tous les noms complets quand ils tiennent', () => {
    const resultat = sousTitreComparaison(comparison({
      group: {
        ...comparison().group!,
        preset: null,
        names: ['Vannes', 'Étel', 'Lorient'],
        selectedMemberCount: 3,
      },
    }), optionsSousTitre(160))
    expect(resultat?.strategie).toBe('tous')
    expect(texte(resultat)).toBe('Groupe comparé : ÉTEL, LORIENT, VANNES')
    expect(resultat?.total).toBe(3)
  })

  it('garde le plus grand préfixe complet et compte les membres omis', () => {
    const noms = Array.from({ length: 10 }, (_, index) => `Commune Numéro ${index + 1}`)
    const resultat = sousTitreComparaison(comparison({
      group: { ...comparison().group!, preset: null, names: noms, selectedMemberCount: 10 },
    }), optionsSousTitre(62))
    expect(resultat?.strategie).toBe('prefixe')
    expect(resultat!.nommes!).toBeGreaterThan(0)
    expect(resultat!.nommes!).toBeLessThan(10)
    expect(texte(resultat)).toContain(`ET ${10 - resultat!.nommes!} AUTRES COMMUNES`)
    // No member name is cut: each shown name is a full source name.
    for (const nom of noms.slice(0, resultat!.nommes!)) {
      expect(texte(resultat).toUpperCase()).toContain(nom.toUpperCase())
    }
  })

  it('accorde le singulier quand un seul membre est omis', () => {
    const noms = [
      'Saint-Aubin-des-Landes-et-ses-hameaux',
      'Saint-Jean-des-Marais-et-ses-hameaux',
      'Saint-Zénon-du-Lac-Humide-et-ses-hameaux',
    ]
    const suffixe = 'ET 1 AUTRE COMMUNE'
    const largeur = mesure.largeur(noms[1]!, 'display', 13.5)
      + mesure.largeur(` ${suffixe}`, 'display', 13.5) + 2
    const resultat = sousTitreComparaison(comparison({
      group: {
        ...comparison().group!,
        preset: null,
        names: noms,
        selectedMemberCount: 3,
      },
    }), optionsSousTitre(largeur))
    expect(resultat?.strategie).toBe('prefixe')
    expect(resultat?.nommes).toBe(2)
    expect(texte(resultat)).toContain('ET 1 AUTRE COMMUNE')
  })

  it('replie sur le nombre total de membres sélectionnés, pas les contributeurs', () => {
    const repli = 'Groupe comparé : SÉLECTION DE 8 COMMUNES'
    const largeurRepli = mesure.largeur(repli, 'display', 13.5) + 4
    const resultat = sousTitreComparaison(comparison({
      group: {
        ...comparison().group!,
        preset: null,
        names: [
          'Commune-de-Saint-Trémeur-sur-Mer-et-ses-hameaux',
          'Commune-de-Saint-Éloi-du-Bois-et-ses-hameaux',
          'Commune-de-Saint-Jean-des-Marais-et-ses-hameaux',
        ],
        selectedMemberCount: 8,
        eligibleContributorCount: 2,
      },
    }), optionsSousTitre(largeurRepli))
    expect(resultat?.strategie).toBe('compte')
    expect(texte(resultat)).toBe(repli)
    expect(texte(resultat)).not.toContain('2')
  })

  it('omet le sous-titre quand la comparaison est masquée, vide ou inéligible', () => {
    for (const display of [
      { state: 'not-displayed', reason: 'hidden-by-user', layers: [] },
      { state: 'not-displayed', reason: 'empty-selection', layers: [] },
      { state: 'not-displayed', reason: 'not-eligible', layers: [] },
      { state: 'unobserved', reason: 'unpublished', layers: [] },
    ] as const) {
      expect(sousTitreComparaison(comparison({ display }), optionsSousTitre(140))).toBeNull()
    }
  })
})

describe('tableaux PDF — colonnes, nombres et en-têtes', () => {
  const mesure: MesureTexte = {
    largeur: (texte, _police, taille) => Array.from(texte).length * taille * 0.17,
    hauteurLigne: (_police, taille) => taille * 0.3528 * 1.2,
    espace: (_police, taille) => taille * 0.17,
  }

  it('découpe des groupes de colonnes cohérents et répète les en-têtes', () => {
    const columns: CahierTableColumn[] = Array.from({ length: 20 }, (_, index) => ({
      key: `col-${index}`,
      label: `Colonne ${index + 1}`,
      unit: 'u',
      kind: index % 2 === 0 ? 'focal' : 'comparison',
      seriesKey: `serie-${Math.floor(index / 2)}`,
    }))
    const rows: CahierTableRow[] = [{
      key: 'row',
      label: 'Ligne',
      cells: columns.map((column, index) => ({
        columnKey: column.key,
        value: index,
        display: String(index),
        unit: 'u',
        raw: false,
        rank: null,
        rankDisplay: null,
        rankAria: null,
      })),
    }]
    const parts = construireTableauxPdf({
      key: 'large',
      title: 'Grand tableau',
      columns,
      rows,
      layout: 'flat',
      columnSeparators: 'none',
      notes: [],
      unit: 'u',
    }, { mesure, largeurDisponible: 120, nomTerritoire: null })
    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) {
      expect(part.width).toBeLessThanOrEqual(120.01)
      expect(part.rows).toHaveLength(1)
      expect(part.columns.length).toBeGreaterThan(0)
      expect(part.headerHeight).toBeGreaterThan(0)
    }
  })

  it('refuse explicitement un nombre qui ne peut pas tenir sans être tronqué', () => {
    const columns: CahierTableColumn[] = [{
      key: 'value',
      label: 'Valeur',
      unit: 'u',
      kind: 'focal',
      seriesKey: null,
    }]
    const rows: CahierTableRow[] = [{
      key: 'row',
      label: 'Ligne',
      cells: [{
        columnKey: 'value',
        value: 123456789.1234,
        display: '123 456 789,1234',
        unit: 'u',
        raw: false,
        rank: null,
        rankDisplay: null,
        rankAria: null,
      }],
    }]
    expect(() => construireTableauxPdf({
      key: 'number',
      title: 'Nombre',
      columns,
      rows,
      layout: 'flat',
      columnSeparators: 'none',
      notes: [],
      unit: 'u',
    }, { mesure, largeurDisponible: 40, nomTerritoire: null })).toThrow(/aucun nombre n’est tronqué/i)
  })

  it('mesure les en-têtes de territoire sur deux lignes avec ellipse seulement là', () => {
    const territoire = `Commune de ${'Saint-Trémeur-sur-Mer-et-ses-hameaux-'.repeat(5)}écarts`
    const columns: CahierTableColumn[] = [{
      key: 'territory',
      label: territoire,
      unit: null,
      kind: 'focal',
      seriesKey: null,
    }]
    const rows: CahierTableRow[] = [{
      key: 'row',
      label: 'Ligne',
      cells: [{
        columnKey: 'territory',
        value: 0,
        display: '0',
        unit: null,
        raw: false,
        rank: null,
        rankDisplay: null,
        rankAria: null,
      }],
    }]
    const [part] = construireTableauxPdf({
      key: 'territory',
      title: 'Tableau',
      columns,
      rows,
      layout: 'flat',
      columnSeparators: 'none',
      notes: [],
      unit: null,
    }, {
      mesure,
      largeurDisponible: 80,
      nomTerritoire: territoire,
    })
    expect(part!.columns[0]!.headerLines.length).toBe(2)
    expect(part!.columns[0]!.headerLines[1]).toContain('…')
  })
})

/** First owner fill a consumer source copies verbatim, or `undefined`. */
function remplissageCopie(source: string, interdits: readonly string[]): string | undefined {
  const normalise = source.toLowerCase()
  return interdits.find((interdit) => normalise.includes(interdit))
}

describe('polices PDF — provenance et marque', () => {
  it('embarque uniquement des faces dérivées des paquets de l’app, avec licences', () => {
    expect(POLICES_PDF).toHaveLength(10)
    const dossier = resolve(process.cwd(), 'src/assets/fonts/pdf')
    const fichiers = new Set(readdirSync(dossier))
    for (const face of POLICES_PDF) {
      expect(face.url).toBeTruthy()
      expect(fichiers.has(face.file)).toBe(true)
      expect(fichiers.has(`${face.id}-LICENSE.txt`)).toBe(true)
      const bytes = readFileSync(resolve(dossier, face.file))
      expect(bytes.byteLength).toBe(face.bytes)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(face.sha256)
      expect(face.sourcePackage.startsWith('@fontsource-variable/')).toBe(true)
      expect(face.licenseSpdx).toBe('OFL-1.1')
    }
  })

  it('garde un seul propriétaire runtime pour les tracés et remplissages de l’hermine', () => {
    const consommateurs = [
      'src/fiche/prototype/cahierPdfComposer.ts',
      'src/components/LuskBrand.vue',
      'src/components/fiche/FiligraneFiche.vue',
    ].map((chemin) => [chemin, readFileSync(resolve(process.cwd(), chemin), 'utf8')] as const)
    // Forbid the owner's *current* fills, derived from the owner itself: moving
    // a canonical colour must not leave a stale copy undetected in a consumer.
    const remplissagesInterdits = Object.values(REMPLISSAGES_MARQUE_LUSK)
      .map((remplissage) => remplissage.toLowerCase())
    for (const [chemin, source] of consommateurs) {
      expect(source, chemin).toContain('MARQUE_LUSK_ERMINE')
      expect(remplissageCopie(source, remplissagesInterdits), chemin).toBeUndefined()
      for (const cheminMarque of MARQUE_LUSK_ERMINE.chemins) {
        expect(source, chemin).not.toContain(cheminMarque.d)
      }
    }
    // Every path declares a role the fills owner can resolve; a cosmetic path
    // split does not need a test edit. The locked fills' *identity* is the brand
    // owner's contract (`lusk-brand.spec.ts`), not a PDF-ownership incident.
    const roles = new Set(MARQUE_LUSK_ERMINE.chemins.map((chemin) => chemin.role))
    expect(roles).toEqual(new Set(['ink', 'accent']))
    expect(Object.keys(REMPLISSAGES_MARQUE_LUSK).sort()).toEqual(['accent', 'ink'])
  })

  it('détecte une copie de n’importe quel remplissage propriétaire courant', () => {
    const interdits = Object.values(REMPLISSAGES_MARQUE_LUSK)
      .map((remplissage) => remplissage.toLowerCase())
    for (const remplissage of Object.values(REMPLISSAGES_MARQUE_LUSK)) {
      expect(remplissageCopie(`<path fill="${remplissage}" />`, interdits))
        .toBe(remplissage.toLowerCase())
    }
    expect(remplissageCopie('<path fill="var(--brand-500)" />', interdits)).toBeUndefined()
  })


  it('résout les couleurs PDF depuis les jetons approuvés, sans nouvelle palette', () => {
    const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8').toLowerCase()
    expect(tokens).toContain(`--editorial-paper: ${PALETTE_PDF.paper};`)
    expect(tokens).toContain(`--editorial-ink: ${PALETTE_PDF.ink};`)
    expect(tokens).toContain(`--editorial-muted: ${PALETTE_PDF.muted};`)
    expect(tokens).toContain(`--editorial-margin: ${PALETTE_PDF.margin};`)
    expect(tokens).toContain(`--brand-200: ${PALETTE_PDF.brand200};`)
    expect(tokens).toContain(`--mode-transit: ${PALETTE_PDF.modeFoot};`)
    expect(tokens).toContain(`--mode-bike: ${PALETTE_PDF.modeBike};`)
    expect(tokens).toContain(`--mode-car: ${PALETTE_PDF.modeCar};`)
    expect(couleurPdf('var(--cahier-cycle-protected, var(--cahier-mode-bike, var(--mode-bike)))')).toBe(PALETTE_PDF.modeBike)
    expect(couleurPdf(`var(--cahier-cycle-shared, ${COULEUR_CYCLE_PARTAGE})`))
      .toBe(COULEUR_CYCLE_PARTAGE)
  })
})
