/**
 * Replacement assertions for the retired painter-geometry specs. Each check
 * exercises the same behaviour through the shared native path or the pure
 * production helpers the composer uses (no second painter).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import { projeterRequeteExport } from '@/fiche/prototype/cahierExportCapture'
import { construireTableauxPdf } from '@/fiche/prototype/cahierPdfTableau'
import { enregistrerPolices, mesurePdfProduction } from '@/fiche/prototype/cahierPdfComposer'
import { CAHIER_SHARE_COLOUR } from '@/styles/editorialPageRoles'
import { POLICE_PDF } from '@/fiche/prototype/cahierPdfFonts'
import { PALETTE_PDF, couleurPdf } from '@/fiche/prototype/cahierPdfPalette'
import { capturePdfFixture } from './helpers/cahierPdfFixtures'
import { chargeurPoliceTest } from './helpers/cahierPdfRuntime'
import { composerCahierPdf, composerDocumentAvecCorpsNatif } from '@/fiche/prototype/cahierPdfComposer'
import { CAHIER_EXPORT_PUBLIC_URL } from '@/fiche/prototype/cahierExportUrls'
import { lirePdf } from './helpers/cahierPdfRuntime'

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

  it('conserve les accents et les glyphes embarqués', async () => {
    const { doc } = await mesurePdfProduction({ chargerPolice: chargeurPoliceTest })
    doc.setFont(POLICE_PDF.displayStrong, 'normal')
    doc.setFontSize(20)
    doc.text('DIVERSITÉ DE L’OFFRE', 10, 20)
    doc.text('COMMUNE A1', 10, 30)
    const lecture = await lirePdf(doc.output('blob'))
    expect(lecture.texteComplet).toContain('COMMUNE A1')
    expect(lecture.texteComplet).toContain('DIVERSITÉ DE L’OFFRE')
    expect(lecture.texteComplet).not.toMatch(/\ufffd/)
  })

  it('an export from a non-production host still links the owned canonical public host', async () => {
    expect(CAHIER_EXPORT_PUBLIC_URL).toBe('https://lusk.calumrobertson.fr/')
    const artifact = await composerDocumentAvecCorpsNatif(
      requete(capturePdfFixture('aedar-car-overview')),
      { signal: new AbortController().signal, chargerPolice: chargeurPoliceTest },
      [],
    )
    const lecture = await lirePdf(artifact.blob)
    expect(lecture.texteComplet).toContain('lusk.calumrobertson.fr')
    expect(lecture.liens.some((lien) => lien.includes('lusk.calumrobertson.fr'))).toBe(true)
    expect(lecture.liens.some((lien) => /lusk\.test|lusk-pdf-native|preview/.test(lien))).toBe(false)

    const source = readFileSync(resolve(process.cwd(), 'src/fiche/prototype/cahierExportUrls.ts'), 'utf8')
    const code = source.split('\n').filter((line) => !/^\s*(\*|\/\*)/.test(line)).join('\n')
    expect(code).not.toMatch(/\blocation\b|\.origin\b/)
  })

})
