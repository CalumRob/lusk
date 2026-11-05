// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import { chargerFichier } from '../payload/loader'
import { THEMES_CANONIQUES } from '../payload/types'
import type { Histoire, Indicateur, Territoire, Theme, ThemeMetadata } from '../payload/types'
import { formaterRang } from '../payload/selectors'

const dataDir = join(process.cwd(), '..', 'public', 'data')
const chargerDepuisPublic = { baseUrl: 'data/', fetchImpl: async (url: string) => {
  const nom = url.split('/').pop()!
  try {
    const contenu = readFileSync(join(dataDir, nom), 'utf8')
    return { ok: true, status: 200, json: async () => JSON.parse(contenu) as unknown }
  } catch {
    return { ok: false, status: 404, json: async () => null }
  }
} }

let territoires: Territoire[]
let indicateursParTheme: Partial<Record<Theme, Indicateur[]>>
let metadataParTheme: Partial<Record<Theme, ThemeMetadata>>
let histoiresParTheme: Partial<Record<Theme, Histoire[]>>

beforeAll(async () => {
  // Exercise only the retained per-file API. Do not reconstruct the retired
  // assembled Payload: each published artifact is validated independently.
  territoires = await chargerFichier('territoires', chargerDepuisPublic)
  indicateursParTheme = {}
  metadataParTheme = {}
  histoiresParTheme = {}
  for (const theme of THEMES_CANONIQUES) {
    const facts = await chargerFichier(`indicateurs_${theme}`, territoires, chargerDepuisPublic)
    if (facts === null) continue
    indicateursParTheme[theme] = facts as Indicateur[]
    if (theme !== 'programmes') {
      histoiresParTheme[theme] = await chargerFichier(`histoires_${theme}`, territoires, chargerDepuisPublic) as Histoire[]
    }
    const metadata = await chargerFichier(`theme_${theme}`, chargerDepuisPublic)
    if (metadata) metadataParTheme[theme] = metadata
  }
}, 30_000)

