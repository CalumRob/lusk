import { flushPromises, mount } from '@vue/test-utils'

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import * as echarts from 'echarts/core'

import GraphiqueSoldes from '../components/fiche/GraphiqueSoldes.vue'
import type { PointNuage } from '../payload/selectors'
import { routes } from '../router'

/**
 * GraphiqueSoldes — the Démographie story chart (docs/themes/demographie.md,
 * ADR-0011): the quadrant of the two annualized per-mille rates (taux naturel
 * × taux migratoire), axes crossing at 0, plus the context cloud — the
 * territory's comparison group at the same scale (EPCI's communes, the other
 * EPCIs/départements, all communes for the région). Every cloud point is
 * hoverable (its name + rates) and CLICKABLE — it opens that point's own
 * fiche. The canvas is ECharts (stubbed globally in setup.ts); the figure's
 * data is ALSO rendered as an accessible description (role=img aria-label) —
 * WCAG 2.2 AA, the reading never depends on canvas alone.
 */

const pointA1: PointNuage = {
  territoire: '22001',
  type: 'commune',
  nom: 'Commune A1',
  tauxNaturel: 5.982906,
  tauxMigratoire: 2.564103,
}
const pointD: PointNuage = {
  territoire: '22002',
  type: 'commune',
  nom: 'Commune D',
  tauxNaturel: -8.080808,
  tauxMigratoire: -2.020202,
}

let router: Router

function optionRendue() {
  const initMock = vi.mocked(echarts.init)
  const instance = initMock.mock.results[0]?.value
  return instance?.setOption.mock.calls[0]?.[0] as Record<string, unknown> | undefined
}

function instanceRendue() {
  const initMock = vi.mocked(echarts.init)
  return initMock.mock.results[0]?.value
}

function monter(nuage: typeof pointA1[] = []) {
  return mount(GraphiqueSoldes, {
    props: {
      tauxNaturel: 5.982906,
      tauxMigratoire: 2.564103,
      classification: 'attire-renouvelle',
      nom: 'Commune A1',
      nuage,
    },
    global: { plugins: [router] },
  })
}

