import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

import CahierPdfAction from '@/fiche/prototype/CahierPdfAction.vue'
import type { CahierPdfGenerator } from '@/fiche/prototype/cahierPdfExportController'
import { capturePdfFixture, withAedarModes } from './helpers/cahierPdfFixtures'

const actionStyles = readFileSync(
  join(process.cwd(), 'src', 'fiche', 'prototype', 'CahierPdfAction.vue'),
  'utf-8',
)

const originalCreateObjectUrl = (URL as unknown as { createObjectURL?: unknown }).createObjectURL
const originalRevokeObjectUrl = (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL

let clickedAnchor: HTMLAnchorElement | null = null
let createObjectURL: ReturnType<typeof vi.fn>
let revokeObjectURL: ReturnType<typeof vi.fn>
let clickSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  clickedAnchor = null
  createObjectURL = vi.fn(() => 'blob:pdf-action')
  revokeObjectURL = vi.fn()
  Object.assign(URL, { createObjectURL, revokeObjectURL })
  clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clickedAnchor = this
  })
})

afterEach(() => {
  clickSpy.mockRestore()
  if (originalCreateObjectUrl === undefined) delete (URL as unknown as Record<string, unknown>).createObjectURL
  else Object.assign(URL, { createObjectURL: originalCreateObjectUrl })
  if (originalRevokeObjectUrl === undefined) delete (URL as unknown as Record<string, unknown>).revokeObjectURL
  else Object.assign(URL, { revokeObjectURL: originalRevokeObjectUrl })
})

function artefact(fileName = 'section.pdf') {
  return { blob: new Blob(['%PDF-1.7'], { type: 'application/pdf' }), fileName }
}

function mountAction(options: {
  capture?: ReturnType<typeof capturePdfFixture>
  generator?: CahierPdfGenerator | null
  sectionKey?: string
  sectionLabel?: string
} = {}) {
  const capture = options.capture ?? capturePdfFixture('aedar-equipment-profile')
  return mount(CahierPdfAction, {
    props: {
      sectionKey: options.sectionKey ?? capture.identity.sectionKey,
      sectionLabel: options.sectionLabel ?? capture.identity.sectionLabel,
      capture: () => capture,
      generator: options.generator === undefined
        ? vi.fn<CahierPdfGenerator>().mockResolvedValue(artefact())
        : options.generator,
    },
    attachTo: document.body,
  })
}

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = actionStyles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  return match?.[1] ?? ''
}

