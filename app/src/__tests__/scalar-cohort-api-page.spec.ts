import { flushPromises, mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GEOMETRIE_CHARGER_KEY } from '../geo/useGeometrie'
import { indicateursDemographieFixture, indicateursEconomieFixture, territoiresFixture } from '../payload/fixtures'
import { PAYLOAD_CHARGER_KEY, type ChargerFichier } from '../payload/usePayload'
import { validerThemeMetadata } from '../payload/validate'
import { chargerCohorteScalaire, chargerCohortesScalaires, indicateursScalairesEnregistres, pagesScalairesEnregistrees, remplacerFaitsScalaires, validerEnregistrementScalaires } from '../payload/scalarCohort'
import { formaterRang } from '../payload/selectors'
import { routes } from '../router'
import IndicateurView from '../views/IndicateurView.vue'

const economyMetadata = { ...JSON.parse(readFileSync(join(process.cwd(), '..', 'public', 'data', 'theme_economie.json'), 'utf8')),
  scalar_contracts: ['effectifs_salaries', 'chomage'] }
const demographyMetadataRaw = JSON.parse(readFileSync(join(process.cwd(), '..', 'public', 'data', 'theme_demographie.json'), 'utf8'))
const mobilityMetadataRaw = JSON.parse(readFileSync(join(process.cwd(), '..', 'public', 'data', 'theme_mobilite.json'), 'utf8'))
const habitatMetadataRaw = JSON.parse(readFileSync(join(process.cwd(), '..', 'public', 'data', 'theme_habitat.json'), 'utf8'))
const productionThemeMetadata = { economie: economyMetadata, demographie: demographyMetadataRaw, mobilite: mobilityMetadataRaw }
// Rank parity reference only: API-selected page tests never load this static fact payload as a fallback.
const canonicalEconomyFacts = JSON.parse(readFileSync(join(process.cwd(), '..', 'public', 'data', 'indicateurs_economie.json'), 'utf8')) as Array<Record<string, unknown>>
const canonicalRank = (indicator: string, territoryId: string) => canonicalEconomyFacts.find((fact) =>
  fact.key === indicator && fact.type === 'commune' && fact.territoire === territoryId)
beforeEach(() => { localStorage.clear(); vi.stubEnv('VITE_SCALAR_COHORT_API', '1') })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

function response(indicator = 'effectifs_salaries') {
  const page = economyMetadata.indicator_pages[indicator]
  const publishedRank = canonicalRank(indicator, '22001')
  return { indicator_id: indicator, territory_type: 'commune', label: page.label, unit: page.unit,
    direction: page.direction, comparison_facet: indicator, completeness: 'sparse', content_version: 'scalar-v1',
    observations: [
      { territory_id: '22001', name: 'Commune A1', value: 9, status: 'measured',
        rang_epci: publishedRank?.rang_epci ?? null, rang_epci_n: publishedRank?.rang_epci_n ?? null,
        rang_dep: publishedRank?.rang_dep ?? null, rang_dep_n: publishedRank?.rang_dep_n ?? null,
        rang_reg: publishedRank?.rang_reg ?? null, rang_reg_n: publishedRank?.rang_reg_n ?? null,
        sources: [{ source_id: page.sources[0], name: 'Source', vintage_id: 'v1', version: '2024', reference_date: null, publication_date: null }] },
      { territory_id: '22002', name: 'Commune D', value: null, status: 'not_published', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, sources: [] },
    ] }
}

