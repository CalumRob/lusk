import { expect, it } from 'vitest'
import { capturePdfFixture } from './helpers/cahierPdfFixtures'

// Superseded by the frozen-asset assertions in cahier-pdf-native-contract.spec.ts.
it('fixture map items carry frozen raster bytes', () => {
  const capture = capturePdfFixture('reseaux')
  expect(capture.capabilities.maps.items.every((item) => item.bytes instanceof ArrayBuffer)).toBe(true)
})
