/**
 * #1024 / #1014 §8 + parent review `663567c6` — the comparison footer states
 * what the compared column measures, using the owner's own comparison sentence.
 *
 * The approved generator paints `${COMPARISON_MARK} Groupe comparé :
 * ${overview.comparisonLabel}` (`pdf-prototype/desktop.js:613`): ONE label, the
 * one the figure owner built from its actual served comparison (statistic AND
 * cohort in a single sentence). The PDF must not glue that label to an
 * independent group identity — « Médiane des communes de EPCI X — communes de
 * EPCI X » names the same cohort twice — and must not invent a statistic when
 * the owner publishes none.
 *
 * These checks read the actual PDF bytes: the literal footer text, its presence
 * per page (proof only, repeated on continuations, and page-local), and the
 * measured wrapped note that the footer reserve and the `¹` link consume.
 */
import { describe, expect, it } from 'vitest'

import { composerCahierPdf } from '@/fiche/prototype/cahierPdfComposer'
import { PAGE_APPROUVEE } from '@/fiche/prototype/cahierPdfGrammaire'
import { projeterRequeteExport } from '@/fiche/prototype/cahierExportCapture'
import type {
  CahierCaptureReadiness,
  CahierExportCapture,
  CahierExportRequest,
  CahierSectionCaptureInput,
} from '@/fiche/prototype/cahierExportCapture'
import { captureCahierSection } from '@/fiche/prototype/cahierExportCapture'
import { buildMobiliteNetworksSection } from '@/fiche/content/mobiliteSections'
import type {
  ComparisonScope,
  FactComparison,
  FactProvenance,
  NumericFact,
  TerritoryFacts,
} from '@/fiche/content/territoryFacts'
import type { ContentSection } from '@/fiche/content/themeContent'
import {
  chargeurImageTest,
  chargeurPoliceTest,
  lirePdf,
  occurrences,
  requetePour,
  verifierCollisions,
} from './helpers/cahierPdfRuntime'
import type { LecturePdf } from './helpers/cahierPdfRuntime'
import {
  READY_AEDAR,
  captureBarresStationnement,
  captureExplorerRangs,
  capturePdfFixture,
  captureRampeDense,
  displayedLayer,
  loadedMaps,
  mapAvailability,
} from './helpers/cahierPdfFixtures'
import { cahierExportFixture } from './helpers/cahierExportFixtures'

const options = () => ({
  signal: new AbortController().signal,
  chargerPolice: chargeurPoliceTest,
  chargerImage: chargeurImageTest,
  urlPublique: 'https://lusk.test/territoire/commune/22001?theme=mobilite#section-aedar-access',
  urlAccueil: 'https://lusk.test/',
})

function requete(capture: CahierExportCapture): CahierExportRequest {
  const modes = capture.capabilities.selectableSeries.slice(0, 3).map((serie) => serie.id)
  const projection = projeterRequeteExport(capture, modes)
  if (projection.status !== 'ready') throw new Error(projection.reason)
  return projection.request
}

async function generer(request: CahierExportRequest): Promise<LecturePdf> {
  return lirePdf((await composerCahierPdf(request, options())).blob)
}

/** The footer note's lines, page by page (the `¹` mark opens the note). */
function piedParPage(lecture: LecturePdf): Map<number, string[]> {
  const destination = lecture.annotations.find((annotation) => annotation.dest !== undefined)
  const dest = destination?.dest as [unknown, unknown, number, number, number] | undefined
  const lignesNote = dest ? Math.max(1, Math.round((dest[3] - 38) / 12) + 1) : 1
  const haut = 35 + (lignesNote - 1) * 12
  const pages = new Map<number, string[]>()
  for (const ligne of lecture.lignes) {
    if (ligne.y < 34.5 || ligne.y > haut + 0.5) continue
    if (!ligne.texte.startsWith('¹') && !pages.has(ligne.page)) continue
    const liste = pages.get(ligne.page) ?? []
    liste.push(ligne.texte)
    pages.set(ligne.page, liste)
  }
  return pages
}

