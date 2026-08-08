import { describe, expect, it } from 'vitest'

import {
  apercuAvecNAFixture,
  histoiresMilieuxFixture,
  indicateursMilieuxFixture,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import { nuageMilieux } from '../payload/selectors'
import type { HistoireMilieux, Payload } from '../payload/types'

/**
 * The Milieux block's quadrant-chart selector (issue #241, ADR-0011 + the
 * ADR-0017 pivot): the same-scale comparison-group cloud of the Démographie
 * nuage (codesComparaison), read for the MILIEUX fields — x = Δpopulation,
 * y = Δ(m²/inhab) = artif_m3_par_habitant − artif_m2_par_habitant. Every
 * point carries its OCS-GE state window (periodeArtif — the per-dépt span
 * for cross-département peers, carried as-is), so the hover can state the
 * millésime mixing rather than hide it.
 *
 * The invariant is locked here by construction: sign(ratio − 1) = sign(delta)
 * — the ratio's denominator is always positive, so the classification and
 * the graph can never disagree (the ADR-0011 lesson).
 */

const payloadMilieux: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursMilieuxFixture,
  histoires: histoiresMilieuxFixture,
  apercu: apercuAvecNAFixture,
  runReport: runReportFraisFixture,
  vintages: vintagesFixture,
  programmes: null,
}

/** La Story Milieux d'un territoire — le fixture, jamais inventée. */
function histoireDe(code: string): HistoireMilieux {
  const histoire = histoiresMilieuxFixture.find(
    (h): h is HistoireMilieux => h.theme === 'milieux' && h.territoire === code,
  )
  if (!histoire) throw new Error(`fixture : pas de Story Milieux pour ${code}`)
  return histoire
}

describe('nuageMilieux — the Milieux quadrant’s context cloud (ADR-0011)', () => {
  it('gives a commune in an EPCI its EPCI’s communes (peers at the same scale)', () => {
    const nuage = nuageMilieux(payloadMilieux, '22001')

    expect(nuage).not.toBeNull()
    expect(nuage?.map((p) => p.nom)).toEqual(['Commune A1', 'Commune D'])
  })

  it('gives a commune without an EPCI its département’s communes', () => {
    const territoiresSansEpci = territoiresFixture.map((t) =>
      t.territoire === '22001' ? { ...t, epci: null } : t,
    )
    const payloadSansEpci: Payload = { ...payloadMilieux, territoires: territoiresSansEpci }

    const nuage = nuageMilieux(payloadSansEpci, '22001')
    expect(nuage?.map((p) => p.nom)).toEqual(['Commune A1', 'Commune D'])
  })

  it('gives an EPCI the OTHER EPCIs of the region', () => {
    const nuage = nuageMilieux(payloadMilieux, '200000001')

    expect(nuage?.map((p) => p.nom)).toEqual(['EPCI Y'])
    expect(nuage?.[0]).toMatchObject({ type: 'epci', territoire: '200000002' })
  })

  it('gives a département the OTHER départements of the region', () => {
    const nuage = nuageMilieux(payloadMilieux, '22')

    expect(nuage?.map((p) => p.nom)).toEqual(['Département 29'])
    expect(nuage?.[0]).toMatchObject({ type: 'departement', territoire: '29' })
  })

  it('gives the région ALL the region’s communes', () => {
    const nuage = nuageMilieux(payloadMilieux, '53')

    expect(nuage?.map((p) => p.nom)).toEqual([
      'Commune A1',
      'Commune D',
      'Commune B',
      'Commune C',
    ])
  })

  it('carries each point’s two forces, its type/code and its state window', () => {
    const nuage = nuageMilieux(payloadMilieux, '200000001') // EPCI X → EPCI Y

    // EPCI Y (200000002) : Δpop −160, Δ(m²/hab) = 410 − 420 = −10, fenêtre 2021-2024
    expect(nuage?.[0]).toEqual({
      territoire: '200000002',
      type: 'epci',
      nom: 'EPCI Y',
      periodeArtif: '2021-2024',
      deltaPopulation: -160,
      deltaM2ParHabitant: -10,
    })
  })

  it('returns null for an unknown territory — never invents a cloud', () => {
    expect(nuageMilieux(payloadMilieux, '99999')).toBeNull()
  })

  it('proves the invariant: sign(ratio − 1) = sign(delta) over the WHOLE fixture', () => {
    for (const histoire of histoiresMilieuxFixture) {
      if (histoire.theme !== 'milieux') continue
      const nuage = nuageMilieux(payloadMilieux, histoire.territoire)
      expect(nuage, `nuage de ${histoire.territoire}`).not.toBeNull()
      for (const point of nuage ?? []) {
        // les lignes sans trajectoire (le trou NA honnête) sortent de la
        // preuve — le nuage ne trace pas de point sans états
        const ratio = histoireDe(point.territoire).trajectoire_artif_par_habitant
        if (ratio === null) continue
        expect(
          Math.sign(point.deltaM2ParHabitant),
          `${point.nom} : sign(delta) doit égaler sign(ratio − 1)`,
        ).toBe(Math.sign(ratio - 1))
      }
    }
  })

  it('plots a ratio < 1 with delta < 0 and a ratio > 1 with delta > 0 (the ADR-0011 lesson)', () => {
    // 22002 : trajectoire 0.95 < 1 → Δ(m²/hab) = 855 − 900 = −45 < 0 (densification)
    const nuage = nuageMilieux(payloadMilieux, '22001') // les communes de l'EPCI X
    expect(nuage?.find((p) => p.territoire === '22002')?.deltaM2ParHabitant).toBe(-45)
    // 22001 : trajectoire 1.133 > 1 → Δ(m²/hab) = 2550 − 2250 = +300 > 0 (étalement)
    expect(nuage?.find((p) => p.territoire === '22001')?.deltaM2ParHabitant).toBe(300)
  })

  it('carries the per-département span of a cross-département peer as-is (the millésime rider)', () => {
    // EPCI Y traverse 22+29 : sa fenêtre porte les deux paires de dates — le
    // nuage d'EPCI X (l'autre EPCI de la région) doit la transporter telle quelle.
    const histoiresTransversales = histoiresMilieuxFixture.map((h) =>
      h.territoire === '200000002'
        ? { ...h, periode_artif: '2021-2025 (22) · 2021-2024 (29)' }
        : h,
    )
    const payloadTransversal: Payload = { ...payloadMilieux, histoires: histoiresTransversales }

    const nuage = nuageMilieux(payloadTransversal, '200000001')
    expect(nuage?.[0]).toMatchObject({
      nom: 'EPCI Y',
      periodeArtif: '2021-2025 (22) · 2021-2024 (29)',
    })
  })

  it('carries the région’s four-window span — the mixing is stated, never hidden', () => {
    const nuage = nuageMilieux(payloadMilieux, '53')
    expect(nuage).not.toBeNull()
    // la région elle-même n'est pas dans son propre nuage (ses communes le sont)
    expect(nuage?.some((p) => p.territoire === '53')).toBe(false)
    // la fenêtre multi-dépt du fixture (53) est transportable par un pair — via le
    // sélecteur, aucun inventaire : la donnée brute traverse.
    expect(histoireDe('53').periode_artif).toBe('2021-2025 (22) · 2021-2024 (29)')
  })
})
