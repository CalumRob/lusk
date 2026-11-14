import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'

import VarianteCahierLibre from '@/fiche/prototype/VarianteCahierLibre.vue'
import { cahierPaginationFor } from '@/fiche/prototype/cahierPagination'
import { mobilityFactsFromThemeApi } from '@/fiche/content/mobilityThemeApiFacts'
import { resolveMobiliteThemeContent } from '@/fiche/content/themeContent'
import type { ThemeMetadata } from '@/payload/types'
import {
  histoiresMobiliteFixture,
  metadonneesThemesFixtures,
  territoiresFixture,
  vintagesFixture,
} from '@/payload/fixtures'
import type { Payload } from '@/payload/types'
import { routes } from '@/router'
import liveEnvelope from './fixtures/raccordement-live-envelope.json'

const publicMetadata = JSON.parse(readFileSync(
  join(process.cwd(), '..', 'public', 'data', 'theme_mobilite.json'), 'utf8',
)) as ThemeMetadata

const payload: Payload = {
  territoires: territoiresFixture.some((territory) => territory.territoire === '35238')
    ? territoiresFixture
    : [...territoiresFixture, { territoire: '35238', type: 'commune', nom: 'Rennes', departement: '35', epci: null }],
  indicateurs: [],
  histoires: histoiresMobiliteFixture,
  runReport: null,
  vintages: vintagesFixture,
  programmes: null,
  themeMetadata: { mobilite: metadonneesThemesFixtures.mobilite },
}

describe('Mobilité page 3 — captured live curve envelope', () => {
  it('renders the actual production grid and path from the captured API contract', async () => {
    const facts = mobilityFactsFromThemeApi(payload, '35238', liveEnvelope)
    expect(facts.mobility.trajectoryContract).toMatchObject({
      axisKind: 'duration_minute',
      comparisonStatistic: 'mean',
      comparisonScope: 'selected_group',
    })
    expect(facts.mobility.trajectoryContract?.axisValues).toHaveLength(73)
    expect(facts.mobility.trajectoryContract?.axisNumericValues.slice(0, 3)).toEqual([0, 5, 10])
    const curve = facts.mobility.indicators.filter((fact) => fact.key === 'raccordement_courbe')
    expect(curve).toHaveLength(73)
    expect(curve[0]).toMatchObject({ detail: 't0000', axisValue: 0 })
    expect(curve[18]).toMatchObject({ detail: 't0090', axisValue: 90 })

    const content = resolveMobiliteThemeContent(facts, publicMetadata)
    const section = content.units.find((unit) => unit.key === 'offre-transports-commun')!.sections[1]
    if (section.evidence?.kind !== 'mobilite-raccordement') throw new Error('Curve evidence expected')
    expect(section.evidence.points).toHaveLength(73)
    expect(section.evidence.axis?.minimum).toBe(0)
    expect(section.evidence.axis?.maximum).toBe(360)

    const router = createRouter({ history: createMemoryHistory(), routes })
    const wrapper = mount(VarianteCahierLibre, {
      props: {
        content,
        pagination: cahierPaginationFor(payload, content, true),
        presentation: 'plain',
        layoutVariant: 'indexed-sections',
        showAllUnits: true,
        nativeComparisonStatus: 'ready',
      },
      global: { plugins: [router] },
    })
    await router.isReady()
    await flushPromises()
    const curveSection = wrapper.get('[data-section="visiter-la-bretagne"]')
    expect(curveSection.find('svg[role="img"]').exists()).toBe(true)
    // One straight-segment path through all 73 published points, no point chain.
    const path = curveSection.get('.mobilite-raccordement-curve__territory').attributes('d')!
    expect((path.match(/L/gu) ?? [])).toHaveLength(72)
    expect(curveSection.findAll('.mobilite-raccordement-curve__point--territory')).toHaveLength(0)
    expect(curveSection.findAll('.cahier-figure-tick-label--x').length).toBeGreaterThan(0)
    expect(curveSection.find('.mobilite-raccordement-curve__marker').attributes('data-detail')).toBe('t0090')
    expect(curveSection.get('svg[role="img"]').attributes('aria-label')).toContain('1 h 30 (90 min)')
    wrapper.unmount()
  })
})
