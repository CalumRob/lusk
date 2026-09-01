import { describe, expect, it } from 'vitest'

import { territoryFactsFor } from '@/fiche/content/territoryFacts'
import type {
  MobiliteAccessReader,
  MobiliteAccessSnapshot,
} from '@/fiche/content/territoryFacts'
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

const payload: Payload = {
  territoires: [
    { territoire: '22001', type: 'commune', nom: 'Commune A', departement: '22', epci: '200000001' },
    { territoire: '22002', type: 'commune', nom: 'Commune B', departement: '22', epci: '200000001' },
    { territoire: '29001', type: 'commune', nom: 'Commune C', departement: '29', epci: '200000002' },
    { territoire: '53', type: 'region', nom: 'Bretagne', departement: null, epci: null },
  ],
  indicateurs: [row('22001', 0.2), row('22002', 0.4), row('29001', 0.1)],
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

const access: MobiliteAccessReader = () => ({
  totalBatimentsBretons: 1000,
  batimentsTerritoire: 100,
  provenance: {
    sourceId: 'mobilite_snapshot',
    source: 'Snapshot Mobilité',
    version: '2026-02',
    referenceDate: '2026-02-01',
    publicationDate: '2026-02-15',
  },
  parts: {
    administration: { c: 1, b: 0.8, t: 0.7 },
    alimentation: { c: 1, b: 0.9, t: 0.85 },
    sante: { c: 1, b: 0.75, t: 0.65 },
    banque: { c: 1, b: 0.8, t: 0.7 },
    ecole: { c: 1, b: 0.9, t: 0.8 },
  },
})

describe('TerritoryFacts — the target-scoped Mobilité seam', () => {
  it('normalizes target facts, provenance, access data, and one runtime comparison context', () => {
    const facts = territoryFactsFor(payload, '22001', access)

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
      source: 'Snapshot Mobilité',
    })
    expect(facts?.mobility.access.byService.administration.walkTransit.comparison).toMatchObject({
      direction: 'plus-est-mieux',
      rank: { position: 1, size: 2 },
      reference: { kind: 'median', value: 0.7 },
    })
    expect(facts?.mobility.bpeAccess).toEqual({ availability: 'absent', profiles: [] })
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

    const facts = territoryFactsFor(bpePayload, '22001', access)

    expect(facts?.mobility.bpeAccess).toEqual({
      availability: 'complete',
      profiles: [
        {
          profile: 'velo-compense',
          label: 'Le vélo compense',
          count: 3,
          exemplar: {
            typequ: 'D267',
            label: 'Spécialiste en dermatologie vénéréologie',
            car: 0.1,
            bike: 0.4,
            walkTransit: 0.1,
          },
        },
      ],
    })
  })

  it('prefers published share facts for access evidence and ranks them in the same scope', () => {
    const directAccessPayload: Payload = {
      ...payload,
      indicateurs: [
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
    const facts = territoryFactsFor(directAccessPayload, '22001', () => ({
      totalBatimentsBretons: 1000,
      batimentsTerritoire: 100,
      provenance: {
        sourceId: 'legacy-reader',
        source: 'Legacy reader',
        version: 'old',
        referenceDate: null,
        publicationDate: null,
      },
      parts: { administration: { t: 0.1 } },
    }))
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

  it('uses all regional communes for a commune without an EPCI and keeps ties direction-aware', () => {
    const regionalPayload: Payload = {
      ...payload,
      territoires: payload.territoires.map((territoire) =>
        territoire.type === 'commune' ? { ...territoire, epci: null } : territoire,
      ),
      indicateurs: [row('22001', 0.3), row('22002', 0.3), row('29001', 0.8)],
    }

    const facts = territoryFactsFor(regionalPayload, '22001', () => null)
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

    const epci = territoryFactsFor(scopedPayload, '200000001', () => null)
    const departement = territoryFactsFor(scopedPayload, '22', () => null)
    const region = territoryFactsFor(scopedPayload, '53', () => null)

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

    const indicator = territoryFactsFor(highPayload, '22001', () => null)?.mobility.indicators[0]

    expect(indicator?.comparison).toMatchObject({
      direction: 'plus-est-mieux',
      rank: { position: 1, size: 2 },
      reference: { kind: 'median', value: 0.30000000000000004 },
    })
  })

  it('marks null and missing source facts honestly instead of manufacturing values', () => {
    const partialAccess: MobiliteAccessReader = () => ({
      totalBatimentsBretons: 1000,
      batimentsTerritoire: 100,
      provenance: {
        sourceId: 'mobilite_snapshot',
        source: 'Snapshot Mobilité',
        version: '2026-02',
        referenceDate: '2026-02-01',
        publicationDate: '2026-02-15',
      },
      parts: { administration: { c: 1, t: null } },
    })
    const facts = territoryFactsFor(payload, '22001', partialAccess)
    const absent = territoryFactsFor(payload, '22001', () => null)

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

  it('keeps mobility facts from the transitional reading data without exposing its selection fields', () => {
    const facts = territoryFactsFor(
      { ...payload, histoires: histoiresMobiliteFixture },
      '22001',
      () => null,
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

  it('normalizes the walk/transit distribution and computes payload-owned summary ranks and medians for every mode', () => {
    const snapshot = (car: number, bike: number, walkTransit: number): MobiliteAccessSnapshot => ({
      totalBatimentsBretons: 1000,
      batimentsTerritoire: 100,
      provenance: {
        sourceId: 'mobilite_snapshot',
        source: 'Snapshot Mobilité',
        version: '2026-02',
        referenceDate: '2026-02-01',
        publicationDate: '2026-02-15',
      },
      parts: Object.fromEntries(
        ['administration', 'alimentation', 'sante', 'banque', 'ecole'].map((service) => [
          service,
          { c: car, b: bike, t: walkTransit },
        ]),
      ),
    })
    const snapshots: Record<string, MobiliteAccessSnapshot> = {
      '22001': snapshot(1, 0.8, 0.6),
      '22002': snapshot(0.5, 0.4, 0.3),
    }
    const reader: MobiliteAccessReader = (territoire) => snapshots[territoire] ?? null
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
      reader,
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
        mode === 'car' ? 0.75 : mode === 'bike' ? 0.6 : 0.45,
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

    const facts = territoryFactsFor(parityPayload, '22001', () => null)
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

    const indicator = territoryFactsFor(missingPayload, '22001', () => null)?.mobility.indicators[0]

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

    const indicator = territoryFactsFor(missingPeerPayload, '22001', () => null)?.mobility.indicators[0]

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

    const epciFacts = territoryFactsFor(parityPayload, '200000001', () => null)
    const departementFacts = territoryFactsFor(parityPayload, '22', () => null)
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

    const indicator = territoryFactsFor(unknownPayload, '22001', () => null)?.mobility.indicators[0]

    expect(indicator).toMatchObject({ value: 0.2, availability: 'complete', comparison: null })
  })
})