describe('contrats des projections statiques commitées aux frontières per-file', () => {
  it('valide la référence territoriale commise et ses relations sans assemblage', () => {
    expect(territoires).toHaveLength(1268)
    expect(territoires.filter((t) => t.type === 'commune')).toHaveLength(1202)
    expect(territoires.filter((t) => t.type === 'epci')).toHaveLength(61)
    expect(territoires.filter((t) => t.type === 'departement')).toHaveLength(4)
    expect(territoires.filter((t) => t.type === 'region')).toHaveLength(1)
    for (const id of ['22016', '29083', '29155']) {
      expect(territoires.find((t) => t.territoire === id)).toMatchObject({ type: 'commune', epci: null })
    }
    expect(territoires.find((t) => t.territoire === '22001')?.nom).toBe('Allineuc')
    expect(territoires.find((t) => t.territoire === '200067460')?.nom).toBe('CC Loudéac Communauté - Bretagne Centre')
    expect(territoires.find((t) => t.territoire === '53')?.nom).toBe('Bretagne')
  })

  it('keeps the canonical theme registry and validates each published facts/metadata file independently', () => {
    expect(THEMES_CANONIQUES).toEqual(['mobilite', 'demographie', 'habitat', 'economie', 'milieux', 'programmes'])
    const issues: string[] = []
    for (const [theme, facts] of Object.entries(indicateursParTheme) as [Theme, Indicateur[]][]) {
      if (facts.length === 0) issues.push(`${theme}: no facts`)
      const metadata = metadataParTheme[theme]
      if (metadata?.theme !== theme) issues.push(`${theme}: missing/mismatched metadata`)
      if (!metadata) continue
      const rows = facts as Array<{ key: string; detail: string | null; territoire: string; sex?: string | null; dimension?: string | null }>
      const declared = new Set(metadata!.indicator_keys)
      const keysPublished = new Set<string>()
      const rowIds = new Set(rows.map((row) => `${row.territoire}|${row.key}|${row.detail ?? ''}|${row.sex ?? ''}|${row.dimension ?? ''}`))
      if (rowIds.size !== rows.length) issues.push(`${theme}: duplicate facts`)
      for (const row of rows) {
        keysPublished.add(row.key)
        if (!declared.has(row.key)) issues.push(`${theme}/${row.key}: undeclared key`)
        if (!metadata.indicator_labels[row.key]) issues.push(`${theme}/${row.key}: missing label`)
        if (row.detail !== null && !metadata.detail_labels[row.key]?.[row.detail]) issues.push(`${theme}/${row.key}/${row.detail}: missing detail label`)
      }
      for (const key of declared) if (!keysPublished.has(key)) issues.push(`${theme}/${key}: declared without facts`)
      const histories = (histoiresParTheme[theme] ?? []) as Array<{ territoire: string; theme: Theme; story_key: string; groupe: string }>
      const declaredStories = new Set(metadata!.story_keys ?? [])
      const groups = new Set(metadata!.subgroups.map((group) => group.key))
      const identities = new Set<string>()
      for (const row of histories) {
        if (row.theme !== theme || !declaredStories.has(row.story_key) || !groups.has(row.groupe)) issues.push(`${theme}/${row.territoire}: invalid history identity`)
        identities.add(`${row.territoire}|${row.groupe}`)
      }
      if (identities.size !== histories.length) issues.push(`${theme}: duplicate histories`)
    }
    expect(issues).toEqual([])
    expect(metadataParTheme.programmes?.theme).toBe('programmes')
  })

  it('preserves declared raccordement reference geometry and published unit/provenance rows', () => {
    const metadata = metadataParTheme.mobilite!
    const details = metadata.indicator_pages!.raccordement_courbe.comparison!.details!
    const rows = indicateursParTheme.mobilite as unknown as Array<Record<string, unknown> & { key: string; detail: string | null }>
    const courbe = rows.filter((row) => row.key === 'raccordement_courbe')
    const reference = rows.filter((row) => row.key === 'raccordement_reference')
    expect(metadata.indicator_pages!.raccordement_courbe.levels).toEqual(['commune', 'epci', 'departement', 'region'])
    expect(courbe).toHaveLength(1268 * details.length)
    expect(reference).toHaveLength(details.length)
    expect([...new Set(courbe.map((row) => row.detail))]).toEqual(details)
    expect(courbe.some((row) => row.detail === 't0600')).toBe(false)
    const rowsWithClock = rows.filter((row) => row.vintage_date_reference !== null || row.vintage_date_publication !== null)
    expect(rowsWithClock.length).toBe(rows.length)
    expect(formaterRang(8, 10, 'rang_epci')).toBe("8e/10 de l'EPCI")
    const violationClassement = rows.flatMap((row) => {
      const problems: string[] = []
      for (const [rank, size] of [['rang_epci', 'rang_epci_n'], ['rang_dep', 'rang_dep_n'], ['rang_reg', 'rang_reg_n']] as const) {
        const position = row[rank] as number | null
        const count = row[size] as number | null
        if (position !== null && (!Number.isInteger(position) || position < 1 || count === null || !Number.isInteger(count) || position > count)) problems.push(`${row.territoire}/${row.key}/${rank}`)
        if (position === null && count !== null) problems.push(`${row.territoire}/${row.key}/${size}`)
      }
      return problems
    })
    expect(violationClassement).toEqual([])
  })

  it('keeps published reading provenance and data-derived Milieux trajectory facts', () => {
    const histoires = histoiresParTheme.milieux as unknown as Array<Record<string, unknown> & { territoire: string }>
    expect(histoires.length).toBeGreaterThan(1200)
    const allineuc = histoires.find((row) => row.territoire === '22001')!
    expect(allineuc).toMatchObject({
      story_key: 'se-densifier-setaler-ou-sen-aller',
      periode_pop: '2017-2023',
      periode_artif: '2021-2025',
      classification: 'sen-aller-et-consommer-quand-meme',
    })
    expect(allineuc.artif_m2_par_habitant).toBeGreaterThan(0)
    expect(allineuc.artif_m3_par_habitant).toBeGreaterThan(0)
    for (const row of histoires) {
      const ratio = row.trajectoire_artif_par_habitant as number | null
      if (ratio === null) expect(row.classification).toBeNull()
      else {
        const delta = (row.artif_m3_par_habitant as number) - (row.artif_m2_par_habitant as number)
        expect(Math.sign(ratio - 1)).toBe(Math.sign(delta))
      }
    }
    const economie = histoiresParTheme.economie as unknown as Array<Record<string, unknown> & { territoire: string }>
    const lectureEconomie = economie.find((row) => row.territoire === '22001')!
    expect(lectureEconomie.top1_activity_code).toMatch(/^[A-Z][A-Z0-9]$/)
    expect(lectureEconomie.vintage_source).toBeDefined()
    expect(lectureEconomie.vintage_date_reference ?? lectureEconomie.vintage_date_publication).toBeTruthy()
  })

  it('keeps Programmes facts/metadata per-file and has no serialized history artifact', async () => {
    expect(indicateursParTheme.programmes).toBeDefined()
    expect(metadataParTheme.programmes?.theme).toBe('programmes')
    const response = await chargerDepuisPublic.fetchImpl('data/histoires_programmes.json')
    expect(response.status).toBe(404)
    expect(await chargerFichier('histoires_programmes', territoires, chargerDepuisPublic)).toBeNull()
  })
})
