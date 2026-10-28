import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sourceRecords } from '../payload/selectors'

describe('probe sourceRecords', () => {
  it('keeps the matrice dataset record', () => {
    const metadata = JSON.parse(readFileSync(join(process.cwd(), '..', 'public', 'data', 'theme_mobilite.json'), 'utf8'))
    const payload = {
      themeMetadata: { mobilite: metadata },
      territoryMetadata: null,
      vintages: [],
    }
    const records = sourceRecords(payload)
    console.log('record ids:', records.map((record) => record.id))
    expect(records.some((record) => record.id === 'matrice_temps_mairies')).toBe(true)
  })
})
