import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const themes = ['demographie', 'habitat', 'economie', 'mobilite', 'milieux'] as const
const canonicalDir = join(process.cwd(), '..', 'pipeline', 'inst', 'extdata', 'theme-metadata')
const publicDir = join(process.cwd(), '..', 'public', 'data')

function lire(dir: string, theme: string): unknown {
  return JSON.parse(readFileSync(join(dir, `theme_${theme}.json`), 'utf8'))
}

describe('métadonnées de thème — autorité canonique et snapshot public', () => {
  it('garde le snapshot public sémantiquement identique au fichier épinglé', () => {
    for (const theme of themes) expect(lire(publicDir, theme), theme).toEqual(lire(canonicalDir, theme))
  })

  it('déclare chaque source actuellement consommée et ses lignes de fraîcheur dans le canon', () => {
    for (const theme of themes) {
      const metadata = lire(canonicalDir, theme) as { sources: Record<string, string>; source_records?: Record<string, { dataset: string; publisher: string; url: string; licence: string; vintage: string; freshness: string; vintages?: unknown[] }> }
      expect(metadata.source_records, theme).toBeDefined()
      for (const [indicator, sourceId] of Object.entries(metadata.sources)) {
        const record = metadata.source_records![sourceId]
        expect(record, `${theme}.${indicator} → ${sourceId}`).toBeDefined()
        expect(record.dataset && record.publisher && record.url && record.licence && record.vintage && record.freshness).toBeTruthy()
        expect(record.vintages?.length, `${theme}.${sourceId} sans vintages canonisés`).toBeGreaterThan(0)
      }
    }
  })
})
