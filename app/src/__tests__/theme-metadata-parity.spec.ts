import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const themes = ['demographie', 'habitat', 'economie', 'mobilite', 'milieux'] as const
const canonicalDir = join(process.cwd(), '..', 'pipeline', 'inst', 'extdata', 'theme-metadata')
const publicDir = join(process.cwd(), '..', 'public', 'data')

function lire(dir: string, theme: string): unknown {
  return JSON.parse(readFileSync(join(dir, `theme_${theme}.json`), 'utf8'))
}
function lireFaits(theme: string): Array<Record<string, unknown>> {
  return JSON.parse(readFileSync(join(publicDir, `indicateurs_${theme}.json`), 'utf8'))
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

  it('publie les sept pages conceptuelles composition/pyramide du périmètre #403', () => {
    const expected = {
      demographie: { structure_age: 'pyramid' },
      habitat: { mix_logements: 'composition', statut: 'composition', age_du_bati: 'composition', type: 'composition' },
      mobilite: { voitures_menage: 'composition', offre_cyclable: 'composition' },
    } as const
    for (const [theme, pages] of Object.entries(expected)) {
      const metadata = lire(canonicalDir, theme) as { indicator_pages: Record<string, { family: string; sources: string[]; comparison?: { details?: string[]; sex?: string }; composition?: { parts: string[] }; pyramid?: { dimensions: string[] } }> }
      for (const [indicator, family] of Object.entries(pages)) {
        const page = metadata.indicator_pages[indicator]
        expect(page, `${theme}.${indicator}`).toBeDefined()
        expect(page.family).toBe(family)
        expect(page.sources.length).toBeGreaterThan(0)
        expect(page.comparison?.details?.length ?? page.pyramid?.dimensions.length).toBeGreaterThan(0)
        if (family === 'composition') expect(page.composition?.parts.length).toBeGreaterThan(0)
        if (family === 'pyramid') expect(page.comparison?.sex).toMatch(/^[FM]$/)
      }
    }
  })

  it('publie la pyramide réelle avec exactement 7 tranches × 2 sexes par territoire', () => {
    const rows = lireFaits('demographie').filter((row) => row.key === 'structure_age')
    const grouped = new Map<string, Array<Record<string, unknown>>>()
    for (const row of rows) {
      const key = `${row.territoire}|${row.type}`
      grouped.set(key, [...(grouped.get(key) ?? []), row])
    }
    expect(grouped.size).toBeGreaterThan(0)
    for (const group of grouped.values()) {
      expect(group).toHaveLength(14)
      expect(new Set(group.map((row) => `${row.detail}|${row.sex}`)).size).toBe(14)
      expect(new Set(group.map((row) => row.sex))).toEqual(new Set(['F', 'M']))
      expect(new Set(group.map((row) => row.unit))).toEqual(new Set(['%']))
    }
  })

  it('garde l’offre cyclable dans le domaine des longueurs protégées/partagées', () => {
    const page = (lire(canonicalDir, 'mobilite') as any).indicator_pages.offre_cyclable
    expect(page.composition.parts).toEqual(['protege_longueur', 'partage_longueur'])
    expect(page.comparison.details).toEqual(['protege_longueur', 'partage_longueur', 'total_longueur'])
    expect(page.comparison.unit).toBe('km')
    expect(page.composition.parts.some((part: string) => part.includes('km_1000'))).toBe(false)
  })
})
