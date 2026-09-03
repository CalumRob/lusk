import { describe, expect, it } from 'vitest'

import { territoryFactsFor } from '@/fiche/content/territoryFacts'
import { histoiresMobiliteFixture } from '@/payload/fixtures'
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
  key: 'iso_sante',
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

const averageRow = (territoire: string, key: string, value: number): Indicateur => ({
  ...row(territoire, value),
  key,
  unit: key.startsWith('avg_tot_') ? 'équipements / bâtiment' : 'types d’équipement / bâtiment',
})

const buildingCountRow = (territoire: string, value: number): Indicateur => ({
  ...row(territoire, value),
  key: 'nb_buildings',
  unit: 'bâtiments',
})

const accessRows: Indicateur[] = [
  ['share_admin_c', 1],
  ['share_admin_b', 0.8],
  ['share_admin_t', 0.7],
  ['share_food_c', 1],
  ['share_food_b', 0.9],
  ['share_food_t', 0.85],
  ['share_health_c', 1],
  ['share_health_b', 0.75],
  ['share_health_t', 0.65],
  ['share_bank_c', 1],
  ['share_bank_b', 0.8],
  ['share_bank_t', 0.7],
  ['share_school_c', 1],
  ['share_school_b', 0.9],
  ['share_school_t', 0.8],
].flatMap(([key, value]) =>
  ['22001', '22002'].map((territoire) => ({
    ...row(territoire, value as number),
    key: key as string,
  })),
)

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
    buildingCountRow('22001', 100),
    buildingCountRow('22002', 100),
    buildingCountRow('53', 1000),
    ...accessRows,
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
  it('normalizes target facts, provenance, access data, and one runtime comparison context', () => {
    const facts = territoryFactsFor(payload, '22001')

    expect(facts).not.toBeNull()
    expect(facts?.territory).toEqual({
      code: '22001',
      type: 'commune',
      name: 'Commune A',
      department: '22',
      epci: '200000001',
    })
    expect(facts?.theme).toBe('mobilite')

    const indicator = facts?.mobility.indicators.find((fact) => fact.key === 'iso_sante')
    expect(indicator).toMatchObject({
      key: 'iso_sante',
      value: 0.2,
      unit: '%',
      availability: 'complete',
      provenance: {
        sourceId: 'mobilite_snapshot',
        source: 'Source de test',
        version: '2026',
      },
      comparison: {
        direction: 'moins-est-mieux',
        scope: {
          kind: 'communes-epci',
          territoryIds: ['22001', '22002'],
        },
        rank: { position: 1, size: 2 },
        reference: { kind: 'median', value: 0.30000000000000004 },
      },
    })
    expect(indicator).not.toHaveProperty('rang_epci')

    expect(facts?.mobility.access).toMatchObject({
      availability: 'complete',
      totalBuildings: { value: 100, availability: 'complete' },
      totalBrittanyBuildings: { value: 1000, availability: 'complete' },
      byService: {
        administration: {
          car: { value: 1, availability: 'complete' },
          bike: { value: 0.8, availability: 'complete' },
          walkTransit: { value: 0.7, availability: 'complete' },
        },
      },
    })
    expect(facts?.mobility.access.byService.administration.walkTransit.provenance).toMatchObject({
      sourceId: 'mobilite_snapshot',
      source: 'Source de test',
    })
    expect(facts?.mobility.access.byService.administration.walkTransit.comparison).toMatchObject({
      direction: 'plus-est-mieux',
      rank: { position: 1, size: 2 },
      reference: { kind: 'median', value: 0.7 },
    })
    expect(facts?.mobility.access.gapsByService.administration).toMatchObject({
      carGap: {
        value: 0.30000000000000004,
        comparison: { direction: 'moins-est-mieux', rank: null, reference: { kind: 'median', value: 0.30000000000000004 } },
      },
      bikeGain: {
        value: 0.10000000000000009,
        comparison: { direction: 'plus-est-mieux', rank: null, reference: { kind: 'median', value: 0.10000000000000009 } },
      },
    })
    expect(facts?.mobility.bpeAccess).toEqual({ availability: 'absent', profiles: [] })
  })

  it('uses an unweighted median for service-share peers even when building counts differ', () => {
    const medianPayload = structuredClone(payload)
    const peerBuildingCount = medianPayload.indicateurs.find(
      (candidate) => candidate.territoire === '22002' && candidate.key === 'nb_buildings',
    )
    if (!peerBuildingCount) throw new Error('Missing peer building count')
    peerBuildingCount.value = 900

    const targetShare = medianPayload.indicateurs.find(
      (candidate) => candidate.territoire === '22001' && candidate.key === 'share_admin_c',
    )
    const peerShare = medianPayload.indicateurs.find(
      (candidate) => candidate.territoire === '22002' && candidate.key === 'share_admin_c',
    )
    if (!targetShare || !peerShare) throw new Error('Missing administration shares')
    targetShare.value = 0.9
    peerShare.value = 0.1

    const facts = territoryFactsFor(medianPayload, '22001')

    expect(facts?.mobility.access.byService.administration.car.comparison?.reference).toEqual({
      kind: 'median',
      value: 0.5,
    })
  })

  it('normalizes the bounded BPE profile rows without exposing raw payload names', () => {
    const bpePayload: Payload = {
      ...payload,
      profilsAccesBpe: [
        {
          territoire: '22001',
          type: 'commune',
          profil: 'velo-compense',
          profil_libelle: 'Le vélo compense',
          nombre_typequ: 3,
          exemplar_typequ: 'D267',
          exemplar_libelle: 'Spécialiste en dermatologie vénéréologie',
          exemplar_c: 0.1,
          exemplar_b: 0.4,
          exemplar_t: 0.1,
        },
      ],
    }

    const facts = territoryFactsFor(bpePayload, '22001')

    expect(facts?.mobility.bpeAccess?.availability).toBe('complete')
    expect(facts?.mobility.bpeAccess?.profiles.map((profile) => profile.profile)).toEqual([
      'acces-pied-tc',
      'velo-compense',
      'voiture-requise',
      'inaccessible-20-minutes',
    ])
    expect(facts?.mobility.bpeAccess?.profiles[0]).toMatchObject({
      count: 0,
      exemplar: null,
       comparison: { reference: { kind: 'mean', value: 0 } },
    })
    expect(facts?.mobility.bpeAccess?.profiles[1]).toMatchObject({
      count: 3,
      label: 'Le vélo compense',
      exemplar: {
        typequ: 'D267',
        label: 'Spécialiste en dermatologie vénéréologie',
        car: 0.1,
        bike: 0.4,
        walkTransit: 0.1,
      },
       comparison: { reference: { kind: 'mean', value: 3 } },
    })
    expect(facts?.mobility.bpeAccess?.profiles[2]).toMatchObject({
      count: 0,
      exemplar: null,
       comparison: { reference: { kind: 'mean', value: 0 } },
    })
    expect(facts?.mobility.bpeAccess?.profiles[3]).toMatchObject({
      count: 0,
      exemplar: null,
       comparison: { reference: { kind: 'mean', value: 0 } },
    })
  })

  it('prefers published share facts for access evidence and ranks them in the same scope', () => {
    const directAccessPayload: Payload = {
      ...payload,
      indicateurs: [
        buildingCountRow('22001', 100),
        buildingCountRow('22002', 100),
        { ...row('22001', 0.8), key: 'share_admin_t' },
        { ...row('22002', 0.6), key: 'share_admin_t' },
      ],
      themeMetadata: {
        mobilite: {
          theme: 'mobilite',
          label: 'Mobilité',
          subgroups: [],
          indicator_keys: ['share_admin_t'],
          story_keys: [],
          sources: { share_admin_t: 'mobilite_snapshot' },
          indicator_labels: {
            share_admin_t: 'Part des bâtiments avec accès aux services administratifs',
          },
          detail_labels: {},
          param_labels: {},
        },
      },
    }
    const facts = territoryFactsFor(directAccessPayload, '22001')
    const accessFact = facts?.mobility.access.byService.administration.walkTransit

    expect(accessFact).toMatchObject({
      value: 0.8,
      availability: 'complete',
      provenance: { sourceId: 'mobilite_snapshot', source: 'Source de test' },
      comparison: {
        direction: 'plus-est-mieux',
        scope: { kind: 'communes-epci', territoryIds: ['22001', '22002'] },
        rank: { position: 1, size: 2 },
        reference: { kind: 'median', value: 0.7 },
      },
    })
  })

  it('uses the median rather than the weighted mean for essential-service access references', () => {
    const meanPayload: Payload = {
      ...payload,
      territoires: [
        ...payload.territoires,
        {
          territoire: '22003',
          type: 'commune',
          nom: 'Commune D',
          departement: '22',
          epci: '200000001',
        },
      ],
      indicateurs: [
        ...payload.indicateurs,
        buildingCountRow('22003', 800),
        { ...row('22003', 0.1), key: 'share_admin_t' },
      ],
    }

    const facts = territoryFactsFor(meanPayload, '22001')
    const comparison = facts?.mobility.access.byService.administration.walkTransit.comparison

    expect(comparison?.reference).toEqual({ kind: 'median', value: 0.7 })
  })

  it('uses all regional communes for a commune without an EPCI and keeps ties direction-aware', () => {
    const regionalPayload: Payload = {
      ...payload,
      territoires: payload.territoires.map((territoire) =>
        territoire.type === 'commune' ? { ...territoire, epci: null } : territoire,
      ),
      indicateurs: [row('22001', 0.3), row('22002', 0.3), row('29001', 0.8)],
    }

    const facts = territoryFactsFor(regionalPayload, '22001')
    const indicator = facts?.mobility.indicators.find((fact) => fact.key === 'iso_sante')

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

  it('marks null and missing source facts honestly instead of manufacturing values', () => {
    const partialPayload: Payload = {
      ...payload,
      indicateurs: [
        buildingCountRow('22001', 100),
        buildingCountRow('53', 1000),
        { ...row('22001', 1), key: 'share_admin_c' },
        { ...row('22001', null), key: 'share_admin_t' },
      ],
    }
    const facts = territoryFactsFor(partialPayload, '22001')
    const absent = territoryFactsFor({ ...payload, indicateurs: [row('22001', 0.2)] }, '22001')

    expect(facts?.mobility.access.availability).toBe('incomplete')
    expect(facts?.mobility.access.byService.administration.car.availability).toBe('complete')
    expect(facts?.mobility.access.byService.administration.walkTransit).toMatchObject({
      value: null,
      availability: 'incomplete',
      comparison: null,
    })
    expect(facts?.mobility.access.byService.alimentation.car.availability).toBe('absent')

    expect(absent?.mobility.access.availability).toBe('absent')
    expect(absent?.mobility.access.totalBuildings.availability).toBe('absent')
    expect(absent?.mobility.losses.diversityWalkTransit.availability).toBe('absent')
  })

  it('keeps mobility facts from the payload without exposing its selection fields', () => {
    const facts = territoryFactsFor(
      { ...payload, histoires: histoiresMobiliteFixture },
      '22001',
    )

    expect(facts?.mobility.losses.diversityWalkTransit).toMatchObject({
      key: 'div_loss_t',
      value: 38,
      availability: 'complete',
      provenance: { sourceId: 'mobilite_snapshot', version: '2026-02' },
      comparison: {
        scope: { kind: 'communes-epci', territoryIds: ['22001', '22002'] },
        rank: { position: 2, size: 2 },
        reference: { kind: 'median', value: 31 },
      },
    })
    expect(facts).not.toHaveProperty('story_key')
    expect(facts?.mobility.losses).not.toHaveProperty('story_key')
  })

  it('keeps median service references and computes weighted means for summary access modes', () => {
    const summaryPayload: Payload = {
      ...payload,
      indicateurs: [
        ...payload.indicateurs,
        averageRow('22001', 'avg_tot_car', 100),
        averageRow('22001', 'avg_tot_b', 80),
        averageRow('22001', 'avg_tot_t', 60),
        averageRow('22001', 'avg_div_car', 50),
        averageRow('22001', 'avg_div_b', 40),
        averageRow('22001', 'avg_div_t', 30),
        averageRow('22002', 'avg_tot_car', 50),
        averageRow('22002', 'avg_tot_b', 40),
        averageRow('22002', 'avg_tot_t', 30),
        averageRow('22002', 'avg_div_car', 25),
        averageRow('22002', 'avg_div_b', 20),
        averageRow('22002', 'avg_div_t', 15),
      ],
    }
    const facts = territoryFactsFor(
      { ...summaryPayload, histoires: histoiresMobiliteFixture },
      '22001',
    )

    expect(facts?.mobility.losses).not.toHaveProperty('fullyIsolatedShare')
    expect(facts?.mobility.losses.distributionWalkTransit).toMatchObject({ min: 28, max: 47 })
    expect(facts?.mobility.losses.distributionWalkTransit?.densities.slice(0, 2)).toEqual([
      0.005915,
      0.014869,
    ])
    expect(facts?.mobility.losses.distributionWalkTransit?.quantiles.slice(0, 2)).toEqual([
      33.7,
      35,
    ])
    expect(facts?.mobility.losses.distributionPeers).toEqual([
      expect.objectContaining({
        territoire: expect.objectContaining({ code: '22001' }),
        value: 38,
      }),
      expect.objectContaining({
        territoire: expect.objectContaining({ code: '22002' }),
        value: 24,
      }),
    ])

    for (const mode of ['car', 'bike', 'walkTransit'] as const) {
      const comparison = facts?.mobility.access.byService.administration[mode].comparison
      expect(comparison).toMatchObject({
        direction: 'plus-est-mieux',
        scope: { kind: 'communes-epci', territoryIds: ['22001', '22002'] },
        rank: { position: 1, size: 2 },
        reference: { kind: 'median', value: expect.any(Number) },
      })
      expect(comparison?.reference?.value).toBeCloseTo(
        mode === 'car' ? 1 : mode === 'bike' ? 0.8 : 0.7,
        10,
      )
    }
    expect(facts?.mobility.access.summary).toMatchObject({
      availability: 'complete',
      accessibleEquipment: {
        car: { key: 'avg_tot_car', value: 100 },
        bike: { key: 'avg_tot_b', value: 80 },
        walkTransit: { key: 'avg_tot_t', value: 60 },
      },
      accessibleTypes: {
        car: { key: 'avg_div_car', value: 50 },
        bike: { key: 'avg_div_b', value: 40 },
        walkTransit: { key: 'avg_div_t', value: 30 },
      },
    })
    expect(facts?.mobility.access.summary.averageLosses).toMatchObject({
      total: {
        walkTransit: {
          key: 'avg_loss_tot_t',
          value: 40,
          comparison: { rank: { position: 2, size: 2 }, reference: { value: 30 } },
        },
        bike: {
          key: 'avg_loss_tot_b',
          value: 20,
          comparison: { rank: { position: 2, size: 2 }, reference: { value: 15 } },
        },
      },
      diversity: {
        walkTransit: {
          key: 'avg_loss_div_t',
          value: 20,
          comparison: { rank: { position: 2, size: 2 }, reference: { value: 15 } },
        },
        bike: {
          key: 'avg_loss_div_b',
          value: 10,
          comparison: { rank: { position: 2, size: 2 }, reference: { value: 7.5 } },
        },
      },
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

  it('does not rank a missing target value, while retaining the available reference', () => {
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
        reference: { kind: 'median', value: 0.4 },
      },
    })
  })

  it('excludes a missing peer from both the rank denominator and the reference', () => {
    const missingPeerPayload: Payload = {
      ...payload,
      indicateurs: [row('22001', 0.2), row('22002', null)],
    }

    const indicator = territoryFactsFor(missingPeerPayload, '22001')?.mobility.indicators[0]

    expect(indicator?.comparison).toMatchObject({
      rank: { position: 1, size: 1 },
      reference: { kind: 'median', value: 0.2 },
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
