import { expect, it } from 'vitest'
import { capturePdfFixture } from './helpers/cahierPdfFixtures'

// Superseded by the mode assertion in cahier-pdf-native-contract.spec.ts;
// kept as a harmless fixture smoke check while cleanup is scoped to the
// reviewed list of known leftovers.
it('fixture exposes selectable series', () => {
  const capture = capturePdfFixture('aedar-access')
  expect(capture.capabilities.selectableSeries.length).toBeGreaterThan(0)
})
