import { flushPromises, mount } from '@vue/test-utils'

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import * as echarts from 'echarts/core'

import GraphiqueQuadrantMilieux from '../components/fiche/GraphiqueQuadrantMilieux.vue'
import {
  apercuAvecNAFixture,
  histoiresMilieuxFixture,
  indicateursMilieuxFixture,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import { nuageMilieux } from '../payload/selectors'
import type { PointNuageMilieux } from '../payload/selectors'
import type { Payload } from '../payload/types'
import { routes } from '../router'

/**
 * GraphiqueQuadrantMilieux — the Milieux story chart (issue #241, ADR-0011 +
 * ADR-0017, amendé #306): the quadrant of the two signed forces — x = le taux
 * annuel de variation de la population (‰/an, le registre Démographie), y =
 * Δ(m²/hab) = artif_m3_par_habitant − artif_m2_par_habitant — axes crossing
 * at 0 (markLine), plus the context cloud (nuageMilieux): the territory's
 * comparison group at the same scale. Every cloud point is hoverable (its
 * name + both values) and CLICKABLE — it opens that point's own fiche. A
 * cross-département peer's hover carries the millésime-span rider (its
 * per-dépt OCS-GE dates). The canvas is ECharts (stubbed globally in
 * setup.ts); the figure's data is ALSO rendered as an accessible description
 * (role=img aria-label) — WCAG 2.2 AA, the reading never depends on canvas
 * alone.
 */

const pointA1: PointNuageMilieux = {
  territoire: '22001',
  type: 'commune',
  nom: 'Commune A1',
  periodeArtif: '2021-2025',
  tauxVariationPopulation: 14.4927536231884,
  deltaM2ParHabitant: 300,
}
const pointD: PointNuageMilieux = {
  territoire: '22002',
  type: 'commune',
  nom: 'Commune D',
  periodeArtif: '2021-2025',
  tauxVariationPopulation: 13.3333333333333,
  deltaM2ParHabitant: -45,
}
const pointTransversal: PointNuageMilieux = {
  territoire: '200000002',
  type: 'epci',
  nom: 'EPCI Y',
  periodeArtif: '2021-2025 (22) · 2021-2024 (29)',
  tauxVariationPopulation: -6.00600600600601,
  deltaM2ParHabitant: -10,
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

function monter(nuage: PointNuageMilieux[] = [], periodeArtif = '2021-2025') {
  return mount(GraphiqueQuadrantMilieux, {
    props: {
      tauxVariationPopulation: 14.4927536231884,
      deltaM2ParHabitant: 300,
      classification: 'grandir-en-setalant',
      nom: 'Commune A1',
      periodePop: '2017-2023',
      periodeArtif,
      nuage,
    },
    global: { plugins: [router] },
  })
}

describe('GraphiqueQuadrantMilieux — the Milieux quadrant story chart', () => {
  beforeEach(() => {
    router = createRouter({ history: createMemoryHistory(), routes })
  })

  it('describes the point accessibly: the two forces and the reading', () => {
    const wrapper = monter()

    const zone = wrapper.find('[role="img"]')
    expect(zone.attributes('aria-label')).toContain('Commune A1')
    expect(zone.attributes('aria-label')).toContain('+14,49')
    expect(zone.attributes('aria-label')).toContain('+300')
    expect(zone.attributes('aria-label')).toContain('grandir-en-setalant')
  })

  it('names the state window in the accessible description — the two-clocks honesty', () => {
    const wrapper = monter()

    const zone = wrapper.find('[role="img"]')
    expect(zone.attributes('aria-label')).toContain('OCS-GE 2021-2025')
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

  it('sits the territory dot among its peers — the two scatter series', async () => {
    const initMock = vi.mocked(echarts.init)
    initMock.mockClear()

    const wrapper = monter([pointA1, pointD])
    await vi.waitFor(() => expect(initMock).toHaveBeenCalled())

    const series = (optionRendue()?.series as Array<Record<string, unknown>>) ?? []
    const nuage = series.find((s) => s.name === 'contexte')
    expect(nuage).toBeTruthy()
    // x = le taux annuel de population (‰/an, #306), y = Δ(m²/hab) — chaque
    // point porte son nom, son code, son type et sa fenêtre OCS-GE (le rider
    // du millésime pour les pairs multi-dépt)
    expect(nuage?.data).toEqual([
      {
        value: [14.4927536231884, 300],
        nom: 'Commune A1',
        territoire: '22001',
        type: 'commune',
        periodeArtif: '2021-2025',
      },
      {
        value: [13.3333333333333, -45],
        nom: 'Commune D',
        territoire: '22002',
        type: 'commune',
        periodeArtif: '2021-2025',
      },
    ])
    const point = series.find((s) => s.name === 'Commune A1')
    expect(point?.data).toEqual([{ value: [14.4927536231884, 300], nom: 'Commune A1' }])

    wrapper.unmount()
  })

  it('names each hovered cloud point in the tooltip formatter — name + both values', async () => {
    const initMock = vi.mocked(echarts.init)
    initMock.mockClear()

    const wrapper = monter([pointA1, pointD])
    await vi.waitFor(() => expect(initMock).toHaveBeenCalled())

    const option = optionRendue()
    const formatter = (option?.tooltip as { formatter?: (p: unknown) => string })
      ?.formatter as ((p: unknown) => string) | undefined
    expect(formatter).toBeTypeOf('function')
    const texte = formatter?.({
      data: { value: [13.3333333333333, -45], nom: 'Commune D', territoire: '22002', type: 'commune' },
    })
    expect(texte).toContain('Commune D')
    expect(texte).toContain('+13,33 ‰/an')
    expect(texte).toContain('-45')

    wrapper.unmount()
  })

  it('carries the millésime-span rider on a cross-département peer’s hover', async () => {
    const initMock = vi.mocked(echarts.init)
    initMock.mockClear()

    const wrapper = monter([pointTransversal])
    await vi.waitFor(() => expect(initMock).toHaveBeenCalled())

    const option = optionRendue()
    const formatter = (option?.tooltip as { formatter?: (p: unknown) => string })
      ?.formatter as ((p: unknown) => string) | undefined
    const texte = formatter?.({
      data: {
        value: [-160, -10],
        nom: 'EPCI Y',
        territoire: '200000002',
        type: 'epci',
        periodeArtif: '2021-2025 (22) · 2021-2024 (29)',
      },
    })
    expect(texte).toContain('EPCI Y')
    expect(texte).toContain('OCS-GE')
    expect(texte).toContain('2021-2025 (22) · 2021-2024 (29)')

    wrapper.unmount()
  })

  it('states the millésime span on the territory’s own hover when it is cross-département', async () => {
    const initMock = vi.mocked(echarts.init)
    initMock.mockClear()

    // la région (53) porte le span multi-dépt — son propre point le nomme
    const wrapper = monter([], '2021-2025 (22) · 2021-2024 (29)')
    await vi.waitFor(() => expect(initMock).toHaveBeenCalled())

    const option = optionRendue()
    const formatter = (option?.tooltip as { formatter?: (p: unknown) => string })
      ?.formatter as ((p: unknown) => string) | undefined
    const texte = formatter?.({ data: { nom: 'Bretagne' } }) // pas de data → le point courant
    expect(texte).toContain('Bretagne')
    expect(texte).toContain('2021-2025 (22) · 2021-2024 (29)')

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
      // #409 : le lien inverse préserve la lentille — le thème du quadrant voyage.
      expect(router.currentRoute.value.query).toMatchObject({ theme: 'milieux' })

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

  it('proves the invariant through the fixture: ratio < 1 plots delta < 0, ratio > 1 plots delta > 0', async () => {
    const initMock = vi.mocked(echarts.init)
    initMock.mockClear()

    // le nuage VRAI du fixture — les communes de l'EPCI X (22001, 22002)
    const payloadMilieux: Payload = {
      territoires: territoiresFixture,
      indicateurs: indicateursMilieuxFixture,
      histoires: histoiresMilieuxFixture,
      apercu: apercuAvecNAFixture,
      runReport: runReportFraisFixture,
      vintages: vintagesFixture,
      programmes: null,
    }
    const nuage = nuageMilieux(payloadMilieux, '22001') ?? []
    expect(nuage).toHaveLength(2)

    const wrapper = monter(nuage)
    await vi.waitFor(() => expect(initMock).toHaveBeenCalled())

    const series = (optionRendue()?.series as Array<Record<string, unknown>>) ?? []
    const contexte = series.find((s) => s.name === 'contexte')!
    const data = contexte.data as Array<{
      value: [number, number]
      territoire: string
    }>

    // 22002 : trajectoire 0.95 < 1 → delta = 855 − 900 = −45 < 0 (densification)
    const d = data.find((p) => p.territoire === '22002')!
    expect(d.value[1]).toBeLessThan(0)
    // 22001 : trajectoire 1.133 > 1 → delta = 2550 − 2250 = +300 > 0 (étalement)
    const a1 = data.find((p) => p.territoire === '22001')!
    expect(a1.value[1]).toBeGreaterThan(0)

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
