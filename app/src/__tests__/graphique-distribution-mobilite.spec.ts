import { flushPromises, mount } from '@vue/test-utils'

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import * as echarts from 'echarts/core'

import GraphiqueDistributionMobilite from '../components/fiche/GraphiqueDistributionMobilite.vue'
import type { DistributionMobilite } from '../fiche/sousGroupes'
import type { PointNuageMobilite } from '../payload/selectors'
import { routes } from '../router'

/**
 * GraphiqueDistributionMobilite — the Mobilité story chart (#142, ADR-0012).
 * Ce que ce spec verrouille (#409) : le nuage est cliquable et son clic ouvre
 * la fiche du pair en PRÉSERVANT la lentille — ?theme=mobilite voyage dans
 * l'URL (le même contrat que les deux autres nuages de lecture). Le canvas
 * ECharts est stubbé globalement (setup.ts) ; on déclenche le handler 'click'.
 */

const distribution: DistributionMobilite = {
  dec: [20, 25, 30, 35, 38, 39, 40, 44, 46, 47],
  dens: [0.006, 0.015, 0.032, 0.058, 0.099, 0.092, 0.044, 0.032, 0.046, 0.041],
  min: 20,
  max: 47,
}

const pointA1: PointNuageMobilite = {
  territoire: '22001',
  type: 'commune',
  nom: 'Commune A1',
  divLoss: 38,
}
const pointD: PointNuageMobilite = {
  territoire: '22002',
  type: 'commune',
  nom: 'Commune D',
  divLoss: 24,
}

let router: Router

function instanceRendue() {
  const initMock = vi.mocked(echarts.init)
  return initMock.mock.results[0]?.value
}

function monter(nuage: PointNuageMobilite[] = []) {
  return mount(GraphiqueDistributionMobilite, {
    props: {
      distribution,
      mediane: 38,
      medianeVelo: 38,
      modes: { t: 'à pied ou en transports en commun', b: 'à vélo' },
      nom: 'Commune A1',
      nuage,
    },
    global: { plugins: [router] },
  })
}

describe('GraphiqueDistributionMobilite — le clic du nuage préserve la lentille (#409)', () => {
  beforeEach(() => {
    router = createRouter({ history: createMemoryHistory(), routes })
  })

  it('ouvre la fiche du pair cliqué avec ?theme=mobilite', async () => {
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
    expect(router.currentRoute.value.query).toMatchObject({ theme: 'mobilite' })

    wrapper.unmount()
  })

  it('ne navigue pas sur le clic du point courant (sans territoire sur lui)', async () => {
    const initMock = vi.mocked(echarts.init)
    initMock.mockClear()

    const wrapper = monter([pointA1, pointD])
    await vi.waitFor(() => expect(initMock).toHaveBeenCalled())

    const instance = instanceRendue()
    const onSpy = instance.on as ReturnType<typeof vi.fn>
    const clicHandler = onSpy.mock.calls.find(([nom]) => nom === 'click')?.[1] as (p: unknown) => void

    await clicHandler({ data: { nom: 'Commune A1' } })
    expect(router.currentRoute.value.name).not.toBe('territoire')

    wrapper.unmount()
  })

  it('décrit la figure accessiblement — la médiane des deux modes et le contexte', () => {
    const wrapper = monter([pointD])

    const zone = wrapper.find('[role="img"]')
    expect(zone.attributes('aria-label')).toContain('Commune A1')
    expect(zone.attributes('aria-label')).toContain('Contexte')
    expect(zone.attributes('aria-label')).toContain('Commune D')

    wrapper.unmount()
  })
})
