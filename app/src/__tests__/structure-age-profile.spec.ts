import { afterEach, describe, expect, it, vi } from 'vitest'
import { chargerStructureAgeProfile, remplacerStructureAgeStatique } from '../payload/structureAgeProfile'
import type { Indicateur, Territoire } from '../payload/types'

const territory = { territoire: '22001', type: 'commune', nom: 'Fixture' } as Territoire
const others = [territory, { territoire: '22002', type: 'commune', nom: 'Other' } as Territoire]
const response = {
  indicator: 'structure_age', label: 'Structure par âge', unit: '%', content_version: 'p1',
  descriptor_version: 'd1',
  comparison: { detail: 'young', sex: 'F', direction: 'high', scope: 'bretagne', scope_id: null,
    values: [{ territory_id: '22001', name: 'Fixture', value: .2, status: 'measured' },
      { territory_id: '22002', name: 'Other', value: .1, status: 'measured' }] },
  axes: [{ name: 'detail', key: 'young', label: 'Young', order: 0 }, { name: 'detail', key: 'old', label: 'Old', order: 1 },
    { name: 'sex', key: 'F', label: 'F', order: 0 }, { name: 'sex', key: 'M', label: 'M', order: 1 }],
  cells: [
    { detail: 'young', sex: 'F', value: .2, status: 'measured' }, { detail: 'young', sex: 'M', value: .2, status: 'measured' },
    { detail: 'old', sex: 'F', value: .1, status: 'measured' }, { detail: 'old', sex: 'M', value: .1, status: 'measured' },
  ],
  sources: [{ source_id: 'age_detail', name: 'INSEE fixture', version: '2023', reference_date: '2023-01-01', publication_date: null }],
}
const declaration = { details: ['young', 'old'], sexes: ['F', 'M'], labels: { young: 'Young', old: 'Old' },
  detail: 'young', sex: 'F', label: 'Structure par âge', unit: '%', direction: 'high' }

afterEach(() => vi.unstubAllGlobals())

describe('structure_age API adapter', () => {
  it('retire le fait âge statique en conservant tous les autres indicateurs', () => {
    const staticFacts = [
      { key: 'structure_age', territoire: '22001' },
      { key: 'densite', territoire: '22001' },
    ] as Indicateur[]
    const apiFacts = [{ key: 'structure_age', territoire: '22001' }] as Indicateur[]
    expect(remplacerStructureAgeStatique(staticFacts, apiFacts)).toEqual([staticFacts[1], apiFacts[0]])
  })

  it('maps the declared comparison and the selected dense profile without static reads', async () => {
    const scoped = { ...response, comparison: { ...response.comparison, scope: 'departement', scope_id: '22' } }
    const fetcher = vi.fn(async () => new Response(JSON.stringify(scoped), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    const facts = await chargerStructureAgeProfile(territory, others, { department: '22' },
      declaration)
    expect(fetcher).toHaveBeenCalledWith('/api/territories/commune/22001/profiles/structure_age?comparison_scope=departement&comparison_scope_id=22')
    expect(facts).toHaveLength(5)
    expect(facts.filter((fact) => fact.detail === 'young' && fact.sex === 'F')).toHaveLength(2)
    expect(facts.find((fact) => fact.territoire === '22002')?.value).toBe(.1)
  })

  it('rejects incomplete profiles rather than filling missing cells', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ ...response, cells: response.cells.slice(1) }), { status: 200 }))
    await expect(chargerStructureAgeProfile(territory, others, {},
      declaration)).rejects.toThrow('incomplet')
  })

  it('propagates unavailable API responses and does not make a static fallback request', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 503 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(chargerStructureAgeProfile(territory, others, {},
      declaration)).rejects.toThrow('HTTP 503')
    expect(fetcher).toHaveBeenCalledOnce()
  })
})
