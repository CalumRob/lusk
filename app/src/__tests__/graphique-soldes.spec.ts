import { mount } from '@vue/test-utils'

import { describe, expect, it, vi } from 'vitest'

import * as echarts from 'echarts/core'

import GraphiqueSoldes from '../components/fiche/GraphiqueSoldes.vue'

/**
 * GraphiqueSoldes — the Démographie story chart (docs/themes/demographie.md):
 * solde naturel × solde migratoire. The canvas is ECharts (stubbed globally in
 * setup.ts); the figure's data is ALSO rendered as text (role=img aria-label +
 * a legend line) — WCAG 2.2 AA, the reading never depends on canvas alone.
 */

describe('GraphiqueSoldes — the 2×2 story chart', () => {
  it('describes the point accessibly: the two soldes and the reading', () => {
    const wrapper = mount(GraphiqueSoldes, {
      props: {
        soldeNaturel: 70,
        soldeMigratoire: 30,
        classification: 'fertile',
        nom: 'Commune A1',
      },
    })

    const zone = wrapper.find('[role="img"]')
    expect(zone.attributes('aria-label')).toContain('Commune A1')
    expect(zone.attributes('aria-label')).toContain('solde naturel +70')
    expect(zone.attributes('aria-label')).toContain('solde migratoire +30')
    expect(zone.attributes('aria-label')).toContain('fertile')
  })

  it('renders the legend line with the soldes and the lecture', () => {
    const wrapper = mount(GraphiqueSoldes, {
      props: {
        soldeNaturel: 70,
        soldeMigratoire: 30,
        classification: 'fertile',
        nom: 'Commune A1',
      },
    })

    expect(wrapper.find('.graphique-soldes-legende').text()).toContain('Solde naturel : +70')
    expect(wrapper.find('.graphique-soldes-legende').text()).toContain('Solde migratoire : +30')
    expect(wrapper.find('.graphique-soldes-legende').text()).toContain('lecture : fertile')
  })

  it('keeps the minus signs of negative soldes (exodus)', () => {
    const wrapper = mount(GraphiqueSoldes, {
      props: {
        soldeNaturel: -20,
        soldeMigratoire: -380,
        classification: 'exode',
        nom: 'Commune D',
      },
    })

    expect(wrapper.text()).toContain('Solde naturel : -20')
    expect(wrapper.text()).toContain('Solde migratoire : -380')
    expect(wrapper.text()).toContain('lecture : exode')
  })

  it('loads ECharts lazily: init runs only once the async import resolves (#51)', async () => {
    const initMock = vi.mocked(echarts.init)
    initMock.mockClear()

    const wrapper = mount(GraphiqueSoldes, {
      props: {
        soldeNaturel: 70,
        soldeMigratoire: 30,
        classification: 'fertile',
        nom: 'Commune A1',
      },
    })

    // ECharts is code-split (issue #51): nothing initializes while the
    // dynamic import is still pending — the shell never pays for the chart.
    expect(initMock).not.toHaveBeenCalled()

    await vi.waitFor(() => expect(initMock).toHaveBeenCalled())
    wrapper.unmount()
  })
})
