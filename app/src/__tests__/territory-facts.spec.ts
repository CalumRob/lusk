import { describe, expect, it } from 'vitest'

import { territoryFactsFor } from '@/fiche/content/territoryFacts'

  it('#627 - the retired legacy accessibility resolvers no longer cross the seam', () => {
    const facts = territoryFactsFor(payload, '22001')
    expect(facts).not.toBeNull()
    for (const field of ['access', 'bpeAccess', 'losses', 'buildingDistribution', 'accessRamp']) {
      expect(field in facts!.mobility, field).toBe(false)
    }
    // The retained indicator comparison stays a plain median over the peer
    // scope (the building-weighted mean was the retired avg_* statistic).
    const indicator = facts?.mobility.indicators.find((fact) => fact.key === 'surface_reseaux_routiers')
    expect(indicator?.comparison).toMatchObject({
      direction: 'moins-est-mieux',
      rank: { position: 1, size: 2 },
      reference: { kind: 'median' },
    })
  })
import type { Indicateur, Payload } from '@/payload/types'

const vintage = {
  vintage_source: 'Source de test',
  vintage_version: '2026',
  vintage_date_reference: '2026-01-01',
  vintage_date_publication: '2026-02-01',
}

interface PublishedRank {
  rank: number
  size: number
}

interface PublishedRanks {
  epci?: PublishedRank
  dep?: PublishedRank
  reg?: PublishedRank
}

const row = (
  territoire: string,
  value: number | null,
  publishedRanks: PublishedRanks | null = null,
): Indicateur => ({
  territoire,
  type:
    territoire === '53'
      ? 'region'
      : ['22', '29', '35', '56'].includes(territoire)
        ? 'departement'
        : /^\d{9}$/.test(territoire)
          ? 'epci'
          : 'commune',
  theme: 'mobilite',
  key: 'surface_reseaux_routiers',
  detail: null,
  value,
  unit: '%',
  rang_epci: publishedRanks?.epci?.rank ?? null,
  rang_epci_n: publishedRanks?.epci?.size ?? null,
  rang_dep: publishedRanks?.dep?.rank ?? null,
  rang_dep_n: publishedRanks?.dep?.size ?? null,
  rang_reg: publishedRanks?.reg?.rank ?? null,
  rang_reg_n: publishedRanks?.reg?.size ?? null,
  ...vintage,
})

const highDirectionRow = (territoire: string, value: number): Indicateur => ({
  ...row(territoire, value),
  key: 'voitures_menage',
  detail: 'sans_voiture',
})

const payload: Payload = {
  territoires: [
    { territoire: '22001', type: 'commune', nom: 'Commune A', departement: '22', epci: '200000001' },
    { territoire: '22002', type: 'commune', nom: 'Commune B', departement: '22', epci: '200000001' },
    { territoire: '29001', type: 'commune', nom: 'Commune C', departement: '29', epci: '200000002' },
    { territoire: '53', type: 'region', nom: 'Bretagne', departement: null, epci: null },
  ],
  indicateurs: [
    row('22001', 0.2),
    row('22002', 0.4),
    row('29001', 0.1),
  ],
  histoires: [],
  apercu: null,
  runReport: null,
  vintages: [
    {
      id: 'mobilite_snapshot',
      source: 'Snapshot Mobilité',
      version: '2026-02',
      licence: 'ODbL',
      date_reference: '2026-02-01',
      date_publication: '2026-02-15',
    },
  ],
  programmes: null,
}