async function mountEconomy(initial = '/indicateurs/economie/effectifs_salaries?territoire=22001&niveau=commune', allowStatic = false) {
  const payloadCalls: string[] = []
  const loader: ChargerFichier = async (file) => {
    payloadCalls.push(file)
    if (file === 'territoires') return territoiresFixture
    if (allowStatic && file === 'indicateurs_economie') return indicateursEconomieFixture
    if (allowStatic && file === 'theme_economie') return validerThemeMetadata(economyMetadata, 'theme_economie.json')
    if (allowStatic && file === 'indicateurs_demographie') return indicateursDemographieFixture
    if (allowStatic && file === 'theme_demographie') return validerThemeMetadata(demographyMetadataRaw, 'theme_demographie.json')
    throw new Error(`static scalar payload must not be requested: ${file}`)
  }
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(initial); await router.isReady()
  const empty = { type: 'FeatureCollection' as const, features: [] }
  const wrapper = mount(IndicateurView, { global: { plugins: [router], provide: {
    [PAYLOAD_CHARGER_KEY]: loader,
    [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
  } } })
  return { wrapper, router, payloadCalls }
}

describe('Page indicateur économie - cohorte scalaire API', () => {
  it('keeps registered non-scalar Habitat pages out of fiche cohort replacement', () => {
    const registered = indicateursScalairesEnregistres(habitatMetadataRaw)
    expect(registered).toContain('prix_m2')
    expect(habitatMetadataRaw.indicator_pages.prix_m2.family).toBe('trajectory')
    expect(habitatMetadataRaw.indicator_pages.part_passoires.family).toBe('scalar')
    expect(() => validerThemeMetadata(habitatMetadataRaw, 'theme_habitat.json')).not.toThrow()
    const metadata = validerThemeMetadata(habitatMetadataRaw, 'theme_habitat.json')
    const selected = pagesScalairesEnregistrees(metadata, registered)
    expect(selected).toEqual(['part_passoires'])
    expect(() => validerEnregistrementScalaires(metadata, selected)).not.toThrow()
    const priceTrajectory = { theme: 'habitat', key: 'prix_m2' } as never
    expect(remplacerFaitsScalaires([priceTrajectory], [], selected)).toEqual([priceTrajectory])
  })
  it('acquires registered facts concurrently and replaces only those theme rows', async () => {
    const metadata = validerThemeMetadata(economyMetadata, 'theme_economie.json')
    const registered = indicateursScalairesEnregistres(economyMetadata)
    const focal = territoiresFixture.find((territory) => territory.type === 'commune')!
    const active: string[] = []
    let peak = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      active.push(url); peak = Math.max(peak, active.length)
      await Promise.resolve()
      active.pop()
      const indicator = decodeURIComponent(url.split('/').at(-1)!.split('?')[0]!)
      const page = metadata.indicator_pages![indicator]!
      return new Response(JSON.stringify({ indicator_id: indicator, territory_type: 'commune', label: page.label,
        unit: page.unit, direction: page.direction, comparison_facet: page.comparison?.indicator ?? indicator,
        completeness: 'sparse', content_version: 'batch-v1', territory_reference_version: 'territories-v1', observations: [{ territory_id: focal.territoire,
          name: focal.nom, value: 2, status: 'measured', rang_epci: 1, rang_epci_n: 3, rang_dep: null,
          rang_dep_n: null, rang_reg: null, rang_reg_n: null, sources: [{ source_id: page.sources[0],
            name: 'Source', vintage_id: 'v1', version: '2024', reference_date: null, publication_date: null }] }] }), { status: 200 })
    }))
    const facts = await chargerCohortesScalaires(registered, 'economie', metadata, focal, 'commune', territoiresFixture, {})
    expect(facts.map((fact) => fact.key).sort()).toEqual([...registered].sort())
    expect(peak).toBeGreaterThan(1)
    const old = [...indicateursEconomieFixture]
    const untouched = old.find((row) => !registered.includes(row.key))!
    const merged = remplacerFaitsScalaires(old, facts, registered)
    expect(merged.filter((row) => registered.includes(row.key))).toHaveLength(facts.length)
    expect(merged).toContain(untouched)
  })
  it.each(['content_version', 'territory_reference_version'] as const)(
    'rejects registered batches with mixed %s identities', async (identity) => {
      const metadata = validerThemeMetadata(economyMetadata, 'theme_economie.json')
      const registered = indicateursScalairesEnregistres(economyMetadata)
      const focal = territoiresFixture.find((territory) => territory.type === 'commune')!
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        const indicator = decodeURIComponent(url.split('/').at(-1)!.split('?')[0]!)
        const page = metadata.indicator_pages![indicator]!
        return new Response(JSON.stringify({ indicator_id: indicator, territory_type: 'commune', label: page.label,
          unit: page.unit, direction: page.direction, comparison_facet: page.comparison?.indicator ?? indicator,
          completeness: 'sparse', content_version: identity === 'content_version' && indicator === 'chomage' ? 'other' : 'batch-v1',
          territory_reference_version: identity === 'territory_reference_version' && indicator === 'chomage' ? 'other' : 'territories-v1',
          observations: [{ territory_id: focal.territoire, name: focal.nom, value: 2, status: 'measured',
            rang_epci: 1, rang_epci_n: 3, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null,
            sources: [{ source_id: page.sources[0], name: 'Source', vintage_id: 'v1', version: '2024',
              reference_date: null, publication_date: null }] }] }), { status: 200 })
      }))
      await expect(chargerCohortesScalaires(registered, 'economie', metadata, focal, 'commune', territoiresFixture, {}))
        .rejects.toThrow('même version de publication et de référentiel territorial')
    },
  )
  it('loads each producer-registered scalar page from all current themes through the production cohort adapter', async () => {
    for (const theme of ['economie', 'demographie', 'mobilite'] as const) {
      const raw = productionThemeMetadata[theme]
      const registered = indicateursScalairesEnregistres(raw)
      const metadata = validerThemeMetadata(raw, `theme_${theme}.json`)
      const declared = Array.isArray(raw.scalar_contracts) ? raw.scalar_contracts : Object.keys(raw.scalar_contracts)
      expect(registered).toEqual(declared)
      expect(registered.length).toBeGreaterThan(0)
      for (const id of registered) {
        const page = metadata.indicator_pages?.[id]
        expect(page, `${theme}/${id} is registered without a page`).toBeDefined()
        if (!page) continue
        expect(page.family).toBe('scalar')
        const focal = territoiresFixture.find((territory) => territory.type === 'commune')!
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
          indicator_id: id, territory_type: 'commune', label: page.label, unit: page.unit,
          direction: page.direction, comparison_facet: page.comparison?.indicator ?? id,
          completeness: 'sparse', content_version: 'test', territory_reference_version: 'territories-v1', observations: [{
            territory_id: focal.territoire, name: focal.nom, value: 1, status: 'measured',
            rang_epci: 1, rang_epci_n: 1, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null,
            sources: [{ source_id: page.sources[0], name: 'Source', vintage_id: 'v1', version: '2024', reference_date: null, publication_date: null }],
          }],
        }), { status: 200 })))
        const facts = await chargerCohorteScalaire(id, theme, page, focal, 'commune', territoiresFixture, {})
        expect(facts[0]).toMatchObject({ theme, key: id, territoire: focal.territoire, value: 1, rang_epci: 1, rang_epci_n: 1 })
      }
    }
  })

  it('preserves publisher-provided rank and denominator fields without recomputing them', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(response()), { status: 200 })))
    const page = validerThemeMetadata(economyMetadata, 'theme_economie.json').indicator_pages!.effectifs_salaries!
    const facts = await chargerCohorteScalaire('effectifs_salaries', 'economie', page, territoiresFixture[0]!, 'commune',
      territoiresFixture, {})
    expect(facts.find((fact) => fact.territoire === '22001')).toMatchObject({
      rang_epci: canonicalRank('effectifs_salaries', '22001')?.rang_epci,
      rang_epci_n: canonicalRank('effectifs_salaries', '22001')?.rang_epci_n,
      rang_dep: canonicalRank('effectifs_salaries', '22001')?.rang_dep,
      rang_dep_n: canonicalRank('effectifs_salaries', '22001')?.rang_dep_n,
      rang_reg: canonicalRank('effectifs_salaries', '22001')?.rang_reg,
      rang_reg_n: canonicalRank('effectifs_salaries', '22001')?.rang_reg_n,
    })
    expect(facts.find((fact) => fact.territoire === '22002')).toMatchObject({
      value: null, observation_status: 'missing', rang_epci: null, rang_reg: null,
    })
  })

  it.each([
    ['unknown territory', (body: ReturnType<typeof response>) => { body.observations[0]!.territory_id = '99999' }],
    ['unknown status', (body: ReturnType<typeof response>) => { body.observations[0]!.status = 'zero' }],
    ['undeclared source', (body: ReturnType<typeof response>) => { body.observations[0]!.sources[0]!.source_id = 'other_source' }],
    ['invalid rank', (body: ReturnType<typeof response>) => { body.observations[0]!.rang_reg = 0 }],
    ['unranked old API contract', (body: ReturnType<typeof response>) => { Reflect.deleteProperty(body.observations[0], 'rang_reg_n') }],
    ['empty explicit territory reference version', (body: ReturnType<typeof response>) => { Object.assign(body, { territory_reference_version: '' }) }],
    ['missing focal row', (body: ReturnType<typeof response>) => { body.observations = [body.observations[1]!] }],
  ])('rejects a cohort containing %s', async (_label, mutate) => {
    const body = response()
    mutate(body)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })))
    const page = validerThemeMetadata(economyMetadata, 'theme_economie.json').indicator_pages!.effectifs_salaries!
    await expect(chargerCohorteScalaire('effectifs_salaries', 'economie', page, territoiresFixture[0]!, 'commune',
      territoiresFixture, {})).rejects.toThrow()
  })

  it('acquiert les faits via API pour Repères et Carte sans charger les faits statiques', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/data/theme_economie.json') return new Response(JSON.stringify(economyMetadata), { status: 200 })
      return new Response(JSON.stringify(response()), { status: 200 })
    })
    vi.stubGlobal('fetch', fetcher)
    const { wrapper, payloadCalls } = await mountEconomy()
    await flushPromises()
    expect(payloadCalls).toEqual(['territoires'])
    expect(fetcher).toHaveBeenCalledWith('/api/territories/commune/22001/indicator-cohorts/effectifs_salaries?scope_level=commune')
    expect(wrapper.text()).toContain('Effectifs salariés (lieu de travail)')
    expect(wrapper.text()).toContain('9')
    const expectedRank = canonicalRank('effectifs_salaries', '22001')!
    expect(wrapper.text()).toContain(formaterRang(expectedRank.rang_epci as number, expectedRank.rang_epci_n as number))
    await wrapper.get('.vues button:nth-child(2)').trigger('click')
    await flushPromises()
    expect(wrapper.find('.carte-indicateur').exists()).toBe(true)
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('indicator-cohorts'))).toHaveLength(1)
    wrapper.unmount()
  })

  it('montre une erreur retryable sans repli statique quand le cohort API est indisponible', async () => {
    let attempts = 0
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/data/theme_economie.json') return new Response(JSON.stringify(economyMetadata), { status: 200 })
      attempts++
      return attempts === 1 ? new Response('', { status: 503 }) : new Response(JSON.stringify(response()), { status: 200 })
    })
    vi.stubGlobal('fetch', fetcher)
    const { wrapper, payloadCalls } = await mountEconomy()
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Réessayer')
    expect(payloadCalls).toEqual(['territoires'])
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(attempts).toBe(2)
    expect(wrapper.text()).toContain('9')
    wrapper.unmount()
  })

  it('reacts to page navigation and deduplicates requests per normalized page/scope', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/data/theme_economie.json') return new Response(JSON.stringify(economyMetadata), { status: 200 })
      const indicator = url.includes('/chomage?') ? 'chomage' : 'effectifs_salaries'
      return new Response(JSON.stringify(response(indicator)), { status: 200 })
    })
    vi.stubGlobal('fetch', fetcher)
    const { wrapper, router } = await mountEconomy()
    await flushPromises()
    await router.push('/indicateurs/economie/chomage?territoire=22001&niveau=commune')
    await flushPromises()
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('indicator-cohorts'))).toHaveLength(2)
    expect(wrapper.text()).toContain('Chômage (population active)')
    wrapper.unmount()
  })

  it('keeps the newest level cohort when a previous request resolves out of order', async () => {
    let finishCommune: ((value: Response) => void) | undefined
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/data/theme_economie.json') return Promise.resolve(new Response(JSON.stringify(economyMetadata), { status: 200 }))
      if (url.includes('/commune/')) return new Promise<Response>((resolve) => { finishCommune = resolve })
      const page = economyMetadata.indicator_pages.effectifs_salaries
      return Promise.resolve(new Response(JSON.stringify({ ...response(), territory_type: 'departement',
        observations: [{ territory_id: '22', name: 'Département 22', value: 222, status: 'measured',
          rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: 2, rang_reg_n: 4,
          sources: [{ source_id: page.sources[0], name: 'Source', vintage_id: 'v1', version: '2024', reference_date: null, publication_date: null }] }] }), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetcher)
    const { wrapper, router } = await mountEconomy()
    await flushPromises()
    await router.push('/indicateurs/economie/effectifs_salaries?territoire=22001&niveau=departement')
    await flushPromises()
    expect(wrapper.text()).toContain('222')
    finishCommune?.(new Response(JSON.stringify(response()), { status: 200 }))
    await flushPromises()
    expect(wrapper.text()).toContain('222')
    wrapper.unmount()
  })

  it('retains unregistered sparse-evidence pages on their static contract when scalar cutover is enabled', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/data/theme_economie.json') return new Response(JSON.stringify(economyMetadata), { status: 200 })
      throw new Error('unregistered page must not call the scalar API')
    })
    vi.stubGlobal('fetch', fetcher)
    const { wrapper, payloadCalls } = await mountEconomy(
      '/indicateurs/economie/eco_activites?territoire=22001&niveau=commune', true)
    await flushPromises()
    expect(payloadCalls).toEqual(['territoires', 'indicateurs_economie', 'theme_economie'])
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('indicator-cohorts'))).toHaveLength(0)
    expect(wrapper.text()).toContain('Part des éco-activités')
    wrapper.unmount()
  })

  it('uses the real router transition path across registered, unregistered, other-theme, and registered pages', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/data/theme_economie.json') return new Response(JSON.stringify(economyMetadata), { status: 200 })
      if (url === '/data/theme_demographie.json') return new Response(JSON.stringify({ ...demographyMetadataRaw,
        scalar_contracts: ['densite'] }), { status: 200 })
      if (url.includes('/indicator-cohorts/densite?')) {
        const page = demographyMetadataRaw.indicator_pages.densite
        return new Response(JSON.stringify({ ...response(), indicator_id: 'densite', label: page.label,
          unit: page.unit, direction: page.direction, comparison_facet: 'densite',
          observations: [{ territory_id: '22001', name: 'Commune A1', value: 42, status: 'measured',
            rang_epci: 1, rang_epci_n: 1, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null,
            sources: [{ source_id: page.sources[0], name: 'Source', vintage_id: 'v1', version: '2024', reference_date: null, publication_date: null }] }] }), { status: 200 })
      }
      return new Response(JSON.stringify(response(url.includes('/chomage?') ? 'chomage' : 'effectifs_salaries')), { status: 200 })
    })
    vi.stubGlobal('fetch', fetcher)
    const { wrapper, router, payloadCalls } = await mountEconomy(undefined, true)
    await flushPromises()
    await router.push('/indicateurs/economie/eco_activites?territoire=22001&niveau=commune')
    await flushPromises()
    expect(payloadCalls).toContain('indicateurs_economie')
    expect(wrapper.text()).toContain('Part des éco-activités')
    await router.push('/indicateurs/demographie/densite?territoire=22001&niveau=commune')
    await flushPromises()
    expect(payloadCalls).not.toContain('indicateurs_demographie')
    expect(wrapper.text()).toContain('Densité')
    await router.push('/indicateurs/economie/chomage?territoire=22001&niveau=commune')
    await flushPromises()
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('indicator-cohorts'))).toHaveLength(3)
    expect(wrapper.text()).toContain('Chômage (population active)')
    wrapper.unmount()
  })

  it.each([
    ['missing', (raw: Record<string, unknown>) => { delete raw.scalar_contracts }],
    ['malformed', (raw: Record<string, unknown>) => { raw.scalar_contracts = ['effectifs_salaries', 12] }],
    ['page mismatch', (raw: Record<string, unknown>) => { raw.scalar_contracts = ['missing_page'] }],
  ])('fails closed on %s scalar registration and retries metadata acquisition', async (_label, mutate) => {
    let attempts = 0
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) !== '/data/theme_economie.json') throw new Error('no scalar API should start before metadata validates')
      attempts++
      if (attempts > 1) return new Response(JSON.stringify(economyMetadata), { status: 200 })
      const invalid = JSON.parse(JSON.stringify(economyMetadata)) as Record<string, unknown>
      mutate(invalid)
      return new Response(JSON.stringify(invalid), { status: 200 })
    })
    vi.stubGlobal('fetch', fetcher)
    const { wrapper, payloadCalls } = await mountEconomy()
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Réessayer')
    expect(payloadCalls).toEqual(['territoires'])
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(attempts).toBe(2)
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('indicator-cohorts'))).toHaveLength(1)
    wrapper.unmount()
  })

  it.each(['fetch failure', 'malformed JSON'])('surfaces and retries Economy metadata %s without static scalar fallback', async (failure) => {
    let attempts = 0
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) !== '/data/theme_economie.json') return new Response(JSON.stringify(response()), { status: 200 })
      attempts++
      if (attempts === 1) {
        if (failure === 'fetch failure') throw new TypeError('network offline')
        return new Response('{broken', { status: 200 })
      }
      return new Response(JSON.stringify(economyMetadata), { status: 200 })
    })
    vi.stubGlobal('fetch', fetcher)
    const { wrapper, payloadCalls } = await mountEconomy()
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Réessayer')
    expect(payloadCalls).toEqual(['territoires'])
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(attempts).toBe(2)
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('indicator-cohorts'))).toHaveLength(1)
    wrapper.unmount()
  })
})