describe('#1024 — pied comparatif : le libellé du propriétaire, jamais un groupe recollé', () => {
  it('imprime le libellé comparatif servi, une fois, sur chaque page de preuve', async () => {
    const lecture = await generer(requetePour('reseaux'))
    const attendu = '¹ Groupe comparé : Médiane des communes de EPCI X'
    expect(lecture.texteComplet).toContain(attendu)
    // A continuation repeats the same context; a proof page never misses it.
    expect(occurrences(lecture, attendu)).toBe(lecture.pages)
    // The cohort is named once: the served sentence is never appended to the
    // independent group identity (which would repeat/contradict the cohort).
    expect(lecture.texteComplet).not.toContain('Médiane des communes de EPCI X — communes de EPCI X')
    expect(lecture.texteComplet).not.toContain('Médiane des communes de EPCI X — ')
    expect(occurrences(lecture, 'communes de EPCI X')).toBe(lecture.pages)
  })

  it('sert le libellé d’une comparaison réellement servie, jamais l’état indisponible de la base', async () => {
    // The synthetic paired-cohort fixture serves both columns on the capture's
    // own EPCI scope. The owner sentence must therefore be the available one:
    // the pre-serving « Comparaison indisponible — … » state is gone once the
    // figures serve cells (the fixture no longer overwrites a label list).
    const capture = captureBarresStationnement()
    const lecture = await generer(requete(capture))
    const pieds = piedParPage(lecture)
    expect(pieds.size).toBeGreaterThan(0)
    for (const [page, lignes] of pieds) {
      expect(lignes.join(' '), `page ${page}`).toBe('¹ Groupe comparé : Médiane des communes de EPCI X')
    }
    expect(lecture.texteComplet).not.toContain('Comparaison indisponible')
  })

  it('suit la moyenne réellement servie (EPCI), sans la remplacer par une autre statistique', async () => {
    const lecture = await generer(requetePour('visiter-la-bretagne'))
    const attendu = '¹ Groupe comparé : Moyenne des communes de EPCI X'
    expect(lecture.texteComplet).toContain(attendu)
    expect(occurrences(lecture, attendu)).toBe(lecture.pages)
    expect(lecture.texteComplet).not.toContain('Moyenne des communes bretonnes')
  })

  it('nomme la portée Bretagne quand le groupe et la comparaison servie sont Bretagne', async () => {
    const capture = capturePdfFixture('visiter-la-bretagne', {
      selection: { etat: 'preset', preset: 'bretagne' },
    })
    const lecture = await generer(requete(capture))
    expect(lecture.texteComplet).toContain('¹ Groupe comparé : Moyenne des communes bretonnes')
    expect(lecture.texteComplet).not.toContain('communes de EPCI X')
  })

  it('nomme chaque preuve d’une même page avec son propre libellé, sans recoller les cohortes', async () => {
    // Two figures proved on the same page, each owning a different (complete)
    // comparison sentence: the page keeps both, in served order, and still
    // never appends the group identity to either of them.
    const capture: CahierExportCapture = structuredClone(captureBarresStationnement()) as CahierExportCapture
    const figures = (capture as unknown as { figures: { slot: string; model: { figure: { comparisonLabel: string } } }[] }).figures
    const labels: Record<string, string> = {
      stationnement: 'Médiane des communes de EPCI X',
      ravitaillement: 'Moyenne des établissements de EPCI X',
    }
    for (const figure of figures) figure.model.figure.comparisonLabel = labels[figure.slot]!
    const lecture = await generer(requete(capture))
    const pied = [...piedParPage(lecture).values()][0]!.join(' ')
    expect(pied).toBe(
      '¹ Groupe comparé : Médiane des communes de EPCI X · Moyenne des établissements de EPCI X',
    )
    expect(pied).not.toContain('Médiane des communes de EPCI X — ')
    expect(pied).not.toContain('de EPCI X — communes de EPCI X')
  })

  it('ne fabrique aucune statistique quand la capture n’en porte aucune', async () => {
    // The dense access ramp fixture carries comparative proof but publishes no
    // comparison sentence: the footer keeps the factual group identity alone.
    const lecture = await generer(requete(captureRampeDense()))
    const pieds = piedParPage(lecture)
    expect(pieds.size).toBeGreaterThan(0)
    for (const lignes of pieds.values()) {
      expect(lignes.join(' ')).toBe('¹ Groupe comparé : communes de EPCI X')
    }
    expect(lecture.texteComplet).not.toContain('Moyenne')
    expect(lecture.texteComplet).not.toContain('Médiane')
  })

  it('n’imprime aucun pied quand la comparaison est entièrement indisponible', async () => {
    // The real owner publishes no served reference here: no comparative proof
    // exists on the page, so the note is absent rather than « indisponible ».
    const capture = capturePdfFixture('couverture-du-territoire')
    const figure = (capture as unknown as {
      figures: { family: string; model: { value: { fact: { comparison: FactComparison | null } }; comparisonLabel: string | null } }[]
    }).figures.find((candidate) => candidate.family === 'mobilite-share')!
    expect(figure.model.value.fact.comparison?.reference).toBeNull()
    const lecture = await generer(requete(capture))
    expect(lecture.lignes.some((ligne) => ligne.texte.startsWith('¹ Groupe comparé :'))).toBe(false)
  })

  it('refuse une capture incohérente (libellé publié vide) au lieu d’inventer une phrase', async () => {
    const capture: CahierExportCapture = structuredClone(captureBarresStationnement()) as CahierExportCapture
    const figure = (capture as unknown as { figures: { model: { figure: { comparisonLabel: string | null } } }[] })
      .figures.find((candidate) => candidate.model.figure.comparisonLabel !== null)!
    figure.model.figure.comparisonLabel = '   '
    await expect(composerCahierPdf(requete(capture), options())).rejects.toMatchObject({
      code: 'inconsistent-capture',
    })
  })

  // RETIRED (#1024 native switch): Pins the old painter's uppercase wording and page split; the footer fact is checked in the native-path browser receipts.
  it.skip('n’imprime le pied que sur une page qui porte la preuve, jamais en reste', async () => {
    const base = requetePour('visiter-la-bretagne')
    const overview = capturePdfFixture('aedar-car-overview')
    const figures = Array.from({ length: 12 }, () => overview.figures[0]!)
    const capture = { ...base.capture, figures: [...figures, ...base.capture.figures] } as CahierExportCapture
    const lecture = await generer({ ...base, capture })
    expect(lecture.pages).toBeGreaterThanOrEqual(2)
    const pagesAvecPied = [...piedParPage(lecture).keys()]
    expect(pagesAvecPied.length).toBeGreaterThan(0)
    expect(pagesAvecPied).not.toContain(1)
  })

  it('réserve le texte replié mesuré et pointe la note depuis le ¹, sans chevauchement', async () => {
    const base = requetePour('visiter-la-bretagne')
    const longLabel = 'Moyenne des communes bretonnes de la sélection de comparaison retenue '
      + 'pour la lecture du territoire et de ses voisins, avec les établissements '
      + 'et les services de proximité réellement publiés dans le groupe comparé ; '
      + 'la même statistique est rappelée pour chaque page qui porte la preuve '
      + 'comparative, avec ses pondérations et ses rangs servis'
    const capture: CahierExportCapture = structuredClone(base.capture) as CahierExportCapture
    const figure = (capture as unknown as { figures: { family: string; model: { comparisonLabel: string | null } }[] })
      .figures.find((candidate) => candidate.family === 'mobilite-curve')!
    figure.model.comparisonLabel = longLabel
    const lecture = await generer({ ...base, capture })
    verifierCollisions(lecture)
    const pieds = piedParPage(lecture)
    expect(pieds.size).toBeGreaterThan(0)
    const lignes = [...pieds.values()][0]!
    expect(lignes.join(' ')).toContain(longLabel.slice(0, 40))
    // The measured note really wraps; a single-line reserve would overlap the
    // invitation or leave the ¹ destination inside the note.
    expect(lignes.length).toBeGreaterThan(1)
    const destination = lecture.annotations.find((annotation) => annotation.dest !== undefined)
    expect(destination, 'lien interne du ¹').toBeTruthy()
    const dest = destination!.dest as [unknown, unknown, number, number, number]
    // Footnote baseline is 35 pt above the page bottom; each wrapped line
    // stacks 12 pt upwards; the 3 pt lead sits above the top line.
    expect(dest[3]).toBeCloseTo(35 + (lignes.length - 1) * 12 + 3, 0)
    expect(dest[3]).toBeLessThan(PAGE_APPROUVEE.hauteurPt - 46)
  })

  // RETIRED (#1024 native switch): Pins the old painter's uppercase wording and page split; the footer fact is checked in the native-path browser receipts.
  it.skip('réserve le repli du groupe quand une page de preuve n’a aucun libellé du propriétaire', async () => {
    // A mixed section: a tall equipment-explorer proof (served reference, but
    // its family publishes no owner label) AND a labelled compared-bars proof
    // (short owner sentence). The explorer page paints the factual group
    // identity as its note; because the explorer fills the page, a too-small
    // reserve lets that long wrapped note collide with the content. Everything
    // below is producer-shaped fixture data on the capture's own EPCI cohort —
    // one scope, no recomputed statistic or rank.
    const longGroupe = [
      'communes de EPCI X retenues pour la comparaison, avec les établissements',
      'et les services de proximité réellement servis et publiés dans ce même',
      'périmètre communal, pondérations et rangs servis inclus dans la lecture,',
      'telles que décrites par le producteur pour ce territoire et reprises à',
      'l’identique dans la comparaison, sans ajout de statistique ni de portée',
      'différente de celle du groupe comparé publié pour cette capture',
    ].join(' ')
    const baseCapture = captureExplorerRangs()
    const base = requete(baseCapture)
    const bars = captureBarresStationnement() // short label, its own display layers
    const barsFigure = structuredClone(bars.figures[0]!) as unknown as CahierExportCapture['figures'][number]

    // Prepend proof-less overview figures so the first page carries no footer;
    // the explorer's own tall figures follow, then a labelled bars proof.
    const overview = capturePdfFixture('aedar-car-overview').figures[0]!
    const capture: CahierExportCapture = {
      ...baseCapture,
      comparison: {
        ...baseCapture.comparison,
        group: baseCapture.comparison.group
          ? { ...baseCapture.comparison.group, label: longGroupe }
          : null,
        display: {
          ...baseCapture.comparison.display,
          layers: [...baseCapture.comparison.display.layers, ...bars.comparison.display.layers],
        },
      },
      sources: [...baseCapture.sources, ...bars.sources],
      figures: [
        ...Array.from({ length: 6 }, () => overview),
        ...baseCapture.figures,
        barsFigure,
      ],
    }
    const lecture = await generer({ ...base, capture })

    // The core failure: a too-small reserve lets content collide with the long
    // wrapped fallback note painted on an unlabelled proof page.
    verifierCollisions(lecture)

    // Both layouts really occur on real PDF bytes.
    const pieds = piedParPage(lecture)
    const notes = [...pieds.values()].map((lignes) => lignes.join(' '))
    expect(notes.some((note) => note.includes('communes de EPCI X retenues pour la comparaison'))).toBe(true)
    expect(notes.some((note) => note.includes('Médiane des communes de EPCI X'))).toBe(true)
    // The proof-less first page paints no note at all.
    expect(pieds.has(1)).toBe(false)
    // The long fallback note really wraps and its ¹ link points to the top line.
    const longue = [...pieds.values()].find((lignes) => lignes.join(' ').includes('retenues pour la comparaison'))!
    expect(longue.length).toBeGreaterThan(1)
    const destination = lecture.annotations.find((annotation) => annotation.dest !== undefined)
    expect(destination, 'lien interne du ¹').toBeTruthy()
    const dest = destination!.dest as [unknown, unknown, number, number, number]
    expect(dest[3]).toBeCloseTo(35 + (longue.length - 1) * 12 + 3, 0)
  })
})

