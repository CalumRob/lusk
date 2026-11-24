import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { composerCahierPdf, composerDocumentAvecCorpsNatif } from '@/fiche/prototype/cahierPdfComposer'
import { formatMobiliteBarValue } from '@/fiche/prototype/cahierMobiliteReadings'
import { projeterRequeteExportFigures } from '@/fiche/prototype/cahierExportAdapters'
import { MARQUE_LUSK_ERMINE, REMPLISSAGES_MARQUE_LUSK } from '@/components/luskBrandMark'
import { COULEUR_CYCLE_PARTAGE } from '@/styles/editorialPageRoles'
import { sousTitreComparaison, texteSousTitre } from '@/fiche/prototype/cahierPdfComparaison'
import type { SousTitreComparaison } from '@/fiche/prototype/cahierPdfComparaison'
import { POLICES_PDF } from '@/fiche/prototype/cahierPdfFonts'
import { PALETTE_PDF, couleurPdf } from '@/fiche/prototype/cahierPdfPalette'
import { ANCRAGES_THEMES, rolesRampesTheme } from '@/carte/couleurs'
import { construireTableauxPdf } from '@/fiche/prototype/cahierPdfTableau'
import { curveGeometry, mobiliteBarGeometry, mobiliteBarScale } from '@/fiche/prototype/cahierFigureNativeGeometry'
import { visibleGroupedBarSeries } from '@/fiche/prototype/cahierFigureReadings'
import type { CahierTableColumn, CahierTableRow } from '@/fiche/prototype/cahierExportAdapters'
import type { CahierCaptureComparison } from '@/fiche/prototype/cahierExportCapture'
import type { MesureTexte } from '@/fiche/prototype/cahierPdfMesure'
import { chargeurPoliceTest, lirePdf, policesEmbarquees, requetePour } from './helpers/cahierPdfRuntime'
import { captureBarresDense, captureCourbeDense, capturePdfFixture } from './helpers/cahierPdfFixtures'

const signal = () => new AbortController().signal

function options() {
  return {
    signal: signal(),
    chargerPolice: chargeurPoliceTest,
    urlPublique: 'https://lusk.test/territoire/commune/22001?theme=mobilite#section-aedar-access',
    urlAccueil: 'https://lusk.test/',
  }
}



describe('scènes natives peuplées — géométrie partagée écran/PDF', () => {






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


  it('résout les rôles brand/theme réels sans retomber sur l’encre', () => {
    expect(PALETTE_PDF.themeMobiliteStrong).toBe(rolesRampesTheme(ANCRAGES_THEMES.mobilite).strong)
    expect(couleurPdf('var(--brand-500)')).toBe('#57726f')
    expect(couleurPdf('var(--cahier-theme-strong)')).toBe('#446b74')
    expect(couleurPdf('color-mix(in srgb, var(--cahier-theme-strong) 45%, var(--paper))')).toBe('#a5b5b5')
    expect(couleurPdf('var(--cahier-cycle-protected, var(--cahier-mode-bike, var(--mode-bike)))')).toBe('#2e6171')
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
    } as any
    await expect(composerDocumentAvecCorpsNatif({ ...request, capture }, options(), []))
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
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const nom = url.split('/').pop()
      if (nom?.endsWith('.ttf')) {
        const bytes = readFileSync(resolve(dossier, nom))
        return new Response(bytes, { status: 200 })
      }
      return original(input)
    })
    globalThis.fetch = fetchSpy as typeof fetch
    try {
      const artifact = await composerDocumentAvecCorpsNatif(requetePour('aedar-access'), {
        signal: signal(),
        urlPublique: 'https://lusk.test/territoire/commune/22001?theme=mobilite#section-aedar-access',
        urlAccueil: 'https://lusk.test/',
      }, [])
      const lecture = await lirePdf(artifact.blob)
      expect(fetchSpy.mock.calls.filter(([input]) => String(input).endsWith('.ttf'))).toHaveLength(POLICES_PDF.length)
      expect(await policesEmbarquees(lecture.octets)).toBeGreaterThanOrEqual(6)
    } finally {
      globalThis.fetch = original
    }
  })

  it('ne crée aucune URL objet (le compositeur ne fait pas la livraison)', async () => {
    const spy = vi.spyOn(URL, 'createObjectURL')
    try {
      await composerDocumentAvecCorpsNatif(requetePour('aedar-access'), options(), [])
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('un nombre corrompu reste fidèlement le nombre corrompu', () => {
    const request = requetePour('reseaux')
    const capture = structuredClone(request.capture)
    const figure = capture.figures.find((candidate) => candidate.family === 'mobilite-bars')!
    if (figure.family !== 'mobilite-bars') throw new Error('famille inattendue')
    figure.model.figure.categories[0]!.value.fact.value = 10.94466
    expect(formatMobiliteBarValue(10.94466)).toBe('10,94')

    const displays = projeterRequeteExportFigures({ ...request, capture })
      .flatMap((projection) => projection.tables)
      .flatMap((table) => table.rows)
      .flatMap((row) => row.cells.map((cell) => cell.display))
    expect(displays).toContain('10,94')
    expect(displays).not.toContain('10,93')
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
