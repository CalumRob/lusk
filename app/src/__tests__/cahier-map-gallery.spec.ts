import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const capturedOptions = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }))

vi.mock('viewerjs', () => ({
  default: class {
    constructor(_element: HTMLElement, options: Record<string, unknown>) {
      capturedOptions.value = options
    }

    destroy = vi.fn()
    update = vi.fn()
    view = vi.fn()
  },
}))

import CahierMapGallery from '@/fiche/prototype/CahierMapGallery.vue'

describe('CahierMapGallery', () => {
  afterEach(() => {
    capturedOptions.value = null
  })

  it('caps map zoom at 120% of the source image size', () => {
    const wrapper = mount(CahierMapGallery, {
      props: {
        images: [{ key: 'walk', src: '/walk-inspection.webp', alt: 'Carte à pied' }],
      },
    })

    expect(capturedOptions.value?.maxZoomRatio).toBe(1.2)

    wrapper.unmount()
  })
})
