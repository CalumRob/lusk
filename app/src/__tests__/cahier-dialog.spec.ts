import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

import CahierDialog from '@/fiche/prototype/CahierDialog.vue'

const previousBodyOverflow = document.body.style.overflow
const previousRootOverflow = document.documentElement.style.overflow

afterEach(() => {
  document.body.style.overflow = previousBodyOverflow
  document.documentElement.style.overflow = previousRootOverflow
})

describe('CahierDialog scroll lock', () => {
  it('locks background scroll without making the document root a sticky scroll container', async () => {
    const wrapper = mount(CahierDialog, {
      props: { open: false, title: 'Détail', labelledBy: 'dialog-title' },
    })
    await wrapper.setProps({ open: true })
    await nextTick()

    expect(document.body.style.overflow).toBe(previousBodyOverflow)
    expect(document.documentElement.style.overflow).toBe('clip')

    wrapper.unmount()
    expect(document.body.style.overflow).toBe(previousBodyOverflow)
    expect(document.documentElement.style.overflow).toBe(previousRootOverflow)
  })

  it('ferme en un seul événement sur Escape ou sur le fond modal', async () => {
    const wrapper = mount(CahierDialog, {
      props: { open: true, title: 'Détail', labelledBy: 'dialog-title' },
    })
    await nextTick()
    await wrapper.get('dialog').trigger('cancel')
    expect(wrapper.emitted('close')).toHaveLength(1)
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await nextTick()
    await wrapper.get('dialog').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(2)
    wrapper.unmount()
  })
})
