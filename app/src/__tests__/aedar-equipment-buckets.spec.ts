import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { AEDAR_EQUIPMENT_BUCKET_THRESHOLD, AEDAR_EQUIPMENT_MODES, aedarEquipmentShareMeasureKey, classifyAedarEquipmentTypes } from '@/fiche/content/aedarEquipmentBuckets'
import type { AedarFact } from '@/fiche/content/aedarApiClient'

function fact(typequ: string, shares: Partial<Record<'walk' | 'transit' | 'bike_lts2' | 'bike_lts4' | 'car', number | null>>): AedarFact {
  const measures = Object.fromEntries(['walk', 'transit', 'bike_lts2', 'bike_lts4', 'car'].map((mode) => [
    `count_15_${mode}_share`, shares[mode as keyof typeof shares] === undefined ? 0 : shares[mode as keyof typeof shares],
  ])) as Record<string, number | null>
  return {
    territory_id: '22001', territory_type: 'commune', typequ, typequ_label: `Libellé ${typequ}`,
    identity: {}, n_addresses: 100, n_observed: 100, coverage_status: 'covered', measures,
    source_id: 'aedar_bretagne', vintage_id: '2026-v1', source_url: 'https://example.test',
    licence: 'ODbL', attribution: 'AEDAR', reference_date: null, publication_date: null,
  }
}

describe('AEDAR equipment buckets', () => {
  it('defines mode labels and source-measure keys once for classification and presentation', () => {
    expect(AEDAR_EQUIPMENT_MODES.map(({ key, label, tableLabel }) => [key, label, tableLabel])).toEqual([
      ['walk', 'À pied', 'À pied'],
      ['transit', 'Transports en commun', 'Transports en commun'],
      ['bike_lts2', 'Vélo (LTS2)', 'Vélo LTS2'],
      ['bike_lts4', 'Vélo (LTS4)', 'Vélo LTS4'],
      ['car', 'Voiture', 'Voiture'],
    ])
    expect(aedarEquipmentShareMeasureKey(15, 'bike_lts2')).toBe('count_15_bike_lts2_share')
  })

  it('assigns every type to exactly its first mode at the owner-selected 25% threshold', () => {
    const result = classifyAedarEquipmentTypes([
      fact('A001', { walk: 0.25, transit: 0.8, car: 0.9 }),
      fact('A002', { walk: 0.1, transit: 0.25, bike_lts2: 0.6 }),
      fact('A003', { bike_lts2: 0.25, bike_lts4: 0.8 }),
      fact('A004', { bike_lts4: 0.25 }),
      fact('A005', { car: 0.25 }),
      fact('A006', {}),
    ], { horizonMinutes: 15 })

    expect(AEDAR_EQUIPMENT_BUCKET_THRESHOLD).toBe(0.25)
    expect(result.status).toBe('complete')
    expect(result.buckets.map(({ key, count }) => [key, count])).toEqual([
      ['walk', 1], ['transit', 1], ['bike_lts2', 1], ['bike_lts4', 1], ['car', 1], ['inaccessible', 1],
    ])
    expect(result.buckets[0]?.types[0]).toMatchObject({ typequ: 'A001', label: 'Libellé A001' })
    expect(result.buckets.flatMap(({ types }) => types)).toHaveLength(6)
  })

  it('fails closed when evidence is null or an identity is duplicated', () => {
    expect(classifyAedarEquipmentTypes([fact('A001', { walk: null })], { horizonMinutes: 15 }).status).toBe('incomplete')
    expect(classifyAedarEquipmentTypes([], { horizonMinutes: 15 }).status).toBe('incomplete')
    expect(() => classifyAedarEquipmentTypes([fact('A001', {}), fact('A001', {})], { horizonMinutes: 15 })).toThrow(/TYPEQU/i)
  })

  it('uses the complete canonical BPE TYPEQU identities and labels from the source registry', () => {
    const path = resolve(process.cwd(), '../pipeline/inst/extdata/aedar-typequ-2025.csv')
    const [header, ...lines] = readFileSync(path, 'utf8').trim().split(/\r?\n/)
    expect(header).toBe('"TYPEQU","LIB_TYPEQU"')
    const registry = lines.map((line) => {
      const match = line.match(/^"([^"]+)","((?:[^"]|"")*)"$/)
      if (!match) throw new Error(`Malformed TYPEQU registry line: ${line}`)
      return { typequ: match[1]!, typequ_label: match[2]!.replaceAll('""', '"') }
    })
    const facts = registry.map(({ typequ, typequ_label }) => ({
      ...fact(typequ, { car: 0.3 }), typequ_label,
    }))
    const result = classifyAedarEquipmentTypes(facts, { horizonMinutes: 15 })
    expect(result.buckets.flatMap(({ types }) => types)).toEqual(registry.map(({ typequ, typequ_label }) => ({ typequ, label: typequ_label })))
    expect(result.buckets.reduce((total, bucket) => total + bucket.count, 0)).toBe(235)
  })
})
