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
    indicateursParTheme[theme] = facts
    if (theme !== 'programmes') {
      const histories = await chargerFichier(`histoires_${theme}`, territoires, chargerDepuisPublic)
      if (histories === null) throw new Error(`Theme ${theme} has facts but no required histories file`)
      histoiresParTheme[theme] = histories
    }
    const metadata = await chargerFichier(`theme_${theme}`, chargerDepuisPublic)
    if (metadata === null) throw new Error(`Theme ${theme} has facts but no required metadata file`)
    metadataParTheme[theme] = metadata
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
    for (const theme of THEMES_CANONIQUES) {
      const facts = indicateursParTheme[theme]
      if (facts === undefined) continue
      if (facts.length === 0) issues.push(`${theme}: no facts`)
      const metadata = metadataParTheme[theme]
      if (metadata === undefined) {
        issues.push(`${theme}: missing metadata`)
        continue
      }
      if (metadata.theme !== theme) issues.push(`${theme}: mismatched metadata`)
      const declared = new Set(metadata.indicator_keys)
      const keysPublished = new Set<string>()
      const rowIds = new Set(facts.map((row) => `${row.territoire}|${row.key}|${row.detail ?? ''}|${row.sex ?? ''}|${row.dimension ?? ''}`))
      if (rowIds.size !== facts.length) issues.push(`${theme}: duplicate facts`)
      for (const row of facts) {
        keysPublished.add(row.key)
        if (!declared.has(row.key)) issues.push(`${theme}/${row.key}: undeclared key`)
        if (!metadata.indicator_labels[row.key]) issues.push(`${theme}/${row.key}: missing label`)
        if (row.detail !== null && !metadata.detail_labels[row.key]?.[row.detail]) issues.push(`${theme}/${row.key}/${row.detail}: missing detail label`)
      }
      for (const key of declared) if (!keysPublished.has(key)) issues.push(`${theme}/${key}: declared without facts`)
      if (theme === 'programmes') continue
      const histories = histoiresParTheme[theme]
      if (histories === undefined) {
        issues.push(`${theme}: present facts lack required histories`)
        continue
      }
      const declaredStories = new Set(metadata.story_keys ?? [])
      const groups = new Set(metadata.subgroups.map((group) => group.key))
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
    const metadata = metadataParTheme.mobilite
    const page = metadata?.indicator_pages?.raccordement_courbe
    const comparison = page?.comparison
    const rows = indicateursParTheme.mobilite
    if (!metadata || !page || !comparison || !comparison.details || !rows) throw new Error('Published mobility facts or raccordement descriptor is missing')
    const details = comparison.details
    const courbe = rows.filter((row) => row.key === 'raccordement_courbe')
    const reference = rows.filter((row) => row.key === 'raccordement_reference')
    expect(page.levels).toEqual(['commune', 'epci', 'departement', 'region'])
    expect(courbe).toHaveLength(1268 * details.length)
    expect(reference).toHaveLength(details.length)
    expect([...new Set(courbe.map((row) => row.detail))]).toEqual(details)
    expect(courbe.some((row) => row.detail === 't0600')).toBe(false)
    const rowsWithClock = rows.filter((row) => row.vintage_date_reference !== null || row.vintage_date_publication !== null)
    expect(rowsWithClock.length).toBe(rows.length)
    expect(formaterRang(8, 10, 'rang_epci')).toBe("8e/10 de l'EPCI")
    const violationClassement = rows.flatMap((row) => {
      const problems: string[] = []
      for (const { label, position, count } of [
        { label: 'rang_epci', position: row.rang_epci, count: row.rang_epci_n },
        { label: 'rang_dep', position: row.rang_dep, count: row.rang_dep_n },
        { label: 'rang_reg', position: row.rang_reg, count: row.rang_reg_n },
      ]) {
        if (position !== null && (!Number.isInteger(position) || position < 1 || count === null || !Number.isInteger(count) || position > count)) problems.push(`${row.territoire}/${row.key}/${label}`)
        if (position === null && count !== null) problems.push(`${row.territoire}/${row.key}/${label}_n without rank`)
      }
      return problems
    })
    expect(violationClassement).toEqual([])
  })

  it('keeps published reading provenance and data-derived Milieux trajectory facts', () => {
    const histoires = histoiresParTheme.milieux
    if (!histoires) throw new Error('Published Milieux facts require their histories file')
    expect(histoires.length).toBeGreaterThan(1200)
    const allineuc = histoires.find((row) => row.territoire === '22001')
    if (!allineuc || allineuc.theme !== 'milieux') throw new Error('Expected Allineuc Milieux reading is missing')
    expect(allineuc).toMatchObject({
      story_key: 'se-densifier-setaler-ou-sen-aller',
      periode_pop: '2017-2023',
      periode_artif: '2021-2025',
      classification: 'sen-aller-et-consommer-quand-meme',
    })
    expect(allineuc.artif_m2_par_habitant).toBeGreaterThan(0)
    expect(allineuc.artif_m3_par_habitant).toBeGreaterThan(0)
    for (const row of histoires) {
      if (row.theme !== 'milieux') continue
      const ratio = row.trajectoire_artif_par_habitant
      if (ratio === null) expect(row.classification).toBeNull()
      else {
        const delta = (row.artif_m3_par_habitant ?? 0) - (row.artif_m2_par_habitant ?? 0)
        expect(Math.sign(ratio - 1)).toBe(Math.sign(delta))
      }
    }
    const economie = histoiresParTheme.economie
    if (!economie) throw new Error('Published Économie facts require their histories file')
    const lectureEconomie = economie.find((row) => row.territoire === '22001')
    if (!lectureEconomie || lectureEconomie.theme !== 'economie') throw new Error('Expected Allineuc Économie reading is missing')
    expect(lectureEconomie.top1_activity_code).toMatch(/^[A-Z][A-Z0-9]$/)
    expect(lectureEconomie).toMatchObject({
      vintage_source: 'data.bretagne.bzh — Base SIRENE — Région Bretagne',
      vintage_version: '2026-04',
      vintage_date_reference: '2026-03-31',
      vintage_date_publication: '2026-05-01',
    })
  })

  it('keeps Programmes facts/metadata per-file and has no serialized history artifact', async () => {
    expect(indicateursParTheme.programmes).toBeDefined()
    expect(metadataParTheme.programmes?.theme).toBe('programmes')
    const response = await chargerDepuisPublic.fetchImpl('data/histoires_programmes.json')
    expect(response.status).toBe(404)
    expect(await chargerFichier('histoires_programmes', territoires, chargerDepuisPublic)).toBeNull()
  })
})