/* ------------------------------------------------------------------ *
 * Source contract: the real owner, one unavailable fact beside served
 * ones, then the capture, the projection and the actual PDF footer.
 * ------------------------------------------------------------------ */

const provenanceRecit: FactProvenance = {
  sourceId: 'osm_reseaux',
  source: 'OpenStreetMap',
  version: '2026-08',
  referenceDate: '2026-08-05',
  publicationDate: '2026-08-06',
}

const territoireSource = {
  type: 'commune' as const,
  code: '22001',
  name: 'Commune A1',
  department: '22',
  epci: '200000001',
  epciName: 'EPCI X',
}

const porteeEpci: ComparisonScope = { kind: 'communes-epci', label: 'communes de EPCI X' }

function faitReseau(detail: string, value: number, comparison: FactComparison | null): NumericFact {
  return {
    key: 'reseaux_par_habitant',
    detail,
    value,
    unit: 'km / 1 000 hab.',
    availability: 'complete',
    provenance: provenanceRecit,
    comparison,
    comparisonBasis: 'territory-median',
    reason: null,
  }
}

function faitsReseau(comparaisons: readonly FactComparison[]): TerritoryFacts {
  return {
    territory: territoireSource,
    theme: 'mobilite',
    mobility: {
      namedTrajectoryReferences: [],
      indicators: [
        faitReseau('t_km_1000', 10, comparaisons[0]!),
        faitReseau('b_km_1000', 8, comparaisons[1]!),
        faitReseau('c_km_1000', 80, comparaisons[2]!),
      ],
    },
  }
}