describe('shared PDF section action (#1023)', () => {
  it('renders one borderless PDF action with a download icon and focus treatment', () => {
    const wrapper = mountAction()
    const button = wrapper.get('.cahier-pdf-action__button')
    expect(button.text()).toBe('PDF')
    expect(button.attributes('type')).toBe('button')
    expect(button.find('svg').exists()).toBe(true)
    expect(rule('.cahier-pdf-action__button')).toContain('border: 0;')
    expect(rule('.cahier-pdf-action__button:focus-visible')).toContain('outline: 2px solid')
    expect(rule('.cahier-pdf-action__button')).toContain('min-height: 36px')
    wrapper.unmount()
  })

  it('keeps the label and an accessible touch target on mobile with reduced motion', () => {
    expect(actionStyles).toContain('@media (max-width: 760px)')
    expect(actionStyles).toContain('min-height: 44px')
    expect(actionStyles).toContain('@media (prefers-reduced-motion: reduce)')
    expect(actionStyles).toContain('animation: none')
    const wrapper = mountAction()
    expect(wrapper.get('.cahier-pdf-action__button').text()).toContain('PDF')
    wrapper.unmount()
  })

  it('prepares, announces and only succeeds after real bytes reach the browser download', async () => {
    const generate = vi.fn<CahierPdfGenerator>().mockResolvedValue(artefact('cahier.pdf'))
    const wrapper = mountAction({ generator: generate })
    const button = wrapper.get('.cahier-pdf-action__button')

    await button.trigger('click')
    expect(button.text()).toBe('Préparation…')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('aria-busy')).toBe('true')
    expect(button.attributes('aria-live')).toBe('polite')
    expect(button.attributes('aria-atomic')).toBe('true')
    expect(clickSpy).not.toHaveBeenCalled()

    await flushPromises()
    expect(wrapper.get('.cahier-pdf-action__button').text()).toBe('PDF généré')
    expect(clickedAnchor?.download).toBe('cahier.pdf')
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledOnce()
    expect(wrapper.element.querySelectorAll(':scope > p')).toHaveLength(0)
    wrapper.unmount()
  })

  it('shows Retry in the button and retries the same failed request', async () => {
    const generate = vi.fn<CahierPdfGenerator>()
      .mockRejectedValueOnce(new Error('échec'))
      .mockResolvedValueOnce(artefact())
    const capture = capturePdfFixture('aedar-access', {
      aedar: withAedarModes(['car', 'transit', 'bike_lts2']),
    })
    const wrapper = mountAction({ capture, generator: generate })

    await wrapper.get('.cahier-pdf-action__button').trigger('click')
    await flushPromises()
    expect(wrapper.get('.cahier-pdf-action__button').text()).toBe('Réessayer')
    const failedRequest = generate.mock.calls[0]![0]

    await wrapper.get('.cahier-pdf-action__button').trigger('click')
    expect(wrapper.get('.cahier-pdf-action__button').text()).toBe('Préparation…')
    await flushPromises()
    expect(generate.mock.calls[1]![0]).toBe(failedRequest)
    expect(wrapper.get('.cahier-pdf-action__button').text()).toBe('PDF généré')
    wrapper.unmount()
  })

  it('opens the approved PDF-only chooser with the exact copy and focus', async () => {
    const capture = capturePdfFixture('aedar-access', {
      aedar: withAedarModes(['car', 'transit', 'bike_lts2', 'walk']),
    })
    const generate = vi.fn<CahierPdfGenerator>().mockResolvedValue(artefact())
    const wrapper = mountAction({ capture, generator: generate })
    const trigger = wrapper.get('.cahier-pdf-action__button')
    await trigger.trigger('click')
    await nextTick()
    await nextTick()

    const dialog = wrapper.get('dialog')
    expect(dialog.text()).toContain('Exporter en PDF')
    expect(dialog.text()).toContain('Choisissez jusqu’à trois modes pour garder les tableaux lisibles.')
    expect(dialog.text()).toContain('Modes à inclure')
    expect(dialog.text()).not.toContain('Équipement')
    expect(dialog.text()).not.toContain('Couverture du territoire')
    expect(wrapper.findAll('.cahier-pdf-dialog__modes input[type="checkbox"]')).toHaveLength(5)
    expect(wrapper.get('[data-pdf-confirm]').attributes('disabled')).toBeDefined()
    expect(document.activeElement).toBe(wrapper.findAll('input[type="checkbox"]')[0]!.element)

    const boxes = wrapper.findAll('input[type="checkbox"]')
    await boxes[0]!.setValue(true)
    await boxes[1]!.setValue(true)
    await boxes[2]!.setValue(true)
    expect(wrapper.get('.cahier-pdf-dialog__count').text()).toContain('3 / 3')
    expect(wrapper.get('[data-pdf-confirm]').attributes('disabled')).toBeUndefined()

    await wrapper.get('[data-pdf-confirm]').trigger('click')
    await flushPromises()
    expect(generate).toHaveBeenCalledOnce()
    expect(generate.mock.calls[0]![0].modeIds).toEqual(['car', 'bike_lts2', 'bike_lts4'])
    expect(wrapper.get('.cahier-pdf-action__button').text()).toBe('PDF généré')
    expect(dialog.attributes('open')).toBeUndefined()
    wrapper.unmount()
  })

  it('disables confirmation at zero and above three choices without dropping any', async () => {
    const capture = capturePdfFixture('aedar-access', {
      aedar: withAedarModes(['car', 'transit', 'bike_lts2', 'walk']),
    })
    const generate = vi.fn<CahierPdfGenerator>().mockResolvedValue(artefact())
    const wrapper = mountAction({ capture, generator: generate })
    await wrapper.get('.cahier-pdf-action__button').trigger('click')
    await nextTick()
    await nextTick()

    const boxes = wrapper.findAll('input[type="checkbox"]')
    expect(wrapper.get('[data-pdf-confirm]').attributes('disabled')).toBeDefined()
    for (const index of [0, 1, 2, 3]) await boxes[index]!.setValue(true)
    expect(wrapper.findAll('input[type="checkbox"]:checked')).toHaveLength(4)
    expect(wrapper.get('.cahier-pdf-dialog__count').text()).toContain('4 / 3')
    expect(wrapper.get('[data-pdf-confirm]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-pdf-confirm]').trigger('click')
    expect(generate).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('cancels on Annuler or Escape with no output and restores focus to the trigger', async () => {
    const capture = capturePdfFixture('aedar-access', {
      aedar: withAedarModes(['car', 'transit', 'bike_lts2', 'walk']),
    })
    const generate = vi.fn<CahierPdfGenerator>().mockResolvedValue(artefact())
    const wrapper = mountAction({ capture, generator: generate })
    const trigger = wrapper.get('.cahier-pdf-action__button')

    await trigger.trigger('click')
    await nextTick()
    await nextTick()
    await wrapper.findAll('.cahier-pdf-dialog__actions button')[0]!.trigger('click')
    await nextTick()
    expect(generate).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(trigger.element)

    await trigger.trigger('click')
    await nextTick()
    await nextTick()
    await wrapper.get('dialog').trigger('cancel')
    await nextTick()
    expect(generate).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(trigger.element)
    expect(wrapper.get('.cahier-pdf-action__button').text()).toBe('PDF')
    wrapper.unmount()
  })

  it('is inert and explains itself when the real generator is not wired yet', () => {
    const wrapper = mountAction({ generator: null })
    const button = wrapper.get('.cahier-pdf-action__button')
    expect(button.text()).toBe('PDF')
    expect(button.attributes('disabled')).toBeDefined()
    expect(wrapper.get('.cahier-pdf-action__reason').text()).toContain('génération du PDF')
    expect(button.attributes('aria-describedby')).toBe(wrapper.get('.cahier-pdf-action__reason').attributes('id'))
    wrapper.unmount()
  })

  it('is disabled while required data is still pending and re-enables after the owner settles', async () => {
    const ready = ref(false)
    const pending = capturePdfFixture('aedar-equipment-profile', {
      readiness: { status: 'pending', reason: 'chapter-pending', availability: 'incomplete' },
    })
    const settled = capturePdfFixture('aedar-equipment-profile')
    const wrapper = mount(CahierPdfAction, {
      props: {
        sectionKey: 'aedar-equipment-profile',
        sectionLabel: 'Profil',
        capture: () => (ready.value ? settled : pending),
        generator: vi.fn<CahierPdfGenerator>().mockResolvedValue(artefact()),
      },
      attachTo: document.body,
    })
    await nextTick()
    expect(wrapper.get('.cahier-pdf-action__button').attributes('disabled')).toBeDefined()

    ready.value = true
    await nextTick()
    expect(wrapper.get('.cahier-pdf-action__button').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('does not download a late result after unmount', async () => {
    let resolve!: (value: ReturnType<typeof artefact>) => void
    const generate = vi.fn<CahierPdfGenerator>().mockReturnValue(new Promise((yes) => { resolve = yes }))
    const wrapper = mountAction({ generator: generate })
    await wrapper.get('.cahier-pdf-action__button').trigger('click')
    await Promise.resolve()
    wrapper.unmount()
    resolve(artefact())
    await flushPromises()
    expect(clickSpy).not.toHaveBeenCalled()
  })
})
