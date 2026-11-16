import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { CONTROLE_COMPARAISON_KEY } from '@/fiche/comparisonContext'
import type { ControleComparaison } from '@/fiche/comparisonContext'
import { cahierPaginationFor } from '@/fiche/prototype/cahierPagination'
import { captureCahierSection } from '@/fiche/prototype/cahierExportCapture'
import type { CahierPdfGenerator } from '@/fiche/prototype/cahierPdfExportController'
import VarianteCahierLibre from '@/fiche/prototype/VarianteCahierLibre.vue'
import type { Payload } from '@/payload/types'
import { territoiresFixture } from '@/payload/fixtures'
import { routes } from '@/router'
import { cahierExportFixture } from './helpers/cahierExportFixtures'

const shellSource = readFileSync(
  join(process.cwd(), 'src', 'fiche', 'prototype', 'VarianteCahierLibre.vue'),
  'utf-8',
)

const originalCreateObjectUrl = (URL as unknown as { createObjectURL?: unknown }).createObjectURL
const originalRevokeObjectUrl = (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL
let clickedAnchor: HTMLAnchorElement | null = null
let clickSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  clickedAnchor = null
  Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:pdf-shell'),
    revokeObjectURL: vi.fn(),
  })
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

function artefact(fileName = 'cahier.pdf') {
  return { blob: new Blob(['%PDF-1.7'], { type: 'application/pdf' }), fileName }
}

function control(): ControleComparaison {
  return {
    focal: territoiresFixture[0]!,
    territoires: territoiresFixture,
    selection: { etat: 'defaut' },
    libelleActif: null,
    presetDefaut: 'epci',
    presets: [],
    choisir: () => {},
  }
}

async function mountShell(generator: CahierPdfGenerator | null = null) {
  const { content } = cahierExportFixture()
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/')
  const wrapper = mount(VarianteCahierLibre, {
    props: {
      content,
      pagination: cahierPaginationFor({} as Payload, content, true),
      showAllUnits: true,
      presentation: 'plain',
      layoutVariant: 'indexed-sections',
      aedarAccessEnabled: true,
      aedarChapterActive: false,
      aedarStatus: 'ready',
      comparisonStatus: 'ready',
      nativeComparisonStatus: 'ready',
      aedarReferenceStatus: 'ready',
      pdfGenerator: generator,
    },
    global: {
      plugins: [router],
      provide: { [CONTROLE_COMPARAISON_KEY as symbol]: ref(control()) },
    },
  })
  await flushPromises()
  await nextTick()
  return { wrapper, content }
}

function toggleMode(
  wrapper: Awaited<ReturnType<typeof mountShell>>['wrapper'],
  label: string,
) {
  const button = wrapper.findAll('[data-section="aedar-access"] .aedar-access-mode-selector .cahier-figure-legend-toggle')
    .find((candidate) => candidate.text().includes(label))
  if (!button) throw new Error(`Mode toggle ${label} missing`)
  return button.trigger('click')
}