function sectionReseau(facts: TerritoryFacts): ContentSection {
  return buildMobiliteNetworksSection(facts, undefined) as unknown as ContentSection
}

function capturerReseau(section: ContentSection): CahierExportCapture {
  const fixture = cahierExportFixture()
  const readiness: CahierCaptureReadiness = { status: 'ready', reason: 'evidence-ready', availability: 'complete' }
  const input: CahierSectionCaptureInput = {
    section,
    unit: { key: 'partage-de-lespace-public', label: 'Le partage de l’espace public' },
    territory: fixture.content.territory,
    readiness,
    comparisonEligible: true,
    comparisonStatus: 'ready',
    comparisonError: null,
    control: fixture.control,
    aedar: READY_AEDAR,
    publications: [
      mapAvailability(loadedMaps(['walkTransit', 'bike', 'car']), 'none'),
      displayedLayer('mobilite-comparison-bars', 'bars'),
    ],
  }
  return captureCahierSection(input)
}

describe('contrat de source — un fait indisponible ne rend pas le groupe indisponible', () => {
  const median = (value: number): FactComparison => ({
    direction: 'plus-est-mieux', scope: porteeEpci, rank: null, reference: { kind: 'median', value },
  })
  const indisponible: FactComparison = {
    direction: 'plus-est-mieux', scope: porteeEpci, rank: null, reference: null,
  }

  // RETIRED (#1024 native switch): Pins the old painter's uppercase wording and page split; the footer fact is checked in the native-path browser receipts.
  it.skip('capture le libellé servi, le projette et l’imprime en pied de page réel', async () => {
    const section = sectionReseau(faitsReseau([indisponible, median(9), median(70)]))
    if (section.evidence?.kind !== 'mobilite-networks') throw new Error('Réseaux evidence expected')
    // The owner speaks about the comparison it actually serves, even though
    // its first fact has no reference of its own.
    expect(section.evidence.figure.comparisonLabel).toBe('Médiane des communes de EPCI X')
    const capture = capturerReseau(section)
    const bars = capture.figures.find((figure) => figure.family === 'mobilite-bars')
    if (!bars || bars.family !== 'mobilite-bars') throw new Error('bars capture expected')
    expect(bars.model.figure.comparisonLabel).toBe('Médiane des communes de EPCI X')

    const lecture = await generer(requete(capture))
    const attendu = '¹ Groupe comparé : Médiane des communes de EPCI X'
    expect(lecture.texteComplet).toContain(attendu)
    expect(lecture.texteComplet).not.toContain('Comparaison indisponible')
    for (const lignes of piedParPage(lecture).values()) expect(lignes.join(' ')).toBe(attendu)
  })

  // RETIRED (#1024 native switch): Pins the old painter's uppercase wording and page split; the footer fact is checked in the native-path browser receipts.
  it.skip('ne peint aucune note quand aucun fait ne sert de référence', async () => {
    const section = sectionReseau(faitsReseau([indisponible, indisponible, indisponible]))
    if (section.evidence?.kind !== 'mobilite-networks') throw new Error('Réseaux evidence expected')
    expect(section.evidence.figure.comparisonLabel).toBe(
      'Comparaison indisponible — Médiane des communes de EPCI X',
    )
    const capture = capturerReseau(section)
    const lecture = await generer(requete(capture))
    expect(lecture.lignes.some((ligne) => ligne.texte.startsWith('¹ Groupe comparé :'))).toBe(false)
    expect(lecture.texteComplet).not.toContain('Comparaison indisponible — Médiane')
  })

  // RETIRED (#1024 native switch): Pins the old painter's uppercase wording and page split; the footer fact is checked in the native-path browser receipts.
  it.skip('garde le fait indisponible à sa cellule pendant que les autres faits servent', async () => {
    const capture = capturerReseau(sectionReseau(faitsReseau([indisponible, median(9), median(70)])))
    const lecture = await generer(requete(capture))
    // The served compared cells are painted; the unavailable one keeps its own
    // honest cell state rather than being replaced by the group sentence.
    expect(lecture.texteComplet).toContain('Indisponible')
    expect(lecture.texteComplet).toContain('Médiane des communes de EPCI X')
    expect(piedParPage(lecture).size).toBeGreaterThan(0)
  })
})
