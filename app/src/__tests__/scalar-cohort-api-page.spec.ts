import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chargerCohorteScalaire, chargerCohortesScalaires, chargerRangScalaire,
  chargerComparaisonsScalaires, indicateursScalairesEnregistres, pagesScalairesEnregistrees, remplacerFaitsScalaires,
  scalarCohortEnabled, validerEnregistrementScalaires } from '../payload/scalarCohort'
import { territoiresFixture, indicateursEconomieFixture } from '../payload/fixtures'
import { validerThemeMetadata } from '../payload/validate'
import type { SemanticReadItem, SemanticResourceDeclaration } from '../payload/semanticResourceClient'

const themeRaw = (theme: string) => JSON.parse(readFileSync(join(process.cwd(), '..', 'public', 'data', `theme_${theme}.json`), 'utf8'))
const economy = themeRaw('economie')
const habitat = themeRaw('habitat')

beforeEach(() => { vi.stubEnv('VITE_SCALAR_COHORT_API', '1') })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

function pageFor(theme: string, indicator: string) {
  return validerThemeMetadata(themeRaw(theme), `theme_${theme}.json`).indicator_pages![indicator]!
}

function declaration(theme: string, indicator: string): SemanticResourceDeclaration {
  const page = pageFor(theme, indicator)
  const raw = themeRaw(theme)
  const contract = raw.scalar_contracts?.[indicator]
  return {
    resource_id: indicator, theme_id: theme, indicator_id: indicator,
    label: 'Libellé API éditorialement distinct', unit: page.unit,
    direction: page.comparison?.direction ?? page.direction,
    allowed_levels: contract?.allowed_levels ?? page.levels,
    sources: page.sources, shapes: ['scalar'], target_kinds: ['territory', 'territory_cohort'],
    fields: ['value', 'support_count', 'denominator_count'],
    intents: ['facts', 'fixed_comparison', 'selected_comparison'],
  }
}

function membersFor(target: SemanticReadItem['target']) {
  return territoiresFixture.filter((territory) => territory.type === target.type &&
    (target.kind !== 'territory_cohort' || ((!target.department_id || territory.departement === target.department_id) &&
      (!target.epci_id || territory.epci === target.epci_id))))
}

function scalarData(theme: string, indicator: string, item: SemanticReadItem, options: {
  observations?: Array<{ territory: string; status: string; value: number | null }>
  contentVersion?: string
  referenceVersion?: string
  unit?: string
  direction?: string
  facet?: string
  completeness?: string
  mutate?: (value: Record<string, unknown>) => void
} = {}) {
  const page = pageFor(theme, indicator)
  const members = membersFor(item.target)
  const target = item.target.kind === 'territory_cohort'
    ? { ...item.target, kind: 'territory_cohort' }
    : item.target
  const result: Record<string, unknown> = {
    resource: indicator, target, shape: 'scalar',
    cohort: { territory_type: item.target.type,
      department_id: item.target.kind === 'territory_cohort' ? item.target.department_id ?? null : null,
      epci_id: item.target.kind === 'territory_cohort' ? item.target.epci_id ?? null : null,
      member_count: members.length,
      members: members.map((member) => ({ id: member.territoire, type: member.type, name: member.nom })),
      reference_content_version: options.referenceVersion ?? 'reference-v7' },
    content_version: options.contentVersion ?? 'scalar-publication-v4',
    reference_content_version: options.referenceVersion ?? 'reference-v7',
    descriptor: { indicator_id: indicator, theme_id: theme,
      label: 'Libellé API éditorialement distinct', unit: options.unit ?? page.unit,
      direction: options.direction ?? (page.comparison?.direction ?? page.direction),
      comparison_facet: options.facet ?? (page.comparison?.indicator ?? indicator),
      allowed_levels: declaration(theme, indicator).allowed_levels,
      denominator_semantics: 'Dénominateur produit, documenté dans la publication',
      completeness: options.completeness ?? 'sparse', descriptor_version: 'scalar-descriptor-v3' },
    observations: (options.observations ?? [{ territory: members[0]!.territoire, status: 'measured', value: 9 }])
      .map(({ territory, status, value }) => {
        const reference = territoiresFixture.find((candidate) => candidate.territoire === territory)!
        return { territory: { id: territory, type: reference.type, name: reference.nom }, status, value,
          support_count: status === 'measured' ? 41 : 7, denominator_count: 100,
          sources: [{ source_id: page.sources[0], name: 'Source API mesurée', vintage_id: 'source-vintage-2026',
            version: '2026', reference_date: '2026-06-30', publication_date: '2026-07-01' }] }
      }),
  }
  options.mutate?.(result)
  return result
}

