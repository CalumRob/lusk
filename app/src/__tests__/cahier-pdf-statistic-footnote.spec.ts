/**
 * #1024 / #1014 §8 — the comparison footer states the statistic that is
 * actually served, next to the group identity.
 *
 * The page footnote is the only place the PDF explains what the compared
 * column measures. It must therefore consume the captured `statisticLabels`
 * (owner-published labels of the figures' comparison layer) instead of naming
 * the group alone: a group name is not an explanation of the statistic, the
 * weighting or the rank. No family may be assumed to be a mean, and a capture
 * without a served statistic label prints none (never an invented « Moyenne »).
 *
 * These checks read the actual PDF bytes: the literal footer text, its
 * presence per page (proof only, repeated on continuations), and the measured
 * wrapped note that the footer reserve and the `¹` link destination consume.
 */
import { describe, expect, it } from 'vitest'

import { composerCahierPdf } from '@/fiche/prototype/cahierPdfComposer'
import { PAGE_APPROUVEE } from '@/fiche/prototype/cahierPdfGrammaire'
import { projeterRequeteExport } from '@/fiche/prototype/cahierExportCapture'
import type { CahierExportCapture, CahierExportRequest } from '@/fiche/prototype/cahierExportCapture'
import {
  chargeurImageTest,
  chargeurPoliceTest,
  lirePdf,
  occurrences,
  requetePour,
  verifierCollisions,
} from './helpers/cahierPdfRuntime'
import type { LecturePdf } from './helpers/cahierPdfRuntime'
import { capturePdfFixture, captureRampeDense } from './helpers/cahierPdfFixtures'

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

describe('#1024 — pied comparatif : la statistique servie, pas une moyenne supposée', () => {
  it('imprime le libellé statistique capturé à côté du groupe, sur chaque page de preuve', async () => {
    const lecture = await generer(requetePour('visiter-la-bretagne'))
    const attendu = '¹ Groupe comparé : Moyenne des communes bretonnes — communes de EPCI X'
    expect(lecture.texteComplet).toContain(attendu)
    // A continuation repeats the same context; a proof page never misses it.
    expect(occurrences(lecture, attendu)).toBe(lecture.pages)
  })

  it('suit une autre statistique réellement servie (médiane), sans la remplacer par une moyenne', async () => {
    const lecture = await generer(requetePour('reseaux'))
    expect(lecture.texteComplet).toContain('Médiane des communes de EPCI X')
    expect(lecture.texteComplet).not.toContain('Moyenne des communes de EPCI X')
    const pieds = piedParPage(lecture)
    expect(pieds.size).toBeGreaterThan(0)
    for (const [page, lignes] of pieds) {
      expect(lignes.join(' '), `page ${page}`).toContain('Médiane des communes de EPCI X')
      expect(lignes.join(' '), `page ${page}`).toContain('communes de EPCI X')
    }
  })

  it('conserve tous les libellés statistiques hétérogènes capturés, dans leur ordre servi', async () => {
    const base = requetePour('visiter-la-bretagne')
    const capture: CahierExportCapture = {
      ...base.capture,
      comparison: {
        ...base.capture.comparison,
        statisticLabels: ['Moyenne des communes bretonnes', 'Médiane des établissements'],
      },
    }
    const lecture = await generer({ ...base, capture })
    expect(lecture.texteComplet).toContain(
      '¹ Groupe comparé : Moyenne des communes bretonnes · Médiane des établissements — communes de EPCI X',
    )
  })

  it('ne fabrique aucune statistique quand la capture n’en porte aucune', async () => {
    // The dense access ramp fixture carries comparative proof but no served
    // statistic label: the footer keeps the factual group identity alone.
    const lecture = await generer(requete(captureRampeDense()))
    const pieds = piedParPage(lecture)
    expect(pieds.size).toBeGreaterThan(0)
    for (const lignes of pieds.values()) {
      expect(lignes.join(' ')).toBe('¹ Groupe comparé : communes de EPCI X')
    }
    expect(lecture.texteComplet).not.toContain('Moyenne')
    expect(lecture.texteComplet).not.toContain('Médiane')
  })

  it('n’imprime le pied que sur une page qui porte la preuve, jamais en reste', async () => {
    const base = requetePour('visiter-la-bretagne')
    const overview = capturePdfFixture('aedar-car-overview')
    const figures = Array.from({ length: 6 }, () => overview.figures[0]!)
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
    const capture: CahierExportCapture = {
      ...base.capture,
      comparison: { ...base.capture.comparison, statisticLabels: [longLabel] },
    }
    const lecture = await generer({ ...base, capture })
    verifierCollisions(lecture)
    const pieds = piedParPage(lecture)
    expect(pieds.size).toBeGreaterThan(0)
    const lignes = [...pieds.values()][0]!
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
})