describe('GraphiqueSoldes — the rate-quadrant story chart', () => {
  beforeEach(() => {
    router = createRouter({ history: createMemoryHistory(), routes })
  })

  it('describes the point accessibly: the two rates and the reading', () => {
    const wrapper = monter()

    const zone = wrapper.find('[role="img"]')
    expect(zone.attributes('aria-label')).toContain('Commune A1')
    expect(zone.attributes('aria-label')).toContain('5,98')
    expect(zone.attributes('aria-label')).toContain('2,56')
    expect(zone.attributes('aria-label')).toContain('attire-renouvelle')
  })

  it('renders no chart legend — the reading lives in « Comment lire », once', () => {
    const wrapper = monter()

    expect(wrapper.find('.graphique-soldes-legende').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('lecture :')
  })

  it('plots the quadrant: the two axes cross at 0 via markLine, no median line', async () => {
    const initMock = vi.mocked(echarts.init)
    initMock.mockClear()

    const wrapper = monter()
    await vi.waitFor(() => expect(initMock).toHaveBeenCalled())

    const option = optionRendue()
    const xAxis = (option?.xAxis as { markLine?: unknown }) ?? {}
    const yAxis = (option?.yAxis as { markLine?: unknown }) ?? {}
    expect(xAxis.markLine).toBeTruthy()
    expect(yAxis.markLine).toBeTruthy()

    wrapper.unmount()
  })

  it('draws the context cloud — each point carries its name, its code and its type', async () => {
    const initMock = vi.mocked(echarts.init)
    initMock.mockClear()

    const wrapper = monter([pointA1, pointD])
    await vi.waitFor(() => expect(initMock).toHaveBeenCalled())

    const series = (optionRendue()?.series as Array<Record<string, unknown>>) ?? []
    const nuage = series.find((s) => s.name === 'contexte')
    expect(nuage).toBeTruthy()
    expect(nuage?.data).toEqual([
      { value: [2.564103, 5.982906], nom: 'Commune A1', territoire: '22001', type: 'commune' },
      { value: [-2.020202, -8.080808], nom: 'Commune D', territoire: '22002', type: 'commune' },
    ])

    wrapper.unmount()
  })

  it('names each hovered cloud point in the tooltip formatter', async () => {
    const initMock = vi.mocked(echarts.init)
    initMock.mockClear()

    const wrapper = monter([pointA1, pointD])
    await vi.waitFor(() => expect(initMock).toHaveBeenCalled())

    const option = optionRendue()
    const formatter = (option?.tooltip as { formatter?: (p: unknown) => string })
      ?.formatter as ((p: unknown) => string) | undefined
    expect(formatter).toBeTypeOf('function')
    const texte = formatter?.({
      data: { value: [-2.020202, -8.080808], nom: 'Commune D', territoire: '22002', type: 'commune' },
    })
    expect(texte).toContain('Commune D')
    expect(texte).toContain('-8,08')
    expect(texte).toContain('-2,02')

    wrapper.unmount()
  })

  it('positions the tooltip beside the point, never over it (canvas-relative math)', async () => {
    const initMock = vi.mocked(echarts.init)
    initMock.mockClear()

    const wrapper = monter([pointA1, pointD])
    await vi.waitFor(() => expect(initMock).toHaveBeenCalled())

    const option = optionRendue()
    const position = (option?.tooltip as { position?: (p: unknown[], x: unknown, y: unknown, z: unknown, t: unknown) => [number, number] })
      ?.position as ((p: unknown[], _a: unknown, _d: unknown, _r: unknown, t: unknown) => [number, number]) | undefined
    expect(position).toBeTypeOf('function')

    // a point in the middle of the chart: tooltip floats ABOVE it (x+12, y-ch-12)
    const auMilieu = position?.([100, 120], null, null, null, { contentSize: [150, 60], viewSize: [800, 280] })
    expect(auMilieu).toEqual([112, 48])
    // a point near the top: tooltip drops BELOW it instead of clipping off-canvas
    const enHaut = position?.([100, 20], null, null, null, { contentSize: [150, 60], viewSize: [800, 280] })
    expect(enHaut).toEqual([112, 34])
    // never beyond the chart's right edge
    const aDroite = position?.([790, 120], null, null, null, { contentSize: [150, 60], viewSize: [800, 280] })
    expect(aDroite?.[0]).toBeLessThanOrEqual(800 - 4)

    wrapper.unmount()
  })

  it('navigates to a cloud point’s own fiche on click', async () => {
    const initMock = vi.mocked(echarts.init)
    initMock.mockClear()

    const wrapper = monter([pointA1, pointD])
    await vi.waitFor(() => expect(initMock).toHaveBeenCalled())

    const instance = instanceRendue()
    const onSpy = instance.on as ReturnType<typeof vi.fn>
    const clicHandler = onSpy.mock.calls.find(([nom]) => nom === 'click')?.[1] as (p: unknown) => void
    expect(clicHandler).toBeTypeOf('function')

    await clicHandler({ data: { territoire: '22002', type: 'commune', nom: 'Commune D' } })
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('territoire')
    expect(router.currentRoute.value.params).toMatchObject({ type: 'commune', id: '22002' })
    // #409 : le lien inverse préserve la lentille — le thème de la lecture voyage.
    expect(router.currentRoute.value.query).toMatchObject({ theme: 'demographie' })

    wrapper.unmount()
  })

  it('does not navigate on a click of the current point (no territoire on it)', async () => {
    const initMock = vi.mocked(echarts.init)
    initMock.mockClear()

    const wrapper = monter([pointA1, pointD])
    await vi.waitFor(() => expect(initMock).toHaveBeenCalled())

    const instance = instanceRendue()
    const onSpy = instance.on as ReturnType<typeof vi.fn>
    const clicHandler = onSpy.mock.calls.find(([nom]) => nom === 'click')?.[1] as (p: unknown) => void

    await clicHandler({ data: { nom: 'Commune A1' } }) // no territoire/type → the current dot
    expect(router.currentRoute.value.name).not.toBe('territoire')

    wrapper.unmount()
  })

  it('loads ECharts lazily: init runs only once the async import resolves (#51)', async () => {
    const initMock = vi.mocked(echarts.init)
    initMock.mockClear()

    const wrapper = monter()
    expect(initMock).not.toHaveBeenCalled()

    await vi.waitFor(() => expect(initMock).toHaveBeenCalled())
    wrapper.unmount()
  })
})
