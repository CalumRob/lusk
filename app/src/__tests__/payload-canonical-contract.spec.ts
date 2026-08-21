import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const dataDir = join(process.cwd(), '..', 'public', 'data')

describe('payload canonique des lectures', () => {
  it('publie chaque lecture dans son sous-groupe canonique', () => {
    const demographie = JSON.parse(
      readFileSync(join(dataDir, 'histoires_demographie.json'), 'utf-8'),
    ) as Array<{ groupe: string }>
    const habitat = JSON.parse(
      readFileSync(join(dataDir, 'histoires_habitat.json'), 'utf-8'),
    ) as Array<{ groupe: string }>

    expect(new Set(demographie.map((ligne) => ligne.groupe))).toEqual(
      new Set(['trajectoire-demographique']),
    )
    expect(new Set(habitat.map((ligne) => ligne.groupe))).toEqual(
      new Set(['etat-energetique-du-parc']),
    )
    expect(JSON.stringify({ demographie, habitat })).not.toMatch(
      /etat-et-dynamique|etat-du-parc/,
    )
  })
})
