// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import { chargerFichier } from '../payload/loader'
import { THEMES_CANONIQUES } from '../payload/types'
import type { Histoire, HistoireMobilite, Indicateur, RunReport, Territoire, Theme, ThemeMetadata, Vintage } from '../payload/types'
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
let runReport: RunReport | null
let vintages: Vintage[] | null

beforeAll(async () => {
  // Exercise only the retained per-file API. Do not reconstruct the retired
  // assembled Payload: each published artifact is validated independently.
  territoires = await chargerFichier('territoires', chargerDepuisPublic)
  indicateursParTheme = {}
  metadataParTheme = {}
  histoiresParTheme = {}
  runReport = await chargerFichier('run-report', chargerDepuisPublic)
  vintages = await chargerFichier('vintages', chargerDepuisPublic)
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
      const detailsPublished = new Map<string, Set<string>>()
      for (const row of facts) {
        keysPublished.add(row.key)
        if (!declared.has(row.key)) issues.push(`${theme}/${row.key}: undeclared key`)
        if (!metadata.indicator_labels[row.key]) issues.push(`${theme}/${row.key}: missing label`)
        if (row.detail !== null && !metadata.detail_labels[row.key]?.[row.detail]) issues.push(`${theme}/${row.key}/${row.detail}: missing detail label`)
        if (row.detail !== null) {
          const details = detailsPublished.get(row.key) ?? new Set<string>()
          details.add(row.detail)
          detailsPublished.set(row.key, details)
        }
      }
      for (const key of declared) if (!keysPublished.has(key)) issues.push(`${theme}/${key}: declared without facts`)
      for (const [key, labels] of Object.entries(metadata.detail_labels)) {
        const details = detailsPublished.get(key) ?? new Set<string>()
        for (const detail of Object.keys(labels)) {
          if (!details.has(detail)) issues.push(`${theme}/${key}/${detail}: declared detail has no committed fact`)
        }
      }
      if (vintages !== null) {
        const vintageIds = new Set(vintages.map((vintage) => vintage.id))
        for (const [key, sourceId] of Object.entries(metadata.sources)) {
          if (!keysPublished.has(key)) continue
          if (!vintageIds.has(sourceId)) issues.push(`${theme}/${key}: source vintage « ${sourceId} » is absent`)
        }
      }
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
    if (!metadata || !page || !('trajectory' in page) || !page.trajectory?.reference || !comparison || !comparison.details || !comparison.unit || !rows || vintages === null) {
      throw new Error('Published mobility facts or raccordement descriptor is missing')
    }
    const declaredReference = page.trajectory.reference
    const details = comparison.details
    const courbe = rows.filter((row) => row.key === 'raccordement_courbe')
    const reference = rows.filter((row) => row.key === 'raccordement_reference')
    expect(page.levels).toEqual(['commune', 'epci', 'departement', 'region'])
    expect(courbe).toHaveLength(territoires.length * details.length)
    expect(reference).toHaveLength(details.length)
    const comparerDetails = (values: Array<string | null>) => [...new Set(values)].sort()
    expect(comparerDetails(courbe.map((row) => row.detail))).toEqual([...details].sort())
    expect(comparerDetails(reference.map((row) => row.detail))).toEqual([...details].sort())
    expect(reference.every((row) => row.key === declaredReference.indicator && row.territoire === declaredReference.territoire)).toBe(true)
    expect([...courbe, ...reference].every((row) => row.unit === comparison.unit)).toBe(true)
    const courbeVintageId = metadata.sources.raccordement_courbe
    const referenceVintageId = metadata.sources[declaredReference.indicator]
    const courbeVintage = vintages.find((vintage) => vintage.id === courbeVintageId)
    const referenceVintage = vintages.find((vintage) => vintage.id === referenceVintageId)
    if (!courbeVintage || !referenceVintage) throw new Error('Raccordement source vintages are missing from vintages.json')
    expect(courbe.every((row) => row.vintage_source === courbeVintage.source &&
      row.vintage_version === courbeVintage.version && row.vintage_date_reference === courbeVintage.date_reference &&
      row.vintage_date_publication === courbeVintage.date_publication)).toBe(true)
    expect(reference.every((row) => row.vintage_source === referenceVintage.source &&
      row.vintage_version === referenceVintage.version && row.vintage_date_reference === referenceVintage.date_reference &&
      row.vintage_date_publication === referenceVintage.date_publication)).toBe(true)
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

  it('validates committed run-report and source vintages independently', () => {
    if (runReport === null || vintages === null) throw new Error('Committed run-report and vintages are required test artifacts')
    expect(runReport.mode).toBe('full')
    expect(runReport.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    expect(runReport.statuts.length).toBeGreaterThan(0)

    // Historical committed-source contract: these selected rows pin identity,
    // licence and vintage dates without comparing against the wall clock.
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

  it('checks committed resolved-reading coverage against the published support and descriptors', () => {
    const economie = histoiresParTheme.economie
    const mobilite = histoiresParTheme.mobilite
    const mobiliteFacts = indicateursParTheme.mobilite
    const economieMetadata = metadataParTheme.economie
    const mobiliteMetadata = metadataParTheme.mobilite
    if (!economie || !mobilite || !mobiliteFacts || !economieMetadata || !mobiliteMetadata) {
      throw new Error('Committed facts, reading-bearing theme metadata and histories are required')
    }

    // HistoireEconomie's producer type declares commune/EPCI/département rows;
    // the reference table is the independent expected coverage source (no region row).
    const expectedEconomieTerritories = territoires
      .filter((territoire) => territoire.type !== 'region')
      .map((territoire) => territoire.territoire)
      .sort()
    const actualEconomieTerritories = [...new Set(economie.map((row) => row.territoire))].sort()
    expect(economie).toHaveLength(expectedEconomieTerritories.length)
    expect(actualEconomieTerritories).toEqual(expectedEconomieTerritories)
    expect(new Set(economie.map((row) => `${row.territoire}|${row.groupe}`)).size).toBe(economie.length)
    const economieReadingGroup = economieMetadata.subgroups.find((group) => group.reading !== undefined)
    if (economieReadingGroup?.reading === undefined) throw new Error('Économie reading subgroup is missing from its metadata')
    const economyStoryKey = economieReadingGroup.reading.story_key
    expect(economie.every((row) => row.theme === 'economie' && row.groupe === economieReadingGroup.key && row.story_key === economyStoryKey)).toBe(true)

    // The current published Mobilité snapshot carries one reading for each
    // territory with a published non-null building-support fact. Its 139
    // alternate readings are the committed producer snapshot covered by the
    // existing #312 contract; the R tests separately cover its salience rule.
    const expectedMobiliteTerritories = new Set(
      mobiliteFacts.filter((row) => row.key === 'nb_buildings' && row.value !== null).map((row) => row.territoire),
    )
    expect(mobilite).toHaveLength(expectedMobiliteTerritories.size)
    expect(new Set(mobilite.map((row) => row.territoire))).toEqual(expectedMobiliteTerritories)
    expect(new Set(mobilite.map((row) => `${row.territoire}|${row.groupe}`)).size).toBe(mobilite.length)
    const mobilityReadingGroup = mobiliteMetadata.subgroups.find((group) => group.reading !== undefined)
    if (mobilityReadingGroup?.reading === undefined) throw new Error('Mobilité reading subgroup is missing from its metadata')
    expect(mobilite.every((row) => row.theme === 'mobilite' && row.groupe === mobilityReadingGroup.key)).toBe(true)
    const velo = mobilite.filter((row): row is HistoireMobilite => row.theme === 'mobilite' && row.story_key === 'ce-que-le-velo-preserve')
    const defauts = mobilite.filter((row): row is HistoireMobilite => row.theme === 'mobilite' && row.story_key === 'vingt-minutes-sans-voiture')
    expect(velo).toHaveLength(139)
    expect(defauts).toHaveLength(expectedMobiliteTerritories.size - velo.length)
    expect(velo.every((row) => row.classification_saillance === 'saillant' && row.salience_reason === 'delta-velo-saillant')).toBe(true)
    expect(new Set(mobilite.map((row) => row.story_key))).toEqual(new Set(['vingt-minutes-sans-voiture', 'ce-que-le-velo-preserve']))

    const allineuc = mobilite.find((row) => row.theme === 'mobilite' && row.territoire === '22001')
    if (!allineuc || allineuc.theme !== 'mobilite' || allineuc.story_key !== 'vingt-minutes-sans-voiture') {
      throw new Error('Expected Allineuc default Mobilité reading is missing')
    }
    expect(allineuc).toMatchObject({
      div_loss_t: 38,
      div_loss_b: 38,
      delta: 0,
      pct_iso_full_t: 0.48,
      classification_saillance: 'non-saillant',
      dens_min: 28,
      dens_max: 47,
      vintage_source: "Lusk — analyse d'accessibilité « Vingt minutes sans voiture » (analyse portée, BPE 2024 · OSM 02-2026 · BDNB 2025-07)",
      vintage_version: '2026-02',
      vintage_date_reference: '2026-02-28',
      vintage_date_publication: '2026-08-06',
    })
    const densite = [allineuc.dens_1, allineuc.dens_2, allineuc.dens_3, allineuc.dens_4, allineuc.dens_5,
      allineuc.dens_6, allineuc.dens_7, allineuc.dens_8, allineuc.dens_9, allineuc.dens_10]
    const deciles = [allineuc.dec_1, allineuc.dec_2, allineuc.dec_3, allineuc.dec_4, allineuc.dec_5,
      allineuc.dec_6, allineuc.dec_7, allineuc.dec_8, allineuc.dec_9, allineuc.dec_10]
    expect(densite.every((value) => value !== null) && densite.some((value) => value !== null && value > 0)).toBe(true)
    expect(deciles.every((value) => value !== null)).toBe(true)
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
