import { describe, expect, it } from 'vitest'

import {
  evaluerDisponibiliteExportPdf,
} from '@/fiche/prototype/cahierPdfExport'
import type { CahierExportPublication } from '@/fiche/prototype/cahierExportCapture'
import {
  PDF_FIXTURE_SECTION_KEYS,
  capturePdfFixture,
  displayedLayer,
  loadedMaps,
  mapAvailability,
  readyPublications,
} from './helpers/cahierPdfFixtures'
import { cahierExportFixture } from './helpers/cahierExportFixtures'

function blockReason(capture: ReturnType<typeof capturePdfFixture>): string {
  const activation = evaluerDisponibiliteExportPdf(capture)
  if (activation.ready) throw new Error('Expected the export to be blocked')
  return activation.reason
}

describe('shared PDF activation policy — wait for completeness (#1023)', () => {
  it('allows the nine settled native sections to export', () => {
    for (const key of PDF_FIXTURE_SECTION_KEYS) {
      const activation = evaluerDisponibiliteExportPdf(capturePdfFixture(key))
      expect(activation, key).toEqual({ ready: true })
    }
  })

  it('blocks a pending, failed or absent section body', () => {
    expect(blockReason(capturePdfFixture('aedar-equipment-profile', {
      readiness: { status: 'pending', reason: 'chapter-pending', availability: 'incomplete' },
    }))).toBe('section-pending')
    expect(blockReason(capturePdfFixture('aedar-equipment-profile', {
      readiness: { status: 'error', reason: 'chapter-error', availability: 'incomplete' },
    }))).toBe('section-error')
    expect(blockReason(capturePdfFixture('aedar-equipment-profile', {
      readiness: { status: 'unavailable', reason: 'evidence-absent', availability: 'absent' },
    }))).toBe('section-unavailable')
  })

  it('exports a settled section whose source contract explicitly has no data', () => {
    const capture = capturePdfFixture('aedar-equipment-profile', {
      readiness: { status: 'ready', reason: 'evidence-incomplete', availability: 'incomplete' },
    })
    expect(evaluerDisponibiliteExportPdf(capture)).toEqual({ ready: true })
  })

  it('blocks maps that are unobserved, pending, partially loaded or failed when required', () => {
    expect(blockReason(capturePdfFixture('reseaux', {
      publications: [displayedLayer('mobilite-comparison-bars', 'bars')],
    }))).toBe('map-unknown')
    expect(blockReason(capturePdfFixture('reseaux', {
      publications: [
        mapAvailability([
          { id: 'walkTransit', label: 'À pied', declared: true, loaded: false, unavailable: false, inlineUrl: 'https://example.test/map-inline.webp' },
          { id: 'bike', label: 'Vélo', declared: true, loaded: false, unavailable: false, inlineUrl: 'https://example.test/map-inline.webp' },
          { id: 'car', label: 'Voiture', declared: true, loaded: false, unavailable: false, inlineUrl: 'https://example.test/map-inline.webp' },
        ], 'none'),
        displayedLayer('mobilite-comparison-bars', 'bars'),
      ],
    }))).toBe('map-pending')
    expect(blockReason(capturePdfFixture('reseaux', {
      publications: [
        mapAvailability([
          { id: 'walkTransit', label: 'À pied', declared: true, loaded: true, unavailable: false, inlineUrl: 'https://example.test/map-inline.webp' },
          { id: 'bike', label: 'Vélo', declared: true, loaded: false, unavailable: false, inlineUrl: 'https://example.test/map-inline.webp' },
          { id: 'car', label: 'Voiture', declared: true, loaded: false, unavailable: false, inlineUrl: 'https://example.test/map-inline.webp' },
        ], 'none'),
        displayedLayer('mobilite-comparison-bars', 'bars'),
      ],
    }))).toBe('map-pending')
    expect(blockReason(capturePdfFixture('reseaux', {
      publications: [
        mapAvailability([
          { id: 'walkTransit', label: 'À pied', declared: true, loaded: true, unavailable: false, inlineUrl: 'https://example.test/map-inline.webp' },
          { id: 'bike', label: 'Vélo', declared: true, loaded: false, unavailable: true, inlineUrl: 'https://example.test/map-inline.webp' },
          { id: 'car', label: 'Voiture', declared: true, loaded: true, unavailable: false, inlineUrl: 'https://example.test/map-inline.webp' },
        ], 'none'),
        displayedLayer('mobilite-comparison-bars', 'bars'),
      ],
    }))).toBe('map-partial')
    expect(blockReason(capturePdfFixture('reseaux', {
      publications: [
        mapAvailability([
          { id: 'walkTransit', label: 'À pied', declared: true, loaded: false, unavailable: true, inlineUrl: 'https://example.test/map-inline.webp' },
          { id: 'bike', label: 'Vélo', declared: true, loaded: false, unavailable: true, inlineUrl: 'https://example.test/map-inline.webp' },
          { id: 'car', label: 'Voiture', declared: true, loaded: false, unavailable: true, inlineUrl: 'https://example.test/map-inline.webp' },
        ], 'none'),
        displayedLayer('mobilite-comparison-bars', 'bars'),
      ],
    }))).toBe('map-unavailable')
  })

  it('allows a map the source contract does not declare, without inventing a loaded one', () => {
    const capture = capturePdfFixture('aedar-car-overview', {
      publications: [
        mapAvailability([{ id: 'car', label: 'Voiture', declared: false, loaded: false, unavailable: true, inlineUrl: null }], 'none'),
        displayedLayer('aedar-comparison-layer'),
      ],
    })
    expect(evaluerDisponibiliteExportPdf(capture)).toEqual({ ready: true })
  })

  it('blocks a required legend that is loading or unavailable', () => {
    const maps = loadedMaps(['walk', 'transit', 'bike_lts2', 'bike_lts4'])
    expect(blockReason(capturePdfFixture('aedar-diversity-loss', {
      publications: [mapAvailability(maps, 'pending')],
    }))).toBe('legend-pending')
    expect(blockReason(capturePdfFixture('aedar-diversity-loss', {
      publications: [mapAvailability(maps, 'unavailable')],
    }))).toBe('legend-unavailable')
  })

  it('does not wait for a comparison the reader explicitly hid or emptied', () => {
    expect(evaluerDisponibiliteExportPdf(capturePdfFixture('aedar-access', {
      comparisonStatus: 'loading',
      publications: [displayedLayer('aedar-comparison-layer', 'comparison', {
        toggle: false, displayed: false,
      })],
    }))).toEqual({ ready: true })
    expect(evaluerDisponibiliteExportPdf(capturePdfFixture('reseaux', {
      selection: { etat: 'vide' },
      comparisonStatus: 'unavailable',
      publications: readyPublications('reseaux'),
    }))).toEqual({ ready: true })
    expect(evaluerDisponibiliteExportPdf(capturePdfFixture('couverture-du-territoire', {
      comparisonEligible: false,
      comparisonStatus: 'error',
      publications: readyPublications('couverture-du-territoire'),
    }))).toEqual({ ready: true })
  })

  it('does not wait for a reference hidden by the selected series', () => {
    expect(evaluerDisponibiliteExportPdf(capturePdfFixture('aedar-access', {
      referenceStatus: 'loading',
      publications: [displayedLayer('aedar-comparison-layer', 'comparison', {
        referenceAvailable: true,
        visibleReferenceAvailable: false,
        displayed: false,
      })],
    }))).toEqual({ ready: true })
  })

  it('exports a legitimate no-served-reference state only when its owner observed it', () => {
    const legitimateAbsence = capturePdfFixture('aedar-access', {
      referenceStatus: 'ready',
      publications: [displayedLayer('aedar-comparison-layer', 'comparison', {
        referenceAvailable: false,
        visibleReferenceAvailable: false,
        displayed: false,
      })],
    })
    expect(evaluerDisponibiliteExportPdf(legitimateAbsence)).toEqual({ ready: true })

    const unobservedReference = capturePdfFixture('aedar-access', {
      referenceStatus: 'unobserved',
      publications: [displayedLayer('aedar-comparison-layer', 'comparison', {
        referenceAvailable: false,
        visibleReferenceAvailable: false,
        displayed: false,
      })],
    })
    expect(blockReason(unobservedReference)).toBe('reference-unobserved')
  })

  it('never reclassifies a requested reference read failure as legitimate absence', () => {
    for (const status of ['loading', 'error', 'unavailable'] as const) {
      const capture = capturePdfFixture('aedar-access', {
        referenceStatus: status,
        publications: [displayedLayer('aedar-comparison-layer', 'comparison', {
          referenceAvailable: false,
          visibleReferenceAvailable: false,
          displayed: false,
        })],
      })
      expect(blockReason(capture)).toBe(`reference-${status}`)
    }
  })

  it('does not wait for a reference failure when the reader hid the comparison', () => {
    expect(evaluerDisponibiliteExportPdf(capturePdfFixture('aedar-access', {
      referenceStatus: 'error',
      publications: [displayedLayer('aedar-comparison-layer', 'comparison', {
        toggle: false, referenceAvailable: false, visibleReferenceAvailable: false, displayed: false,
      })],
    }))).toEqual({ ready: true })
  })

  it('blocks a capable comparison whose owner has not observed its presentation yet', () => {
    expect(blockReason(capturePdfFixture('aedar-access', {
      publications: [],
    }))).toBe('comparison-unobserved')
  })

  it('blocks a requested relevant comparison that is loading, failed or unavailable', () => {
    for (const status of ['loading', 'error', 'unavailable'] as const) {
      const capture = capturePdfFixture('reseaux', {
        comparisonStatus: status,
        publications: [
          mapAvailability(loadedMaps(['walkTransit', 'bike', 'car']), 'none'),
          displayedLayer('mobilite-comparison-bars', 'bars', {
            referenceAvailable: false, visibleReferenceAvailable: false, displayed: false,
          }),
        ],
      })
      expect(blockReason(capture)).toBe(`comparison-${status}`)
    }
  })

  it('blocks an unresolved requested selection instead of presenting it as absence', () => {
    const fixture = cahierExportFixture()
    expect(blockReason(capturePdfFixture('aedar-access', {
      control: { ...fixture.control, presetDefaut: null, selection: { etat: 'defaut' } },
      publications: [displayedLayer('aedar-comparison-layer')],
    }))).toBe('comparison-unresolved-selection')
  })

  it('blocks a declared focal publication failure, but not an explicit empty comparison', () => {
    expect(blockReason(capturePdfFixture('couverture-du-territoire', {
      evidencePatch: { unavailableResources: ['Offre de transports en commun'] },
      publications: readyPublications('couverture-du-territoire'),
    }))).toBe('resource-unavailable')

    expect(blockReason(capturePdfFixture('visiter-la-bretagne', {
      evidencePatch: { unavailableComparisons: ['Raccordement GTFS'] },
      publications: [
        displayedLayer('mobilite-raccordement-curve', 'curve', {
          referenceAvailable: false, visibleReferenceAvailable: false, displayed: false,
        }),
        { slot: '', state: {
          owner: 'mobilite-section',
          state: {
            comparisonStatus: 'ready', comparisonError: null,
            comparisonNone: false,
            ratioReferenceAvailable: false, ratioReferenceDisplayed: false,
          },
        } },
      ],
    }))).toBe('comparison-resource-unavailable')

    expect(evaluerDisponibiliteExportPdf(capturePdfFixture('visiter-la-bretagne', {
      selection: { etat: 'vide' },
      evidencePatch: { unavailableComparisons: ['Raccordement GTFS'] },
      publications: readyPublications('visiter-la-bretagne'),
    }))).toEqual({ ready: true })
  })

  it('blocks an equipment detail still being acquired or failed', () => {
    const equipment = (detailStatus: 'loading' | 'error'): CahierExportPublication => ({
      slot: 'equipment',
      state: {
        owner: 'aedar-equipment-explorer',
        state: {
          typequ: 'B207', typequLabel: 'Équipement test', selectedDetail: null,
          detailStatus, comparisonStatus: 'ready', comparisonError: null,
          comparison: null, referenceDetail: null,
        },
      },
    })
    for (const status of ['loading', 'error'] as const) {
      expect(blockReason(capturePdfFixture('aedar-equipment-explorer', {
        publications: [equipment(status), displayedLayer('aedar-comparison-layer')],
      }))).toBe(`equipment-${status}`)
    }
  })

  it('keeps the overview action pending while its displayed comparison is still loading', () => {
    const publications = readyPublications('aedar-car-overview')
    // The group label is already displayed from the direct reference, but the
    // aggregate read the overview ranks consume is still in flight (#1023 C).
    expect(blockReason(capturePdfFixture('aedar-car-overview', {
      comparisonStatus: 'loading', publications,
    }))).toBe('comparison-loading')
    // Settled to ready: the action enables and the served ranks can be captured.
    expect(evaluerDisponibiliteExportPdf(capturePdfFixture('aedar-car-overview', {
      comparisonStatus: 'ready', publications,
    }))).toEqual({ ready: true })
  })

  it('blocks a pending source clock while allowing explicit unavailable scalar cells', () => {
    expect(blockReason(capturePdfFixture('aedar-car-overview', {
      evidencePatch: { sourcePending: true },
      publications: readyPublications('aedar-car-overview'),
    }))).toBe('source-pending')

    expect(evaluerDisponibiliteExportPdf(capturePdfFixture('aedar-car-overview', {
      publications: readyPublications('aedar-car-overview'),
    }))).toEqual({ ready: true })
  })
})