describe('shared PDF action on the mounted Cahier shell (#1023)', () => {
  it('mounts one action inside each of the nine common section headings', async () => {
    const { wrapper, content } = await mountShell()
    const actions = wrapper.findAll('.cahier-pdf-action')
    expect(actions).toHaveLength(9)
    for (const section of content.units.flatMap((unit) => unit.sections)) {
      const action = wrapper.get(`[data-section="${section.key}"] .concept-group-heading .cahier-pdf-action`)
      expect(action.exists()).toBe(true)
      expect(action.get('.cahier-pdf-action__button').text()).toBe('PDF')
    }
    expect(wrapper.findAll('[data-section] > section .cahier-pdf-action')).toHaveLength(0)
    wrapper.unmount()
  })

  it('does not copy the action into an AEDAR composition or the Mobilite delegate', () => {
    const files = [
      'CahierAedarOverviewSection.vue',
      'CahierAedarDiversityLossSection.vue',
      'CahierAedarAccessSection.vue',
      'CahierAedarProfileSection.vue',
      'CahierAedarExplorerSection.vue',
      'CahierMobiliteSection.vue',
    ]
    for (const file of files) {
      const source = readFileSync(join(process.cwd(), 'src', 'fiche', 'prototype', file), 'utf-8')
      expect(source, file).not.toContain('CahierPdfAction')
      expect(source, file).not.toContain('pdfGenerator')
    }
  })

  it('keeps every section inert until the real generator is wired', async () => {
    const { wrapper } = await mountShell(null)
    for (const button of wrapper.findAll('.cahier-pdf-action__button')) {
      expect(button.attributes('disabled')).toBeDefined()
    }
    expect(wrapper.findAll('.cahier-pdf-action__reason')).toHaveLength(9)
    wrapper.unmount()
  })

  it('prepares a non-mode section directly through the same common controller', async () => {
    const generate = vi.fn<CahierPdfGenerator>().mockResolvedValue(artefact())
    const { wrapper } = await mountShell(generate)

    const action = wrapper.get('[data-section="aedar-equipment-profile"] .cahier-pdf-action__button')
    await action.trigger('click')
    await flushPromises()

    expect(generate).toHaveBeenCalledOnce()
    const request = generate.mock.calls[0]![0]
    expect(request.capture.identity.sectionKey).toBe('aedar-equipment-profile')
    expect(request.modeIds).toEqual([])
    expect(
      wrapper.get('[data-section="aedar-equipment-profile"] .cahier-pdf-action__button').text(),
    ).toBe('PDF généré')
    expect(clickedAnchor?.download).toBe('cahier.pdf')
    wrapper.unmount()
  })

  it('prepares a mode section directly when its three active modes are already selectable', async () => {
    const generate = vi.fn<CahierPdfGenerator>().mockResolvedValue(artefact())
    const { wrapper } = await mountShell(generate)

    const seam = wrapper.vm as unknown as {
      captureSection: (key: string) => ReturnType<typeof captureCahierSection> | null
    }
    const selected = seam.captureSection('aedar-access')!.capabilities.selectedSeries
    expect(selected).toHaveLength(3)

    await wrapper.get('[data-section="aedar-access"] .cahier-pdf-action__button').trigger('click')
    await flushPromises()

    expect(generate).toHaveBeenCalledOnce()
    expect(generate.mock.calls[0]![0].modeIds).toEqual(selected)
    expect(wrapper.find('dialog[open]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('opens the PDF-only chooser above three active modes and leaves the screen selection intact', async () => {
    const generate = vi.fn<CahierPdfGenerator>().mockResolvedValue(artefact())
    const { wrapper } = await mountShell(generate)
    const seam = wrapper.vm as unknown as {
      captureSection: (key: string) => ReturnType<typeof captureCahierSection> | null
    }

    await toggleMode(wrapper, 'À pied')
    await flushPromises()
    const before = seam.captureSection('aedar-access')!
    expect(before.capabilities.selectedSeries).toHaveLength(4)

    await wrapper.get('[data-section="aedar-access"] .cahier-pdf-action__button').trigger('click')
    await nextTick()
    await nextTick()
    const dialog = wrapper.get('dialog[open]')
    expect(dialog.text()).toContain('Exporter en PDF')
    expect(dialog.text()).toContain('Choisissez jusqu’à trois modes pour garder les tableaux lisibles.')
    expect(dialog.text()).toContain('Modes à inclure')
    expect(dialog.get('[data-pdf-confirm]').attributes('disabled')).toBeDefined()

    const boxes = dialog.findAll('.cahier-pdf-dialog__modes input[type="checkbox"]')
    await boxes[0]!.setValue(true)
    await boxes[1]!.setValue(true)
    await boxes[2]!.setValue(true)
    await dialog.get('[data-pdf-confirm]').trigger('click')
    await flushPromises()

    expect(generate).toHaveBeenCalledOnce()
    const request = generate.mock.calls[0]![0]
    expect(request.capture.identity.sectionKey).toBe('aedar-access')
    expect(request.modeIds).toEqual(['car', 'bike_lts2', 'bike_lts4'])
    expect(seam.captureSection('aedar-access')!.capabilities.selectedSeries).toEqual(
      before.capabilities.selectedSeries,
    )
    expect(
      wrapper.get('[data-section="aedar-access"] .cahier-pdf-action__button').text(),
    ).toBe('PDF généré')
    wrapper.unmount()
  })

  it('places the action at the heading edge, vertically centered, with a mobile label target', () => {
    expect(shellSource).toContain('.concept-group-pdf-action')
    expect(shellSource).toMatch(/\.concept-group-heading\s*\{[^}]*grid-template-columns:/s)
    expect(shellSource).toMatch(/\.concept-group-heading\s*\{[^}]*align-items:\s*center;/s)
    expect(shellSource).toMatch(/\.concept-group-pdf-action\s*\{[^}]*grid-column:\s*3;/s)
    expect(shellSource).toMatch(/\.concept-group-pdf-action\s*\{[^}]*justify-self:\s*end;/s)
    expect(shellSource).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.concept-group-pdf-action\s*\{[^}]*grid-column:\s*2;/s)
  })
})
