/**
 * Layout-free comparison-footer semantics (#1024): the owner label, factual
 * group fallback, proof predicate and corrupt-label refusal. Pagination, wrapping
 * and collision geometry remain browser-level acceptance coverage.
 */
import { describe, expect, it } from 'vitest'

import { projeterRequeteExport } from '@/fiche/prototype/cahierExportCapture'
import type { CahierExportCapture } from '@/fiche/prototype/cahierExportCapture'
import { projeterRequeteExportFigures } from '@/fiche/prototype/cahierExportAdapters'
import {
  composerDocumentAvecCorpsNatif,
  libelleComparaisonProjection,
  lignesPiedComparaison,
  preuveFigureComparative,
} from '@/fiche/prototype/cahierPdfComposer'
import type { MesureTexte } from '@/fiche/prototype/cahierPdfMesure'
import {
  captureBarresStationnement,
  capturePdfFixture,
  captureRampeDense,
} from './helpers/cahierPdfFixtures'
import { chargeurPoliceTest, lirePdf } from './helpers/cahierPdfRuntime'

const mesure: MesureTexte = {
  largeur: (texte) => Array.from(texte).length * 4,
  hauteurLigne: () => 12,
  espace: () => 2,
}

function projeter(capture: CahierExportCapture) {
  const modes = capture.capabilities.selectableSeries.slice(0, 3).map((serie) => serie.id)
  const projection = projeterRequeteExport(capture, modes)
  if (projection.status !== 'ready') throw new Error(projection.reason)
  return { request: projection.request, capture: projection.request.capture, figures: projeterRequeteExportFigures(projection.request) }
}

function labels(capture: CahierExportCapture): string[] {
  return [...new Set(projeter(capture).figures
    .map((figure) => libelleComparaisonProjection(figure))
    .filter((label): label is string => label !== null))]
}

function pied(labels: readonly string[], capture: CahierExportCapture): string {
  return lignesPiedComparaison(labels, capture, mesure).join(' ')
}

describe('#1024 — pied comparatif : le libellé du propriétaire, jamais un groupe recollé', () => {
  it('sert le libellé d’une comparaison réellement servie, jamais l’état indisponible de la base', () => {
    const capture = captureBarresStationnement()
    const { figures } = projeter(capture)
    const servis = labels(capture)
    expect(servis).toContain('Médiane des communes de EPCI X')
    expect(pied(servis, capture)).toBe('¹ Groupe comparé : Médiane des communes de EPCI X')
    expect(figures.flatMap((figure) => figure.unavailable).map((item) => item.message))
      .not.toContain('Comparaison indisponible')
  })

  it('suit la moyenne réellement servie (EPCI), sans la remplacer par une autre statistique', () => {
    const capture = capturePdfFixture('visiter-la-bretagne')
    const servis = labels(capture)
    expect(servis).toEqual(['Moyenne des communes de EPCI X'])
    expect(pied(servis, capture)).toBe('¹ Groupe comparé : Moyenne des communes de EPCI X')
    expect(pied(servis, capture)).not.toContain('Moyenne des communes bretonnes')
  })

  it('nomme la portée Bretagne quand le groupe et la comparaison servie sont Bretagne', () => {
    const capture = capturePdfFixture('visiter-la-bretagne', {
      selection: { etat: 'preset', preset: 'bretagne' },
    })
    const servis = labels(capture)
    expect(servis).toEqual(['Moyenne des communes bretonnes'])
    expect(pied(servis, capture)).toBe('¹ Groupe comparé : Moyenne des communes bretonnes')
    expect(pied(servis, capture)).not.toContain('communes de EPCI X')
  })

  it('nomme chaque preuve d’une même page avec son propre libellé, sans recoller les cohortes', () => {
    const capture: any = structuredClone(captureBarresStationnement())
    const figures = (capture as unknown as {
      figures: { slot: string; model: { figure: { comparisonLabel: string } } }[]
    }).figures
    const titles: Record<string, string> = {
      stationnement: 'Médiane des communes de EPCI X',
      ravitaillement: 'Moyenne des établissements de EPCI X',
    }
    for (const figure of figures) figure.model.figure.comparisonLabel = titles[figure.slot]!
    const servis = labels(capture)
    expect(servis).toEqual([
      'Médiane des communes de EPCI X',
      'Moyenne des établissements de EPCI X',
    ])
    expect(pied(servis, capture)).toBe(
      '¹ Groupe comparé : Médiane des communes de EPCI X · Moyenne des établissements de EPCI X',
    )
    expect(pied(servis, capture)).not.toContain('Médiane des communes de EPCI X — ')
    expect(pied(servis, capture)).not.toContain('de EPCI X — communes de EPCI X')
  })

  it('ne fabrique aucune statistique quand la capture n’en porte aucune', () => {
    const capture = captureRampeDense()
    const servis = labels(capture)
    expect(servis).toEqual([])
    expect(pied(servis, capture)).toBe('¹ Groupe comparé : communes de EPCI X')
    expect(pied(servis, capture)).not.toContain('Moyenne')
    expect(pied(servis, capture)).not.toContain('Médiane')
  })

  it('n’imprime aucun pied quand la comparaison est entièrement indisponible', async () => {
    const capture = capturePdfFixture('couverture-du-territoire')
    const figure = (capture as unknown as {
      figures: { family: string; model: { value: { fact: { comparison: { reference: unknown } | null } } } }[]
    }).figures.find((candidate) => candidate.family === 'mobilite-share')!
    expect(figure.model.value.fact.comparison?.reference).toBeNull()
    const { request, capture: requestCapture, figures } = projeter(capture)
    expect(figures.every((projection) => !preuveFigureComparative(projection, requestCapture))).toBe(true)

    const artifact = await composerDocumentAvecCorpsNatif(request, {
      signal: new AbortController().signal,
      chargerPolice: chargeurPoliceTest,
    }, [])
    const lecture = await lirePdf(artifact.blob)
    expect(lecture.lignes.some((ligne) => ligne.texte.startsWith('¹ Groupe comparé :'))).toBe(false)
  })

  it('refuse une capture incohérente (libellé publié vide) au lieu d’inventer une phrase', () => {
    const capture = captureBarresStationnement()
    expect(() => lignesPiedComparaison(['   '], capture, mesure)).toThrowError(
      expect.objectContaining({ code: 'inconsistent-capture' }),
    )
  })
})
