/**
 * Replacement assertions for the retired painter-geometry specs. Each check
 * exercises the same behaviour through the shared native path or the pure
 * production helpers the composer uses (no second painter).
 */
import { describe, expect, it } from 'vitest'
import { projeterRequeteExport } from '@/fiche/prototype/cahierExportCapture'
import { construireTableauxPdf } from '@/fiche/prototype/cahierPdfTableau'
import { enregistrerPolices, mesurePdfProduction } from '@/fiche/prototype/cahierPdfComposer'
import { CAHIER_SHARE_COLOUR } from '@/styles/editorialPageRoles'
import { PALETTE_PDF, couleurPdf } from '@/fiche/prototype/cahierPdfPalette'
import { capturePdfFixture } from './helpers/cahierPdfFixtures'
import { chargeurPoliceTest } from './helpers/cahierPdfRuntime'
import { composerCahierPdf } from '@/fiche/prototype/cahierPdfComposer'

function requete(capture: ReturnType<typeof capturePdfFixture>, modes?: readonly string[]) {
  const offered = capture.capabilities.selectableSeries.map((serie) => serie.id)
  const projection = projeterRequeteExport(capture, modes ?? offered.slice(0, 3))
  if (projection.status !== 'ready') throw new Error(projection.reason)
  return projection.request
}

async function generer(capture: ReturnType<typeof capturePdfFixture>, modes?: readonly string[]) {
  const result = await composerCahierPdf(requete(capture, modes), { signal: new AbortController().signal })
  return new Uint8Array(await result.blob.arrayBuffer())
}

describe('Cahier PDF natif — contrats remplacés', () => {

  it('exerce le vrai point d’entrée de production (import paresseux, annulation, code)', async () => {
    const production = await import('../fiche/prototype/cahierPdfComposer')
    const capture: any = structuredClone(capturePdfFixture('aedar-car-overview'))
    capture.capabilities.maps.items[0].loaded = false
    capture.capabilities.maps.status = 'unavailable'
    await expect(production.composerCahierPdf(requete(capture), { signal: new AbortController().signal }))
      .rejects.toMatchObject({ name: 'CahierPdfCompositionError', code: 'asset' })
    const controller = new AbortController()
    controller.abort()
    await expect(production.composerCahierPdf(requete(capturePdfFixture('aedar-access'), ['car']),
      { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(typeof production.creerGenerateurCahierPdf).toBe('function')
  })



  it('mappe chaque raison native vers un code et un message français', async () => {
    const { codeErreurNativePdf, messageErreurNativePdf } = await import('@/fiche/prototype/cahierNativePdf')
    const cases: Array<[string, string]> = [
      ['map-unavailable', 'asset'],
      ['asset-unfrozen', 'asset'],
      ['unsupported-native-modes', 'incomplete-capture'],
      ['unbreakable-native-figure', 'layout'],
      ['missing-rendered-section', 'serialization'],
    ]
    for (const [reason, code] of cases) {
      expect(codeErreurNativePdf(reason)).toBe(code)
      expect(messageErreurNativePdf(reason)).toMatch(/[éèàç\w]/)
      expect(messageErreurNativePdf(reason)).not.toBe(reason)
    }
  })

  it('refuse une carte déclarée non chargée avec une erreur typée', async () => {
    const capture: any = structuredClone(capturePdfFixture('aedar-car-overview'))
    capture.capabilities.maps.items[0].loaded = false
    capture.capabilities.maps.status = 'unavailable'
    await expect(generer(capture)).rejects.toMatchObject({ code: 'asset' })
  })

  it('respecte une annulation avant la génération', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(composerCahierPdf(
      requete(capturePdfFixture('aedar-access'), ['car']),
      { signal: controller.signal },
    )).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('transmet les modes sélectionnés aux sections non-access', async () => {
    const profile: any = structuredClone(capturePdfFixture('aedar-equipment-profile'))
    profile.aedar.modes = ['transit', 'bike_lts2']
    profile.nativeSelection.modes = ['transit', 'bike_lts2']
    const projection = projeterRequeteExport(profile)
    if (projection.status !== 'ready') throw new Error(projection.reason)
    expect(projection.request.modeIds).toEqual(['transit', 'bike_lts2'])
    expect(projection.request.capture.nativeSelection?.modes).toEqual(['transit', 'bike_lts2'])
  })

  it('refuse une police tronquée au lieu de la substituer', async () => {
    const { jsPDF } = await import('jspdf')
    const doc = new jsPDF({ unit: 'pt' })
    const invalid = new TextEncoder().encode('not a TrueType font').buffer
    await expect(enregistrerPolices(doc, async () => invalid,
      new AbortController().signal)).rejects.toThrow(/Police PDF invalide/)
  })

  it('rejette une colonne réellement corrompue dans le tableau', async () => {
    const capture: any = capturePdfFixture('aedar-access')
    const request = requete(capture, ['car'])
    const { mesure } = await mesurePdfProduction({ chargerPolice: chargeurPoliceTest })
    const projections = (await import('@/fiche/prototype/cahierExportAdapters')).projeterRequeteExportFigures(request)
    const table = projections.flatMap((projection: any) => projection.tables)[0]
    const corrupt = {
      ...table,
      rows: table.rows.map((row: any) => ({ ...row,
        cells: row.cells.map((cell: any, index: number) => index === 1
          ? { ...cell, display: 'X'.repeat(500) } : cell) })),
    }
    expect(() => construireTableauxPdf(corrupt, { mesure, largeurDisponible: 400,
      nomTerritoire: 'Commune A1', ownerDisplayed: true })).toThrow(/ne tient pas|dépasse|largeur/)
  })

  it('utilise la face de corps pour le mobilier de pied, pas la face mono', async () => {
    const { ROLE_PDF } = await import('@/fiche/prototype/cahierPdfGrammaire')
    const { POLICE_PDF, POLICES_PDF } = await import('@/fiche/prototype/cahierPdfFonts')
    expect(ROLE_PDF.pied.police).toBe(POLICE_PDF.body)
    expect(ROLE_PDF.pied.police).not.toBe(POLICE_PDF.metaMedium)
    expect(POLICES_PDF.some((face) => face.id === POLICE_PDF.body)).toBe(true)
  })

  it('lit la couleur du propriétaire de partage, pas une copie', () => {
    expect(couleurPdf(CAHIER_SHARE_COLOUR.fond)).toBe(PALETTE_PDF.shareTrackGround)
    expect(couleurPdf(CAHIER_SHARE_COLOUR.filet)).toBe(PALETTE_PDF.shareTrackBorder)
  })

})
