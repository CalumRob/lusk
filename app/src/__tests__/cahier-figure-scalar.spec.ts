import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import CahierFigureScalar from '@/fiche/prototype/CahierFigureScalar.vue'
import { Footprints } from 'lucide-vue-next'

describe('CahierFigureScalar', () => {
  it('keeps the value, optional mode icon, label, and comparison in one reading seam', () => {
    const wrapper = mount(CahierFigureScalar, {
      props: {
        value: '31',
        label: 'À pied + TC',
        icon: Footprints,
        tone: 't',
        colorValue: true,
        showLabel: false,
        ariaLabel: 'À pied + TC : 31 types',
      },
      slots: { reference: 'Groupe comparé : 20' },
    })

    expect(wrapper.attributes('role')).toBe('img')
    expect(wrapper.attributes('aria-label')).toBe('À pied + TC : 31 types')
    expect(wrapper.classes()).toContain('cahier-figure-scalar--colored')
    expect(wrapper.classes()).toContain('cahier-figure-scalar--t')
    expect(wrapper.find('.cahier-figure-scalar-value').text()).toContain('31')
    expect(wrapper.find('.cahier-figure-scalar-icon').exists()).toBe(true)
    expect(wrapper.find('.cahier-figure-scalar-label').exists()).toBe(false)
    expect(wrapper.find('.cahier-figure-scalar-reference').text()).toContain('Groupe comparé : 20')
  })

  it('keeps the same value and comparison typography in an inline brick', () => {
    const wrapper = mount(CahierFigureScalar, {
      props: {
        value: '30,8',
        label: 'À pied + TC',
        layout: 'inline',
        colorValue: true,
        ariaLabel: 'À pied + TC : 30,8 types',
      },
      slots: { reference: 'Groupe comparé : 30,8' },
    })

    expect(wrapper.classes()).toContain('cahier-figure-scalar--inline')
    expect(wrapper.find('.cahier-figure-scalar-value').classes()).toContain('cahier-figure-scalar-value')
    expect(wrapper.find('.cahier-figure-scalar-reference').exists()).toBe(true)
  })
})
