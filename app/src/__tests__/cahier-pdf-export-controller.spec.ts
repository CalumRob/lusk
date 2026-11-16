import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CahierPdfExportController,
  type CahierPdfGenerator,
} from '@/fiche/prototype/cahierPdfExportController'
import { capturePdfFixture, withAedarModes } from './helpers/cahierPdfFixtures'

const originalCreateObjectUrl = (URL as unknown as { createObjectURL?: unknown }).createObjectURL
const originalRevokeObjectUrl = (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL

let clickedAnchor: HTMLAnchorElement | null = null
let createObjectURL: ReturnType<typeof vi.fn>
let revokeObjectURL: ReturnType<typeof vi.fn>
let clickSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  clickedAnchor = null
  createObjectURL = vi.fn(() => 'blob:pdf-test')
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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function controllerFor(
  capture: ReturnType<typeof capturePdfFixture>,
  generator: CahierPdfGenerator | null,
) {
  let calls = 0
  const controller = new CahierPdfExportController({
    capture: () => { calls += 1; return capture },
    generator,
  })
  return { controller, captureCalls: () => calls }
}

describe('shared PDF export controller machine (#1023)', () => {
  it('prepares directly when the section offers no selectable series', async () => {
    const capture = capturePdfFixture('aedar-equipment-profile')
    const generate = vi.fn<CahierPdfGenerator>().mockResolvedValue(artefact())
    const { controller } = controllerFor(capture, generate)

    controller.activer()
    expect(controller.etat.value).toBe('preparing')
    expect(controller.modaleOuverte.value).toBe(false)
    await flushPromises()

    expect(generate).toHaveBeenCalledOnce()
    const request = generate.mock.calls[0]![0]
    expect(request.capture).toBe(capture)
    expect(request.modeIds).toEqual([])
    expect(controller.etat.value).toBe('done')
    expect(clickedAnchor?.download).toBe('section.pdf')
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:pdf-test')
  })

  it.each([1, 3] as const)('prepares directly with the %i modes active on screen', async (count) => {
    const modes = withAedarModes(['car', 'transit', 'bike_lts2'].slice(0, count))
    const capture = capturePdfFixture('aedar-access', { aedar: modes })
    const generate = vi.fn<CahierPdfGenerator>().mockResolvedValue(artefact())
    const { controller } = controllerFor(capture, generate)

    controller.activer()
    await flushPromises()

    expect(controller.modaleOuverte.value).toBe(false)
    expect(generate.mock.calls[0]![0].modeIds).toEqual(modes.modes)
    expect(generate.mock.calls[0]![0].capture.capabilities.selectedSeries).toEqual(modes.modes)
  })

  it('opens the PDF-only chooser above three active modes without changing the screen capture', async () => {
    const modes = withAedarModes(['car', 'transit', 'bike_lts2', 'walk'])
    const capture = capturePdfFixture('aedar-access', { aedar: modes })
    const generate = vi.fn<CahierPdfGenerator>().mockResolvedValue(artefact())
    const { controller } = controllerFor(capture, generate)

    controller.activer()
    expect(controller.modaleOuverte.value).toBe(true)
    expect(controller.modesProposes.value.map((mode) => mode.id)).toEqual([
      'car', 'bike_lts2', 'bike_lts4', 'transit', 'walk',
    ])
    expect(controller.choix.value).toEqual([])
    expect(controller.choixValide.value).toBe(false)
    expect(generate).not.toHaveBeenCalled()

    controller.basculerMode('car', true)
    controller.basculerMode('walk', true)
    controller.basculerMode('transit', true)
    expect(controller.choixValide.value).toBe(true)
    controller.confirmer()
    expect(controller.modaleOuverte.value).toBe(false)
    await flushPromises()

    const request = generate.mock.calls[0]![0]
    expect(request.capture).toBe(capture)
    expect(request.modeIds).toEqual(['car', 'walk', 'transit'])
    expect(capture.capabilities.selectedSeries).toEqual(modes.modes)
  })

  it('requires a choice when no mode is active, and disables zero or four choices', async () => {
    const capture = capturePdfFixture('aedar-access', { aedar: withAedarModes([]) })
    const generate = vi.fn<CahierPdfGenerator>().mockResolvedValue(artefact())
    const { controller } = controllerFor(capture, generate)

    controller.activer()
    expect(controller.modaleOuverte.value).toBe(true)
    expect(controller.choix.value).toEqual([])
    expect(controller.choixValide.value).toBe(false)

    controller.basculerMode('car', true)
    expect(controller.nombreChoix.value).toBe(1)
    expect(controller.choixValide.value).toBe(true)
    controller.basculerMode('car', false)
    expect(controller.choixValide.value).toBe(false)

    for (const mode of ['car', 'transit', 'bike_lts2', 'walk']) controller.basculerMode(mode, true)
    expect(controller.nombreChoix.value).toBe(4)
    expect(controller.choixValide.value).toBe(false)
    controller.confirmer()
    expect(generate).not.toHaveBeenCalled()
    expect(controller.modaleOuverte.value).toBe(true)
  })

  it('cancels the chooser without output and keeps the screen selection untouched', () => {
    const modes = withAedarModes(['car', 'transit', 'bike_lts2', 'walk'])
    const capture = capturePdfFixture('aedar-access', { aedar: modes })
    const generate = vi.fn<CahierPdfGenerator>()
    const { controller } = controllerFor(capture, generate)

    controller.activer()
    controller.basculerMode('car', true)
    controller.annuler()

    expect(controller.modaleOuverte.value).toBe(false)
    expect(controller.etat.value).toBe('idle')
    expect(controller.choix.value).toEqual([])
    expect(generate).not.toHaveBeenCalled()
    expect(capture.capabilities.selectedSeries).toEqual(modes.modes)
  })

  it('reuses the exact failed request on retry even after the screen capture changed', async () => {
    const first = capturePdfFixture('aedar-access', {
      aedar: withAedarModes(['car', 'transit', 'bike_lts2']),
    })
    const second = capturePdfFixture('aedar-access', {
      aedar: withAedarModes(['walk', 'bike_lts4']),
    })
    let current = first
    const generate = vi.fn<CahierPdfGenerator>()
      .mockRejectedValueOnce(new Error('génération impossible'))
      .mockResolvedValueOnce(artefact('retry.pdf'))
    let captures = 0
    const controller = new CahierPdfExportController({
      capture: () => { captures += 1; return current },
      generator: generate,
    })

    controller.activer()
    await flushPromises()
    expect(controller.etat.value).toBe('error')
    const failedRequest = generate.mock.calls[0]![0]
    const callsBeforeRetry = captures

    current = second
    controller.reessayer()
    expect(controller.etat.value).toBe('preparing')
    expect(captures).toBe(callsBeforeRetry)
    await flushPromises()

    expect(generate.mock.calls[1]![0]).toBe(failedRequest)
    expect(generate.mock.calls[1]![0].modeIds).toEqual(['car', 'transit', 'bike_lts2'])
    expect(controller.etat.value).toBe('done')
  })

  it('captures the current screen only when starting a new export after success', async () => {
    let current = capturePdfFixture('aedar-equipment-profile')
    const generate = vi.fn<CahierPdfGenerator>().mockResolvedValue(artefact())
    const controller = new CahierPdfExportController({
      capture: () => current,
      generator: generate,
    })

    controller.activer()
    await flushPromises()
    expect(controller.etat.value).toBe('done')
    const firstRequest = generate.mock.calls[0]![0]

    current = capturePdfFixture('couverture-du-territoire')
    controller.activer()
    await flushPromises()
    expect(controller.etat.value).toBe('done')
    const secondRequest = generate.mock.calls[1]![0]
    expect(secondRequest).not.toBe(firstRequest)
    expect(secondRequest.capture.identity.sectionKey).toBe('couverture-du-territoire')
  })

  it('blocks a double click while preparing', async () => {
    const pending = deferred<ReturnType<typeof artefact>>()
    const generate = vi.fn<CahierPdfGenerator>().mockReturnValue(pending.promise)
    const { controller } = controllerFor(capturePdfFixture('aedar-equipment-profile'), generate)

    controller.activer()
    controller.activer()
    controller.activer()
    await Promise.resolve()
    expect(generate).toHaveBeenCalledOnce()

    pending.resolve(artefact())
    await flushPromises()
    expect(controller.etat.value).toBe('done')
  })

  it('ignores a late completion and revokes nothing late after disposal', async () => {
    const pending = deferred<ReturnType<typeof artefact>>()
    const generate = vi.fn<CahierPdfGenerator>().mockReturnValue(pending.promise)
    const { controller } = controllerFor(capturePdfFixture('aedar-equipment-profile'), generate)

    controller.activer()
    await Promise.resolve()
    const signal = generate.mock.calls[0]![1].signal
    controller.dispose()
    expect(signal.aborted).toBe(true)
    pending.resolve(artefact())
    await flushPromises()

    expect(controller.etat.value).not.toBe('done')
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(clickSpy).not.toHaveBeenCalled()
  })

  it('never reports success for a missing generated artifact', async () => {
    const generate = vi.fn<CahierPdfGenerator>().mockResolvedValue({ fileName: '' } as never)
    const { controller } = controllerFor(capturePdfFixture('aedar-equipment-profile'), generate)

    controller.activer()
    await flushPromises()

    expect(controller.etat.value).toBe('error')
    expect(clickSpy).not.toHaveBeenCalled()
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('keeps an honest generator-unavailable boundary without pretending to download', () => {
    const capture = capturePdfFixture('aedar-equipment-profile')
    const { controller } = controllerFor(capture, null)

    expect(controller.disponibilite.value).toMatchObject({
      ready: false,
      reason: 'generator-unavailable',
    })
    expect(controller.peutActiver.value).toBe(false)
    controller.activer()
    expect(controller.etat.value).toBe('idle')
    expect(clickSpy).not.toHaveBeenCalled()
  })
})
