import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import BuildingPeerSelector from '@/fiche/prototype/BuildingPeerSelector.vue'

const territories = [
  { type: 'commune' as const, id: '22001', name: 'Allineuc' },
  { type: 'epci' as const, id: 'E1', name: 'Groupe du centre' },
]

describe('building peer selection', () => {
  it('selects only the territories explicitly added, even when the focal territory is available', async () => {
    const wrapper = mount(BuildingPeerSelector, {
      props: { territories, catalogStatus: 'ready', comparisonStatus: 'idle', selected: null },
    })
    expect(wrapper.find('.building-peers__chosen').exists()).toBe(false)
    await wrapper.get('input').setValue('Groupe')
    await wrapper.get('.building-peers__results button').trigger('click')
    await wrapper.findAll('.building-peers__actions button')[0]!.trigger('click')
    expect(wrapper.emitted('select')?.[0]).toEqual([[territories[1]]])
  })

  it('exposes failure and recovery without discarding the explicit group', async () => {
    const wrapper = mount(BuildingPeerSelector, {
      props: { territories, catalogStatus: 'ready', comparisonStatus: 'error', selected: [territories[0]!] },
    })
    expect(wrapper.get('[role="alert"]').text()).toContain('Réessayez')
    expect(wrapper.get('.building-peers__chosen').text()).toContain('Allineuc')
    await wrapper.findAll('.building-peers__actions button')[0]!.trigger('click')
    expect(wrapper.emitted('select')?.[0]).toEqual([[territories[0]]])
    await wrapper.findAll('.building-peers__actions button')[1]!.trigger('click')
    expect(wrapper.emitted('clear')).toHaveLength(1)
  })
})