describe('TerritoryFacts — the target-scoped Mobilité seam', () => {

  it('uses all regional communes for a commune without an EPCI and keeps ties direction-aware', () => {
    const regionalPayload: Payload = {
      ...payload,
      territoires: payload.territoires.map((territoire) =>
        territoire.type === 'commune' ? { ...territoire, epci: null } : territoire,
      ),
      indicateurs: [row('22001', 0.3), row('22002', 0.3), row('29001', 0.8)],
    }

    const facts = territoryFactsFor(regionalPayload, '22001')
    const indicator = facts?.mobility.indicators.find((fact) => fact.key === 'surface_reseaux_routiers')

    expect(indicator?.comparison).toMatchObject({
      direction: 'moins-est-mieux',
      scope: {
        kind: 'communes-bretagne',
        territoryIds: ['22001', '22002', '29001'],
      },
      rank: { position: 1, size: 3 },
      reference: { kind: 'median', value: 0.3 },
    })
  })

  it('uses the documented regional EPCI and département scopes, and no scope for the région', () => {
    const scopedPayload: Payload = {
      ...payload,
      territoires: [
        ...payload.territoires,
        { territoire: '200000001', type: 'epci', nom: 'EPCI X', departement: '22', epci: null },
        { territoire: '200000002', type: 'epci', nom: 'EPCI Y', departement: '29', epci: null },
        { territoire: '22', type: 'departement', nom: 'Côtes-d’Armor', departement: '22', epci: null },
        { territoire: '29', type: 'departement', nom: 'Finistère', departement: '29', epci: null },
      ],
      indicateurs: [
        row('200000001', 0.3),
        row('200000002', 0.4),
        row('22', 0.3),
        row('29', 0.5),
        row('53', 0.3),
      ],
    }

    const epci = territoryFactsFor(scopedPayload, '200000001')
    const departement = territoryFactsFor(scopedPayload, '22')
    const region = territoryFactsFor(scopedPayload, '53')

    expect(epci?.mobility.indicators[0]?.comparison).toMatchObject({
      scope: { kind: 'epcis-bretagne', territoryIds: ['200000001', '200000002'] },
      rank: { position: 1, size: 2 },
      reference: { kind: 'median', value: 0.35 },
    })
    expect(departement?.mobility.indicators[0]?.comparison).toMatchObject({
      scope: { kind: 'departements-bretagne', territoryIds: ['22', '29'] },
      rank: { position: 1, size: 2 },
      reference: { kind: 'median', value: 0.4 },
    })
    expect(region?.mobility.indicators[0]?.comparison).toBeNull()
  })

  it('ranks a high-is-good indicator from the largest value first', () => {
    const highPayload: Payload = {
      ...payload,
      indicateurs: [highDirectionRow('22001', 0.4), highDirectionRow('22002', 0.2)],
    }

    const indicator = territoryFactsFor(highPayload, '22001')?.mobility.indicators[0]

    expect(indicator?.comparison).toMatchObject({
      direction: 'plus-est-mieux',
      rank: { position: 1, size: 2 },
      reference: { kind: 'median', value: 0.30000000000000004 },
    })
  })

  it('matches an available published rank while leaving the compatibility payload untouched', () => {
    const parityPayload: Payload = {
      ...payload,
      indicateurs: [
        row('22001', 0.2, { epci: { rank: 1, size: 2 } }),
        row('22002', 0.4, { epci: { rank: 2, size: 2 } }),
      ],
    }
    const before = structuredClone(parityPayload.indicateurs)

    const facts = territoryFactsFor(parityPayload, '22001')
    const indicator = facts?.mobility.indicators[0]
    const published = parityPayload.indicateurs.find((row) => row.territoire === '22001')

    expect(indicator?.comparison?.rank).toEqual({
      position: published?.rang_epci,
      size: published?.rang_epci_n,
    })
    expect(parityPayload.indicateurs).toEqual(before)
  })

  it('does not rank a missing target value when fewer than two peers are usable', () => {
    const missingPayload: Payload = {
      ...payload,
      indicateurs: [row('22001', null), row('22002', 0.4)],
    }

    const indicator = territoryFactsFor(missingPayload, '22001')?.mobility.indicators[0]

    expect(indicator).toMatchObject({
      value: null,
      availability: 'incomplete',
      comparison: {
        rank: null,
        reference: null,
      },
    })
  })

  it('does not self-rank when a missing peer leaves only the focal commune usable', () => {
    const missingPeerPayload: Payload = {
      ...payload,
      indicateurs: [row('22001', 0.2), row('22002', null)],
    }

    const indicator = territoryFactsFor(missingPeerPayload, '22001')?.mobility.indicators[0]

    expect(indicator?.comparison).toMatchObject({
      rank: null,
      reference: null,
    })
  })

  it('checks published rank parity at EPCI and département scales without rewriting ranks', () => {
    const parityPayload: Payload = {
      ...payload,
      territoires: [
        ...payload.territoires,
        { territoire: '200000001', type: 'epci', nom: 'EPCI X', departement: '22', epci: null },
        { territoire: '200000002', type: 'epci', nom: 'EPCI Y', departement: '29', epci: null },
        { territoire: '22', type: 'departement', nom: 'Côtes-d’Armor', departement: '22', epci: null },
        { territoire: '29', type: 'departement', nom: 'Finistère', departement: '29', epci: null },
      ],
      indicateurs: [
        row('200000001', 0.3, { reg: { rank: 1, size: 2 } }),
        row('200000002', 0.4, { reg: { rank: 2, size: 2 } }),
        row('22', 0.3, { reg: { rank: 1, size: 2 } }),
        row('29', 0.5, { reg: { rank: 2, size: 2 } }),
      ],
    }
    const before = structuredClone(parityPayload.indicateurs)

    const epciFacts = territoryFactsFor(parityPayload, '200000001')
    const departementFacts = territoryFactsFor(parityPayload, '22')
    const epciPublished = parityPayload.indicateurs.find((row) => row.territoire === '200000001')
    const departementPublished = parityPayload.indicateurs.find((row) => row.territoire === '22')

    expect(epciFacts?.mobility.indicators[0]?.comparison?.rank).toEqual({
      position: epciPublished?.rang_reg,
      size: epciPublished?.rang_reg_n,
    })
    expect(departementFacts?.mobility.indicators[0]?.comparison?.rank).toEqual({
      position: departementPublished?.rang_reg,
      size: departementPublished?.rang_reg_n,
    })
    expect(parityPayload.indicateurs).toEqual(before)
  })

  it('does not invent a comparison direction for an undocumented payload key', () => {
    const unknownPayload: Payload = {
      ...payload,
      indicateurs: [{ ...row('22001', 0.2), key: 'future_mobility_key' }],
    }

    const indicator = territoryFactsFor(unknownPayload, '22001')?.mobility.indicators[0]

    expect(indicator).toMatchObject({ value: 0.2, availability: 'complete', comparison: null })
  })
})
