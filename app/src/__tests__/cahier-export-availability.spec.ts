/**
 * The cheap availability read behind each mounted Cahier PDF action (#1165).
 *
 * The button re-evaluates on every reactive change; it must keep tracking the
 * owner observations that gate activation without paying for the frozen
 * generation capture on that path.
 */
import { mount } from '@vue/test-utils'
import { effect, nextTick, reactive, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import CahierPdfAction from '@/fiche/prototype/CahierPdfAction.vue'
import type { CahierExportAvailability } from '@/fiche/prototype/cahierPdfExport'
import {
  identitePorteeDeCapture,
  type CahierPdfGenerator,
} from '@/fiche/prototype/cahierPdfExportController'

import type { ContentEvidence } from '@/fiche/content/themeContent'
import type { CahierSectionCaptureInput } from '@/fiche/prototype/cahierExportCapture'
import {
  captureCahierSection,
  captureCahierSectionAvailability,
} from '@/fiche/prototype/cahierExportCapture'
import type { CahierPdfActivation } from '@/fiche/prototype/cahierPdfExport'
import { evaluerDisponibiliteExportPdf } from '@/fiche/prototype/cahierPdfExport'
import {
  PDF_FIXTURE_SECTION_KEYS,
  READY_AEDAR,
  READY_READINESS,
  capturePdfFixture,
  readyPublications,
  type PdfFixtureSectionKey,
} from './helpers/cahierPdfFixtures'
import { cahierExportFixture, sectionOf } from './helpers/cahierExportFixtures'

function inputFor(key: PdfFixtureSectionKey): CahierSectionCaptureInput {
  const fixture = cahierExportFixture()
  const section = sectionOf(fixture.content, key)
  const ownerUnit = fixture.content.units.find((unit) => unit.sections.some((candidate) => candidate.key === key))!
  return {
    section,
    unit: { key: ownerUnit.key, label: ownerUnit.label },
    territory: fixture.content.territory,
    readiness: READY_READINESS,
    referenceStatus: 'ready',
    comparisonEligible: true,
    comparisonStatus: 'ready',
    comparisonError: null,
    control: fixture.control,
    aedar: READY_AEDAR,
    publications: readyPublications(key),
  }
}

describe('availability capture for the Cahier PDF action (#1165)', () => {
  it.each(PDF_FIXTURE_SECTION_KEYS)('decides the same activation as the frozen capture for %s', (key) => {
    const input = inputFor(key)
    expect(evaluerDisponibiliteExportPdf(captureCahierSectionAvailability(input)))
      .toEqual(evaluerDisponibiliteExportPdf(captureCahierSection(input)))
  })

  it('returns only the fields read by the activation policy', () => {
    const availability = captureCahierSectionAvailability(inputFor('visiter-la-bretagne'))
    expect(Object.keys(availability).sort()).toEqual(['capabilities', 'comparison', 'figures', 'readiness'])
  })

  it('does not clone the evidence or build a native render for the availability read', () => {
    const input = inputFor('visiter-la-bretagne')
    const availability = captureCahierSectionAvailability(input)
    expect(Object.prototype.hasOwnProperty.call(availability, 'nativeRender')).toBe(false)
    // The curve model is passed through by reference: only generation needs the
    // independent frozen copy, whose points and sources are never read here.
    const model = availability.figures[0]!.model as { points: unknown }
    expect(model.points).toBe((input.section.evidence as { points: unknown }).points)
  })

  it('tracks nested owner state that gates activation after the cheap read', () => {
    const fixture = cahierExportFixture()
    const section = sectionOf(fixture.content, 'couverture-du-territoire')
    const evidence = reactive({
      ...(section.evidence as ContentEvidence & { unavailableResources?: string[] }),
      unavailableResources: [] as string[],
    })
    const input: CahierSectionCaptureInput = {
      ...inputFor('couverture-du-territoire'),
      section: { ...section, evidence } as unknown as typeof section,
    }
    const seen: CahierPdfActivation[] = []
    const stop = effect(() => {
      seen.push(evaluerDisponibiliteExportPdf(captureCahierSectionAvailability(input)))
    })
    expect(seen.at(-1)).toEqual({ ready: true })

    evidence.unavailableResources.push('ressource-indisponible')
    expect(seen.at(-1)).toMatchObject({ ready: false, reason: 'resource-unavailable' })
    stop()
  })

  it('tracks reactive owner changes through the action availability source, but generates from the frozen capture', async () => {
    const settled = ref(false)
    const full = capturePdfFixture('aedar-equipment-profile')
    const pending = capturePdfFixture('aedar-equipment-profile', {
      readiness: { status: 'pending', reason: 'chapter-pending', availability: 'incomplete' },
    })
    const availability = vi.fn((): CahierExportAvailability => settled.value ? full : pending)
    const generate = vi.fn<CahierPdfGenerator>().mockResolvedValue({
      blob: new Blob(['%PDF-1.7']), fileName: 'section.pdf',
    })
    const fullCapture = vi.fn(() => full)
    const wrapper = mount(CahierPdfAction, {
      props: {
        sectionKey: full.identity.sectionKey,
        sectionLabel: full.identity.sectionLabel,
        identite: identitePorteeDeCapture(full),
        capture: fullCapture,
        availability,
        generator: generate,
      },
      attachTo: document.body,
    })
    await nextTick()
    await nextTick()
    await nextTick()
    expect(availability).toHaveBeenCalled()
    expect(fullCapture).not.toHaveBeenCalled()
    expect(wrapper.get('.cahier-pdf-action__button').attributes('aria-disabled')).toBe('true')

    settled.value = true
    await nextTick()
    expect(wrapper.get('.cahier-pdf-action__button').attributes('aria-disabled')).toBeUndefined()

    await wrapper.get('.cahier-pdf-action__button').trigger('click')
    expect(generate).toHaveBeenCalledOnce()
    expect(generate.mock.calls[0]![0].capture).toBe(full)
    wrapper.unmount()
  })
})
