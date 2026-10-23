import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { CAHIER_FIGURE_GEOMETRY } from '@/fiche/cahierFigureGrammaire'
import type { CahierFigureGeometry } from '@/fiche/cahierFigureGrammaire'
import CahierFigureAxes from '@/fiche/prototype/CahierFigureAxes.vue'

describe('Cahier figure axes geometry', () => {
  it('moves the SVG y-axis and tick coordinates when measured geometry changes', async () => {
    const baseGeometry = CAHIER_FIGURE_GEOMETRY
    const measuredGeometry: CahierFigureGeometry = {
      ...baseGeometry,
      margin: { ...baseGeometry.margin, left: 156 },
    }
    const wrapper = mount(CahierFigureAxes, {
      props: {
        geometry: baseGeometry,
        xTicks: [],
        yTicks: [{ key: 'one', label: '1 234', position: 120 }],
      },
    })

    const [xAxis, yAxis] = wrapper.findAll('.cahier-figure-axis')
    expect(yAxis?.attributes('x1')).toBe('88')
    expect(wrapper.find('.cahier-figure-tick').attributes()).toMatchObject({ x1: '81', x2: '88' })

    await wrapper.setProps({ geometry: measuredGeometry })

    expect(yAxis?.attributes('x1')).toBe('156')
    expect(yAxis?.attributes('x2')).toBe('156')
    expect(wrapper.find('.cahier-figure-tick').attributes()).toMatchObject({ x1: '149', x2: '156' })
    expect(xAxis?.attributes('x1')).toBe('156')
  })
})
