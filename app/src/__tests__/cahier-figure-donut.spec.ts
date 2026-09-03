import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import CahierDonut from '@/fiche/prototype/CahierDonut.vue'

const donutSource = readFileSync(
  join(process.cwd(), 'src', 'fiche', 'prototype', 'CahierDonut.vue'),
  'utf8',
)
const figureCss = readFileSync(
  join(process.cwd(), 'src', 'fiche', 'prototype', 'cahierFigure.css'),
  'utf8',
)

describe('Cahier donut primitive', () => {
  it('renders three independent mode rings without an inaccessible remainder', () => {
    expect(donutSource).toContain('v-for="ring in props.rings"')
    expect(donutSource).toContain('value === null')
    expect(donutSource).not.toContain('concentric-donut-ring--unavailable')
    expect(donutSource).toContain('--cahier-profile-inaccessible')
    expect(donutSource).toContain('function ringPath')
    expect(donutSource).toContain('A ${radius} ${radius}')
    expect(donutSource).not.toContain('stroke-dasharray')
    expect(donutSource).toContain('stroke-linecap="butt"')
    expect(donutSource).toContain('scale?: number')
    expect(donutSource).toContain('inaccessible?: boolean')
    expect(donutSource).toContain('concentric-donut-ring--inaccessible')
    expect(donutSource).not.toContain('from -90deg')
    expect(donutSource).toContain('car: 18')
    expect(donutSource).toContain('bike: 27')
    expect(donutSource).toContain('walkTransit: 36')
    expect(donutSource).toContain('const RING_STROKE_WIDTH = 6')
  })

  it('maps values continuously from noon back to noon', () => {
    const wrapper = mount(CahierDonut, {
      props: {
        labelAccessible: 'Donut test',
        rings: [
          { mode: 'car', value: 0.25, color: 'red' },
          { mode: 'bike', value: 0.5, color: 'blue' },
          { mode: 'walkTransit', value: 0.75, color: 'green' },
        ],
      },
    })
    const paths = wrapper.findAll('.concentric-donut-ring')

    expect(paths[0]!.attributes('d')).toBe('M 50 32 A 18 18 0 0 1 68 50')
    expect(paths[1]!.attributes('d')).toBe('M 50 23 A 27 27 0 0 1 50 77')
    expect(paths[2]!.attributes('d')).toBe('M 50 14 A 36 36 0 1 1 14 50')

    const fullWrapper = mount(CahierDonut, {
      props: {
        labelAccessible: 'Full donut test',
        rings: [{ mode: 'car', value: 1, color: 'black' }],
      },
    })
    expect(fullWrapper.find('.concentric-donut-ring').attributes('d')).toBe(
      'M 50 32 A 18 18 0 1 1 50 68 A 18 18 0 1 1 50 32',
    )
  })

  it('keeps popover tooltips wide enough to escape a narrow donut column', () => {
    const popoverRule = figureCss.match(
      /\.cahier-figure-tooltip--popover\s*\{([\s\S]*?)\n\}/,
    )?.[1]

    expect(popoverRule).toContain('100vw')
  })
})