function installCatalogueAndReads(resources: SemanticResourceDeclaration[], respond: (item: SemanticReadItem) => Record<string, unknown>) {
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/resources') return new Response(JSON.stringify({ contract: 'semantic-resource-catalogue-v1', resources }))
    if (url === '/api/resources/read-batch') {
      const body = JSON.parse(init?.body as string) as { items: Array<SemanticReadItem & { id: string }> }
      return new Response(JSON.stringify({ contract: 'semantic-read-batch-v1', results: body.items.map((item) =>
        ({ id: item.id, resource: item.resource, data: respond(item) })) }))
    }
    throw new Error(`Unexpected semantic request: ${url}`)
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

describe('ordinary scalar producer declarations and semantic acquisition', () => {
  it('keeps the existing switch default and preserves producer registration boundaries', () => {
    expect(scalarCohortEnabled({})).toBe(false)
    expect(scalarCohortEnabled({ VITE_SCALAR_COHORT_API: '0' })).toBe(false)
    expect(scalarCohortEnabled({ VITE_SCALAR_COHORT_API: '1' })).toBe(true)
    const registered = indicateursScalairesEnregistres(habitat)
    expect(registered).toContain('prix_m2')
    const metadata = validerThemeMetadata(habitat, 'theme_habitat.json')
    const scalarPages = pagesScalairesEnregistrees(metadata, registered)
    expect(scalarPages).not.toContain('prix_m2')
    expect(() => validerEnregistrementScalaires(metadata, scalarPages)).not.toThrow()
  })

  it('reads native values, missing status, support, denominator, and complete provenance for a filtered page cohort', async () => {
    const indicator = 'effectifs_salaries'
    const page = pageFor('economie', indicator)
    const focal = territoiresFixture.find((territory) => territory.territoire === '22001')!
    const resource = declaration('economie', indicator)
    const fetcher = installCatalogueAndReads([resource], (item) => scalarData('economie', indicator, item, {
      observations: [
        { territory: '22001', status: 'measured', value: 9999 },
        { territory: '22002', status: 'suppressed', value: null },
      ],
    }))
    const identity: { contentVersion?: string; referenceContentVersion?: string } = {}
    const facts = await chargerCohorteScalaire(indicator, 'economie', page, focal, 'commune', territoiresFixture,
      { department: '22', epci: '200000001' }, identity)
    const request = JSON.parse((fetcher.mock.calls.find(([url]) => String(url) === '/api/resources/read-batch')?.[1] as RequestInit).body as string)
    expect(request.items).toHaveLength(1)
    expect(request.items[0]).toMatchObject({ resource: indicator,
      target: { kind: 'territory_cohort', type: 'commune', department_id: '22', epci_id: '200000001' },
      fields: ['value', 'support_count', 'denominator_count'], intent: { kind: 'facts' } })
    expect(facts.find((fact) => fact.territoire === '22001')).toMatchObject({ value: 9999,
      fact_status: 'measured', support_count: 41, denominator_count: 100,
      source_id: page.sources[0], vintage_id: 'source-vintage-2026', vintage_source: 'Source API mesurée',
      fact_sources: [{ sourceId: page.sources[0], version: '2026', referenceDate: '2026-06-30', publicationDate: '2026-07-01' }],
      rang_epci: null, rang_epci_n: null, rang_dep: null, rang_reg: null })
    expect(facts.find((fact) => fact.territoire === '22002')).toMatchObject({ value: null,
      fact_status: 'suppressed', observation_status: 'missing', support_count: 7, denominator_count: 100,
      rider: 'Valeur masquée selon les règles de diffusion.' })
    expect(facts.find((fact) => fact.territoire === '22002')?.rider).not.toBe('suppressed')
    expect(identity).toEqual({ contentVersion: 'scalar-publication-v4', referenceContentVersion: 'reference-v7' })
  })

  it('acquires all registered ordinary scalars in one bounded semantic batch and rejects mixed publication identities', async () => {
    const metadata = validerThemeMetadata(economy, 'theme_economie.json')
    const registered = indicateursScalairesEnregistres(economy).filter((indicator) => metadata.indicator_pages?.[indicator]?.family === 'scalar')
    const focal = territoiresFixture.find((territory) => territory.territoire === '22001')!
    const resources = registered.map((indicator) => declaration('economie', indicator))
    const fetcher = installCatalogueAndReads(resources, (item) => scalarData('economie', item.resource, item, {
      contentVersion: item.resource === 'chomage' ? 'another-publication' : 'scalar-publication-v4',
    }))
    await expect(chargerCohortesScalaires(registered, 'economie', metadata, focal, 'commune', territoiresFixture, {}))
      .rejects.toThrow('même version de publication')
    const calls = fetcher.mock.calls.filter(([url]) => String(url) === '/api/resources/read-batch')
    expect(calls).toHaveLength(1)
    const request = JSON.parse((calls[0]![1] as RequestInit).body as string)
    expect(request.items.length).toBe(registered.length)
    expect(request.items.length).toBeLessThanOrEqual(12)
  })

  it.each([
    ['resource identity', (value: Record<string, unknown>) => { value.resource = 'other' }],
    ['unit', (value: Record<string, unknown>) => { (value.descriptor as Record<string, unknown>).unit = 'wrong' }],
    ['direction', (value: Record<string, unknown>) => { (value.descriptor as Record<string, unknown>).direction = 'sideways' }],
    ['comparison facet', (value: Record<string, unknown>) => { (value.descriptor as Record<string, unknown>).comparison_facet = 'other' }],
    ['source identity', (value: Record<string, unknown>) => { ((value.observations as Array<Record<string, unknown>>)[0]!.sources as Array<Record<string, unknown>>)[0]!.source_id = 'other' }],
    ['support count', (value: Record<string, unknown>) => { ((value.observations as Array<Record<string, unknown>>)[0]!).support_count = -1 }],
    ['denominator count', (value: Record<string, unknown>) => { delete ((value.observations as Array<Record<string, unknown>>)[0]!).denominator_count }],
    ['echoed scope', (value: Record<string, unknown>) => { (value.target as Record<string, unknown>).department_id = '29' }],
  ])('rejects a scalar semantic response with invalid %s evidence', async (_label, mutate) => {
    const indicator = 'densite'
    const page = pageFor('demographie', indicator)
    const focal = territoiresFixture.find((territory) => territory.territoire === '22001')!
    installCatalogueAndReads([declaration('demographie', indicator)], (item) => scalarData('demographie', indicator, item, { mutate }))
    await expect(chargerCohorteScalaire(indicator, 'demographie', page, focal, 'commune', territoiresFixture,
      { department: '22' })).rejects.toThrow()
  })

  it('uses an explicit ADR-0021 commune peer set for the map rank and never reuses static rank columns', async () => {
    const indicator = 'densite'
    const page = pageFor('demographie', indicator)
    const focal = territoiresFixture.find((territory) => territory.territoire === '22001')!
    const resource = declaration('demographie', indicator)
    const expectedMembers = ['22001', '22002']
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/resources') return new Response(JSON.stringify({ contract: 'semantic-resource-catalogue-v1', resources: [resource] }))
      if (url === '/api/resources/read-batch') {
        const request = JSON.parse(init?.body as string) as { items: Array<SemanticReadItem & { id: string }> }
        const item = request.items[0]!
        return new Response(JSON.stringify({ contract: 'semantic-read-batch-v1', results: [{ id: item.id, resource: indicator, data: {
          resource: indicator, target: item.target, contract: 'indicator-comparison-v1', indicator_id: indicator,
          shape: 'scalar', content_version: 'scalar-publication-v4',
           reference_content_version: 'reference-v7', selection: expectedMembers.map((id) => ({ territory_type: 'commune', territory_id: id })),
           scope: { kind: 'explicit_selection', member_count: 2 }, result: { indicator_id: indicator, status: 'available',
             unit: page.unit, direction: page.direction, source_facet: indicator, descriptor_version: 'scalar-descriptor-v3',
             selected_member_count: 2, eligible_count: 2, missing_count: 0, rank: 2, rank_size: 2 },
        } }] }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const rank = await chargerRangScalaire(indicator, 'demographie', page, focal, territoiresFixture,
      { contentVersion: 'scalar-publication-v4', referenceContentVersion: 'reference-v7' })
    const call = fetcher.mock.calls.find(([url]) => String(url) === '/api/resources/read-batch')!
    const request = JSON.parse((call[1] as RequestInit).body as string)
    expect(request.items).toHaveLength(1)
    expect(request.items[0]).toMatchObject({ target: { kind: 'territory', type: 'commune', id: '22001' },
      intent: { kind: 'selected_comparison', members: [{ type: 'commune', id: '22001' }, { type: 'commune', id: '22002' }] } })
    expect(rank).toEqual({ rank: 2, rankSize: 2, scope: "dans l'EPCI" })
  })

  it('uses the producer same-level comparison for EPCI ranks and does not request a regional rank', async () => {
    const indicator = 'densite'
    const page = pageFor('demographie', indicator)
    const resource = declaration('demographie', indicator)
    const focal = territoiresFixture.find((territory) => territory.type === 'epci')!
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/resources') return new Response(JSON.stringify({ contract: 'semantic-resource-catalogue-v1', resources: [resource] }))
      const request = JSON.parse(init?.body as string) as { items: Array<SemanticReadItem & { id: string }> }
      const item = request.items[0]!
      return new Response(JSON.stringify({ contract: 'semantic-read-batch-v1', results: [{ id: item.id, resource: indicator, data: {
        resource: indicator, target: item.target, contract: 'indicator-comparison-v1', indicator_id: indicator,
        shape: 'scalar', content_version: 'scalar-publication-v4',
         reference_content_version: 'reference-v7', selection: null, scope: { kind: 'same_level', territory_type: 'epci', member_count: 2 },
         result: { indicator_id: indicator, status: 'available', unit: page.unit, direction: page.direction,
           source_facet: indicator, descriptor_version: 'scalar-descriptor-v3', selected_member_count: 2,
           eligible_count: 2, missing_count: 0, rank: 1, rank_size: 2 },
      } }] }))
    })
    vi.stubGlobal('fetch', fetcher)
    expect(await chargerRangScalaire(indicator, 'demographie', page, focal, territoiresFixture)).toEqual({
      rank: 1, rankSize: 2, scope: 'en Bretagne',
    })
    const request = JSON.parse((fetcher.mock.calls.find(([url]) => String(url) === '/api/resources/read-batch')![1] as RequestInit).body as string)
    expect(request.items[0].intent).toEqual({ kind: 'fixed_comparison', context: 'default' })
    const callsBeforeRegion = fetcher.mock.calls.length
    const region = territoiresFixture.find((territory) => territory.type === 'region')!
    expect(await chargerRangScalaire(indicator, 'demographie', page, region, territoiresFixture)).toBeNull()
    expect(fetcher.mock.calls).toHaveLength(callsBeforeRegion)
  })

  it('keeps a French unavailable explanation and never carries a stale source-state rider onto a new measurement', () => {
    const registered = ['bornes_ev_par_station_service']
    const source = indicateursEconomieFixture.find((fact) => fact.key === 'effectifs_salaries')!
    const stale = { ...source, key: registered[0]!, rider: 'Aucune station-service sur le territoire', value: null }
    const acquired = { ...stale, value: 999, rider: null, fact_status: 'measured' as const }
    const merged = remplacerFaitsScalaires([stale], [acquired], registered)
    expect(merged[0]).toMatchObject({ value: 999, fact_status: 'measured', rider: null })
    expect(merged[0]?.rider).not.toBe('Aucune station-service sur le territoire')
  })

  it('uses an app-owned French explanation for an unavailable scalar without leaking the API enum', async () => {
    const indicator = 'effectifs_salaries'
    const page = pageFor('economie', indicator)
    const focal = territoiresFixture.find((territory) => territory.territoire === '22001')!
    installCatalogueAndReads([declaration('economie', indicator)], (item) => scalarData('economie', indicator, item, {
      observations: [{ territory: '22001', status: 'not_available', value: null }],
    }))
    const facts = await chargerCohorteScalaire(indicator, 'economie', page, focal, 'commune', territoiresFixture, {})
    expect(facts[0]).toMatchObject({ value: null, fact_status: 'not_available', rider: 'Valeur non disponible.' })
    expect(facts[0]?.rider).not.toBe('not_available')
  })

  it('rejects a same-level rank whose returned level disagrees with the focal territory', async () => {
    const indicator = 'densite'
    const page = pageFor('demographie', indicator)
    const resource = declaration('demographie', indicator)
    const focal = territoiresFixture.find((territory) => territory.type === 'epci')!
    installCatalogueAndReads([resource], (item) => ({
      resource: indicator, target: item.target, contract: 'indicator-comparison-v1', indicator_id: indicator,
      shape: 'scalar', content_version: 'scalar-publication-v4', reference_content_version: 'reference-v7',
      selection: null, scope: { kind: 'same_level', territory_type: 'departement', member_count: 2 },
      result: { indicator_id: indicator, status: 'available', unit: page.unit, direction: page.direction,
        source_facet: indicator, descriptor_version: 'scalar-descriptor-v3', selected_member_count: 2,
        eligible_count: 2, missing_count: 0, rank: 1, rank_size: 2 },
    }))
    await expect(chargerRangScalaire(indicator, 'demographie', page, focal, territoiresFixture))
      .rejects.toThrow('groupe demandé')
  })

  it.each([
    ['negative eligible count', (result: Record<string, unknown>) => { result.eligible_count = -1 }],
    ['rank on unavailable result', (result: Record<string, unknown>) => { result.status = 'unavailable' }],
  ])('rejects a comparison with %s', async (_label, mutate) => {
    const indicator = 'densite'
    const page = pageFor('demographie', indicator)
    const resource = declaration('demographie', indicator)
    const focal = territoiresFixture.find((territory) => territory.type === 'epci')!
    installCatalogueAndReads([resource], (item) => {
      const result: Record<string, unknown> = { indicator_id: indicator, status: 'available', unit: page.unit,
        direction: page.direction, source_facet: indicator, descriptor_version: 'scalar-descriptor-v3',
        selected_member_count: 2, eligible_count: 2, missing_count: 0, rank: 1, rank_size: 2 }
      mutate(result)
      return { resource: indicator, target: item.target, contract: 'indicator-comparison-v1', indicator_id: indicator,
        shape: 'scalar', content_version: 'scalar-publication-v4', reference_content_version: 'reference-v7',
        selection: null, scope: { kind: 'same_level', territory_type: 'epci', member_count: 2 }, result }
    })
    await expect(chargerRangScalaire(indicator, 'demographie', page, focal, territoiresFixture)).rejects.toThrow()
  })

  it('keeps an explicitly empty fiche comparison honest and does not attach a rank', async () => {
    const indicator = 'densite'
    const page = pageFor('demographie', indicator)
    const focal = territoiresFixture.find((territory) => territory.territoire === '22001')!
    const fetcher = installCatalogueAndReads([declaration('demographie', indicator)], (item) => ({
      resource: indicator, target: item.target, contract: 'indicator-comparison-v1', indicator_id: indicator,
      shape: 'scalar', content_version: 'scalar-publication-v4', reference_content_version: 'reference-v7',
      selection: [], scope: { kind: 'explicit_selection', member_count: 0 },
      result: { indicator_id: indicator, status: 'unavailable', unit: page.unit, direction: page.direction,
        source_facet: indicator, descriptor_version: 'scalar-descriptor-v3', selected_member_count: 0,
        eligible_count: 0, missing_count: 0, rank: null, rank_size: null },
    }))
    await expect(chargerComparaisonsScalaires([indicator], 'demographie', { [indicator]: page }, focal,
      territoiresFixture, { kind: 'selected', members: [], scope: {
        kind: 'explicit_selection', territoryType: 'commune', memberCount: 0, label: null,
      } })).resolves.toEqual({ [indicator]: null })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('keeps a singleton comparison without a rank or unnecessary API read', async () => {
    const indicator = 'densite'
    const page = pageFor('demographie', indicator)
    const focal = territoiresFixture.find((territory) => territory.territoire === '22001')!
    const fetcher = installCatalogueAndReads([declaration('demographie', indicator)], () => {
      throw new Error('A singleton comparison must not acquire a rank')
    })
    await expect(chargerComparaisonsScalaires([indicator], 'demographie', { [indicator]: page }, focal,
      territoiresFixture, { kind: 'selected', members: [{ type: 'commune', id: focal.territoire }], scope: {
        kind: 'explicit_selection', territoryType: 'commune', memberCount: 1, label: 'commune seule',
      } })).resolves.toEqual({ [indicator]: null })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
