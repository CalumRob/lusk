// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import { chargerFichier } from '../payload/loader'
import { THEMES_CANONIQUES } from '../payload/types'
import type { RunReport, Territoire, Theme, ThemeMetadata, Vintage } from '../payload/types'

const dataDir = join(process.cwd(), '..', 'public', 'data')
const chargerDepuisPublic = { baseUrl: 'data/', fetchImpl: async (url: string) => {
  const nom = url.split('/').pop()
  if (nom === undefined) return { ok: false, status: 404, json: async () => null }
  try {
    const contenu = readFileSync(join(dataDir, nom), 'utf8')
    return { ok: true, status: 200, json: async () => JSON.parse(contenu) }
  } catch {
    return { ok: false, status: 404, json: async () => null }
  }
} }

let territoires: Territoire[]
let metadataParTheme: Partial<Record<Theme, ThemeMetadata>>
let runReport: RunReport | null
let vintages: Vintage[] | null

beforeAll(async () => {
  // Keep contract coverage for the compact reference and descriptive static
  // artifacts. Numerical observations are acquired from the API, not loaded here.
  territoires = await chargerFichier('territoires', chargerDepuisPublic)
  runReport = await chargerFichier('run-report', chargerDepuisPublic)
  vintages = await chargerFichier('vintages', chargerDepuisPublic)
  metadataParTheme = {}
  for (const theme of THEMES_CANONIQUES) {
    const metadata = await chargerFichier(`theme_${theme}`, chargerDepuisPublic)
    if (metadata === null) throw new Error(`Missing committed metadata for ${theme}`)
    metadataParTheme[theme] = metadata
  }
}, 30_000)

describe('contrats des artefacts statiques descriptifs committés', () => {
  it('validates the committed territory reference and its relationships', () => {
    expect(territoires).toHaveLength(1268)
    expect(territoires.filter((t) => t.type === 'commune')).toHaveLength(1202)
    expect(territoires.filter((t) => t.type === 'epci')).toHaveLength(61)
    expect(territoires.filter((t) => t.type === 'departement')).toHaveLength(4)
    expect(territoires.filter((t) => t.type === 'region')).toHaveLength(1)
    for (const id of ['22016', '29083', '29155']) {
      expect(territoires.find((t) => t.territoire === id)).toMatchObject({ type: 'commune', epci: null })
    }
    expect(territoires.find((t) => t.territoire === '22001')?.nom).toBe('Allineuc')
    expect(territoires.find((t) => t.territoire === '200067460')?.nom)
      .toBe('CC Loudéac Communauté - Bretagne Centre')
    expect(territoires.find((t) => t.territoire === '53')?.nom).toBe('Bretagne')
  })

  it('keeps every canonical theme metadata file independently loadable', () => {
    expect(THEMES_CANONIQUES).toEqual(['mobilite', 'demographie', 'habitat', 'economie', 'milieux', 'programmes'])
    for (const theme of THEMES_CANONIQUES) {
      const metadata = metadataParTheme[theme]
      expect(metadata, `${theme}: missing metadata`).toBeDefined()
      expect(metadata!.theme).toBe(theme)
      expect(metadata!.indicator_keys.length, `${theme}: missing declared indicators`).toBeGreaterThan(0)
    }
  })

  it('validates committed run-report and source vintages independently', () => {
    if (runReport === null || vintages === null) throw new Error('Committed run-report and vintages are required test artifacts')
    expect(runReport.mode).toBe('full')
    expect(runReport.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    expect(runReport.statuts.length).toBeGreaterThan(0)

    // Pin committed source identity, licence and vintage dates without comparing
    // against the wall clock or any numerical observation payload.
    expect(vintages).toHaveLength(68)
    expect(vintages.find((vintage) => vintage.id === 'consoenaf')).toMatchObject({
      source: "Cerema — Consommation d'espaces naturels, agricoles et forestiers (CONSOENAF) 2011-2025 : indicateurs communaux (Fichiers Fonciers)",
      version: '2025',
      licence: 'lov2',
      date_reference: '2025-01-01',
      date_publication: '2026-07-24',
    })
    const ocsge = vintages.find((vintage) => vintage.id === 'ocsge_artificialisation_22_2025')
    expect(ocsge).toMatchObject({
      version: '2025',
      licence: 'lov2',
      date_reference: '2025-01-01',
      date_publication: '2026-07-03',
    })
    expect(ocsge?.source).toContain('surfaces artificialisées')
    expect(ocsge?.source).not.toContain('différentiel')
    expect(vintages.find((vintage) => vintage.id === 'serie_historique')).toMatchObject({
      source: 'INSEE — Série historique du recensement',
      version: '2023',
      licence: 'lov2',
      date_reference: '2023-01-01',
    })
    expect(vintages.find((vintage) => vintage.id === 'epci')?.date_publication).toBeNull()
  })
})
