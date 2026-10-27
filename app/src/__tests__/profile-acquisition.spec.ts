import { describe, expect, it } from 'vitest'
import { adapterProfilDeclare } from '@/payload/profileAcquisition'
import type { SemanticResourceDeclaration } from '@/payload/semanticResourceClient'
import type { Territoire } from '@/payload/types'

const declaration: SemanticResourceDeclaration = {
  resource_id: 'mix_logements', theme_id: 'habitat', indicator_id: 'mix_logements',
  label: 'Mix natif API', unit: '%', direction: 'high',
  allowed_levels: ['commune', 'epci', 'departement'], sources: ['logements'],
  shapes: ['declared_profile'], target_kinds: ['territory', 'territory_cohort'],
  axes: ['detail'], axis_values: [['detail', ['principales', 'vacantes']]],
  fields: ['value'], intents: ['facts', 'selected_comparison'],
}

const territories: Territoire[] = [
  { territoire: '22001', type: 'commune', nom: 'Focal', departement: '22', epci: 'E1' },
  { territoire: '22002', type: 'commune', nom: 'Pair', departement: '22', epci: 'E1' },
  { territoire: '29001', type: 'commune', nom: 'Other', departement: '29', epci: 'E2' },
]

const source = { source_id: 'logements', vintage_id: 'rp-2023', name: 'INSEE — Logements',
  version: '2023', reference_date: '2023-01-01', publication_date: '2026-06-30' }
const descriptor = {
  indicator: 'mix_logements', label: 'Mix natif API', unit: '%',
  allowed_levels: ['commune', 'epci', 'departement'], completeness: 'dense_complete',
  descriptor_version: 'profile-d1', denominator_semantics: 'logements',
  comparison_scalar: null, required_scalar_version: null,
  comparison_point: { detail: 'principales', sex: null, direction: 'high', unit: '%' },
  axes: [
    { name: 'detail', key: 'principales', label: 'Résidences principales', order: 0, unit: '%' },
    { name: 'detail', key: 'vacantes', label: 'Logements vacants', order: 1, unit: '%' },
  ],
}

function cell(detail: string, value: number | null, status = 'measured') {
  return { detail, sex: null, unit: '%', denominator_semantics: 'logements', status,
    value: status === 'measured' ? value : null, sources: [source] }
}

function cohortResponse() {
  const members = [
    { id: '22001', type: 'commune', name: 'Focal' },
    { id: '22002', type: 'commune', name: 'Pair' },
  ]
  return { resource: 'mix_logements', shape: 'declared_profile',
    target: { kind: 'territory_cohort', type: 'commune', department_id: '22', epci_id: null },
    content_version: 'profile-c1', reference_content_version: 'territories-r1', descriptor,
    cohort: { territory_type: 'commune', department_id: '22', epci_id: null,
      member_count: 2, members, reference_content_version: 'territories-r1' },
    profiles: members.map((territory) => ({ territory,
      cells: territory.id === '22001' ? [cell('principales', .72), cell('vacantes', .08)]
        : [cell('principales', .61), cell('vacantes', .12)] })) }
}

describe('l’acquisition du profil déclaré', () => {
  it('adapte les faits natifs du cohort en conservant axes, unités, statuts, provenance et horloges', () => {
    const result = adapterProfilDeclare({
      declaration, target: { type: 'commune', department_id: '22', epci_id: null }, territories,
      cohort: cohortResponse(),
    })

    expect(result.facts.map(({ territoire, detail, value, unit, fact_status, vintage_source }) =>
      [territoire, detail, value, unit, fact_status, vintage_source])).toEqual([
      ['22001', 'principales', .72, '%', 'measured', 'INSEE — Logements'],
      ['22001', 'vacantes', .08, '%', 'measured', 'INSEE — Logements'],
      ['22002', 'principales', .61, '%', 'measured', 'INSEE — Logements'],
      ['22002', 'vacantes', .12, '%', 'measured', 'INSEE — Logements'],
    ])
    expect(result.descriptor.axes.map(({ key, label, order, unit }) => [key, label, order, unit])).toEqual([
      ['principales', 'Résidences principales', 0, '%'], ['vacantes', 'Logements vacants', 1, '%'],
    ])
    expect(result.facts[0]).toMatchObject({ denominator_semantics: 'logements', nativeContract: {
      completeness: 'dense_complete', denominatorSemantics: 'logements', descriptorVersion: 'profile-d1',
      contentVersion: 'profile-c1', referenceContentVersion: 'territories-r1',
    } })
    expect(result.facts[0]?.fact_sources?.[0]).toMatchObject({ sourceId: 'logements', vintageId: 'rp-2023',
      version: '2023', referenceDate: '2023-01-01', publicationDate: '2026-06-30' })
    expect(result.identity).toEqual({ contentVersion: 'profile-c1', referenceContentVersion: 'territories-r1' })
  })

  it('retient les statuts natifs sans inventer une valeur', () => {
    const unavailable = cohortResponse()
    unavailable.profiles[0]!.cells[1] = cell('vacantes', null, 'suppressed')
    const result = adapterProfilDeclare({ declaration, target: { type: 'commune', department_id: '22', epci_id: null },
      territories, cohort: unavailable })
    expect(result.facts[1]).toMatchObject({ value: null, fact_status: 'suppressed', observation_status: 'missing' })
  })

  it('refuse une cellule manquante au lieu de réutiliser une ligne statique', () => {
    const broken = cohortResponse()
    broken.profiles[0]!.cells = broken.profiles[0]!.cells.slice(1)
    expect(() => adapterProfilDeclare({ declaration, target: { type: 'commune', department_id: '22', epci_id: null },
      territories, cohort: broken })).toThrow(/incomplet|cellule/i)
  })

  it('refuse un cohort dont les membres ne correspondent pas exactement aux filtres', () => {
    const broken = cohortResponse()
    broken.cohort.members.push({ id: '29001', type: 'commune', name: 'Other' })
    expect(() => adapterProfilDeclare({ declaration, target: { type: 'commune', department_id: '22', epci_id: null },
      territories, cohort: broken })).toThrow(/membres|cohort/i)
  })
})
