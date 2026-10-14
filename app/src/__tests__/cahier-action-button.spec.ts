import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import CahierActionButton from '@/fiche/prototype/CahierActionButton.vue'

describe('CahierActionButton', () => {
  it('renders its content as a native button and forwards accessibility attributes and clicks', async () => {
    const onClick = vi.fn()
    const wrapper = mount(CahierActionButton, {
      attrs: {
        'aria-label': 'Choisir un autre équipement',
        onClick,
      },
      slots: { default: 'Choisir un autre équipement' },
    })

    const button = wrapper.get('button')
    expect(button.attributes('type')).toBe('button')
    expect(button.attributes('aria-label')).toBe('Choisir un autre équipement')
    expect(button.text()).toBe('Choisir un autre équipement')

    await button.trigger('click')
    expect(onClick).toHaveBeenCalledOnce()
  })
})
