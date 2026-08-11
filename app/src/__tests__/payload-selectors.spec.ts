import { describe, expect, it } from 'vitest'

import {
  apercuAvecNAFixture,
  histoiresDemographieFixture,
  histoiresHabitatFixture,
  indicateursDemographieFixture,
  indicateursHabitatFixture,
  runReportEchecFixture,
  runReportManuelFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import {
  apercuPourTerritoire,
  formaterRang,
  ligneFraicheur,
  themesPresent,
  trouverTerritoire,
} from '../payload/selectors'
import type { Payload } from '../payload/types'

/**
 * The selectors are the ONLY logic worth locking in the payload layer
 * (component tests come later). They are pure: raw payload in, French
 * product strings out. Everything here hits external behavior — no DOM, no
 * network, no fetch layer.
 */

const payloadDemographie: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursDemographieFixture,
  histoires: histoiresDemographieFixture,
  apercu: apercuAvecNAFixture,
  runReport: runReportEchecFixture,
  vintages: vintagesFixture,
  programmes: null,
}

describe('themesPresent — the payload-driven tab bar (ADR-0007)', () => {
  it('returns only the themes present in the payload, in canonical order', () => {
    const payload: Payload = {
      ...payloadDemographie,
      indicateurs: [...indicateursDemographieFixture, ...indicateursHabitatFixture],
      histoires: [...histoiresDemographieFixture, ...histoiresHabitatFixture],
    }

    expect(themesPresent(payload)).toEqual(['demographie', 'habitat'])
  })

  it('never renders a theme that has no data (dead tabs never render)', () => {
    expect(themesPresent(payloadDemographie)).toEqual(['demographie'])
  })

  it('keeps the canonical order even when only the last theme exists', () => {
    const payload: Payload = {
      ...payloadDemographie,
      indicateurs: indicateursHabitatFixture,
      histoires: histoiresHabitatFixture,
    }

    expect(themesPresent(payload)).toEqual(['habitat'])
  })
})

describe('apercuPourTerritoire — the Aperçu tab assembly (ADR-0007)', () => {
  it('returns the basic stats for a territory, in payload order', () => {
    const lignes = apercuPourTerritoire(payloadDemographie, '22001')

    expect(lignes.map((l) => l.key)).toEqual(['population', 'densite', 'part_65_plus'])
    expect(lignes[0]).toMatchObject({ key: 'population', value: 2000, unit: 'hab.' })
  })

  it('NA-gates null values — a KPI not computable for the territory is skipped', () => {
    // 22002's part_65_plus is null in the fixture (non calculable)
    const lignes = apercuPourTerritoire(payloadDemographie, '22002')

    expect(lignes.map((l) => l.key)).toEqual(['population', 'densite'])
    expect(lignes.every((l) => l.value !== null)).toBe(true)
  })

  it('returns an empty array for an unknown territory', () => {
    expect(apercuPourTerritoire(payloadDemographie, '99999')).toEqual([])
  })
})

describe('formaterRang — the rank-in-context chip (ADR-0015)', () => {
  it('formats the ordinal position with its group size ("1er/41 de l’EPCI")', () => {
    expect(formaterRang(1, 41, 'rang_epci')).toBe("1er/41 de l'EPCI")
    expect(formaterRang(4, 8, 'rang_epci')).toBe("4e/8 de l'EPCI")
  })

  it('uses French ordinals (1er only for 1, "e" otherwise)', () => {
    expect(formaterRang(2, 2, 'rang_epci')).toBe("2e/2 de l'EPCI")
    expect(formaterRang(21, 61, 'rang_reg')).toBe('21e/61 de la région')
  })

  it('uses the comparison-group label from the rank column', () => {
    expect(formaterRang(2, 4, 'rang_dep')).toBe('2e/4 du département')
    expect(formaterRang(3, 61, 'rang_reg')).toBe('3e/61 de la région')
  })

  it('returns null for a null rank — no comparison group, no chip', () => {
    expect(formaterRang(null, null, 'rang_epci')).toBeNull()
    expect(formaterRang(null, null, 'rang_reg')).toBeNull()
  })
})

describe('ligneFraicheur — the freshness line', () => {
  it('falls back to the static rhythm when run-report is absent', () => {
    const payload: Payload = { ...payloadDemographie, runReport: null }

    expect(ligneFraicheur(payload)).toBe('Données actualisées chaque semaine')
  })

  it('renders the run timestamp in French when every source is fresh', () => {
    const payload: Payload = {
      ...payloadDemographie,
      runReport: {
        mode: 'full',
        timestamp: '2026-08-03T22:03:28Z',
        statuts: [
          { id: 'serie_historique', mode: 'cron', status: 'frais' },
          { id: 'menages', mode: 'cron', status: 'frais' },
        ],
      },
    }

    expect(ligneFraicheur(payload)).toBe('Données actualisées le 3 août 2026')
  })

  it('flags a failed source in the freshness line', () => {
    expect(ligneFraicheur(payloadDemographie)).toContain('2026')
    expect(ligneFraicheur(payloadDemographie)).toContain('échec')
  })

  it('flags a source left for manual handling', () => {
    const payload: Payload = { ...payloadDemographie, runReport: runReportManuelFixture }

    expect(ligneFraicheur(payload)).toContain('à traiter à la main')
  })
})

describe('trouverTerritoire — the reference lookup (names join)', () => {
  it('finds a territory by id with its real name', () => {
    const territoire = trouverTerritoire(payloadDemographie, '22001')

    expect(territoire).toMatchObject({ territoire: '22001', nom: 'Commune A1', type: 'commune' })
  })

  it('returns null for an unknown id', () => {
    expect(trouverTerritoire(payloadDemographie, '99999')).toBeNull()
  })

  it('joins the context-switcher ladder (commune → EPCI → département → région)', () => {
    const commune = trouverTerritoire(payloadDemographie, '29002')
    expect(commune?.epci).toBe('200000002')

    const epci = trouverTerritoire(payloadDemographie, '200000002')
    expect(epci?.nom).toBe('EPCI Y')

    const region = trouverTerritoire(payloadDemographie, '53')
    expect(region?.nom).toBe('Bretagne')
  })
})
