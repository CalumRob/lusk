/**
 * Replacement assertions for the retired painter-geometry specs. Each check
 * exercises the same behaviour through the shared native path or the pure
 * production helpers the composer uses (no second painter).
 */
import { describe, expect, it } from 'vitest'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { projeterRequeteExport } from '@/fiche/prototype/cahierExportCapture'
import { construireTableauxPdf } from '@/fiche/prototype/cahierPdfTableau'
import { enregistrerPolices, mesurePdfProduction } from '@/fiche/prototype/cahierPdfComposer'
import { CAHIER_SHARE_COLOUR } from '@/fiche/prototype/cahierColorRoles'
import { PALETTE_PDF, couleurPdf } from '@/fiche/prototype/cahierPdfPalette'
import { capturePdfFixture } from './helpers/cahierPdfFixtures'
import { chargeurPoliceTest } from './helpers/cahierPdfRuntime'
import { composerCahierPdfNativedansNavigateur } from './helpers/cahierPdfNativeRuntime'

function requete(capture: ReturnType<typeof capturePdfFixture>, modes?: readonly string[]) {
  const offered = capture.capabilities.selectableSeries.map((serie) => serie.id)
  const projection = projeterRequeteExport(capture, modes ?? offered.slice(0, 3))
  if (projection.status !== 'ready') throw new Error(projection.reason)
  return projection.request
}

async function generer(capture: ReturnType<typeof capturePdfFixture>, modes?: readonly string[]) {
  const result = await composerCahierPdfNativedansNavigateur(requete(capture, modes), { signal: new AbortController().signal })
  return new Uint8Array(await result.blob.arrayBuffer())
}

async function textOf(bytes: Uint8Array) {
  const pdf = await getDocument({ data: Uint8Array.from(bytes) }).promise
  const page = await pdf.getPage(1)
  return ((await page.getTextContent()).items as any[]).map((item) => item.str ?? '').join(' ')
}

describe('Cahier PDF natif — contrats remplacés', () => {
  it('conserve les accents et les glyphes embarqués', async () => {
    const text = await textOf(await generer(capturePdfFixture('aedar-access')))
    expect(text).toContain('COMMUNE A1')
    expect(text).toContain('DIVERSITÉ DE L’OFFRE')
    expect(text).not.toMatch(/\ufffd/)
  })

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

  it('paints the dense waffle as many small native tiles, without CTA or fixture host', async () => {
    const { captureProfilRangsDense } = await import('./helpers/cahierPdfFixtures')
    const dense: any = captureProfilRangsDense()
    dense.nativeRender.content.units[0].sections[0].evidence.facts = dense.figures
      .find((figure: any) => figure.family === 'aedar-equipment-profile').model.facts
    const projection = projeterRequeteExport(dense, [])
    if (projection.status !== 'ready') throw new Error(projection.reason)
    const result = await composerCahierPdfNativedansNavigateur(projection.request, {
      signal: new AbortController().signal, urlAccueil: 'https://lusk.test/',
    })
    const bytes = new Uint8Array(await result.blob.arrayBuffer())
    const { cheminsPdf } = await import('./helpers/cahierPdfRuntime')
    const pdf = await getDocument({ data: Uint8Array.from(bytes) }).promise
    const paths = await cheminsPdf(bytes, pdf.numPages)
    const tiles = paths.filter((chemin: any) => chemin.kind === 'fill'
      && chemin.width > 20 && chemin.width < 100 && chemin.height > 20 && chemin.height < 100)
    expect(tiles.length, 'native waffle tiles').toBeGreaterThanOrEqual(30)
    const text = await textOf(bytes)
    expect(text).not.toContain('Parcourir les équipements')
    expect(text).not.toContain('lusk-pdf-native.test')
    expect(text).toContain('sur lusk.test')
  })

  it('gèle l’équipement et l’horizon sélectionnés dans la capture', async () => {
    const { captureExplorerRangs } = await import('./helpers/cahierPdfFixtures')
    const capture: any = structuredClone(captureExplorerRangs())
    capture.nativeSelection.typequ = 'T001'
    capture.nativeSelection.horizonMinutes = 30
    const projection = projeterRequeteExport(capture)
    if (projection.status !== 'ready') throw new Error(projection.reason)
    expect(projection.request.capture.nativeSelection).toMatchObject({ typequ: 'T001', horizonMinutes: 30 })
    const text = await textOf(await generer(capture))
    const defaultText = await textOf(await generer(structuredClone(captureExplorerRangs())))
    expect(text).toContain('TEMPS DE TRAJET')
    // The frozen non-default selection changes the rendered figure, not just
    // the capture object.
    expect(text).not.toBe(defaultText)
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
    await expect(composerCahierPdfNativedansNavigateur(
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

  it('an export from a non-production host still links the owned canonical public host', async () => {
    const { CAHIER_EXPORT_PUBLIC_URL } = await import('../fiche/prototype/cahierExportUrls')
    const { lirePdf } = await import('./helpers/cahierPdfRuntime')
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    expect(CAHIER_EXPORT_PUBLIC_URL).toBe('https://lusk.calumrobertson.fr/')
    // No urlAccueil/urlPublique override: the production default applies even
    // though the generating process runs on a preview/test host.
    const lecture = await lirePdf((await composerCahierPdfNativedansNavigateur(
      requete(capturePdfFixture('aedar-car-overview')),
      { signal: new AbortController().signal },
    )).blob)
    expect(lecture.texteComplet).toContain('lusk.calumrobertson.fr')
    expect(lecture.liens.some((lien) => lien.includes('lusk.calumrobertson.fr'))).toBe(true)
    expect(lecture.liens.some((lien) => /lusk\.test|lusk-pdf-native|preview/.test(lien))).toBe(false)
    // The URL owner must never read the runtime host.
    const source = readFileSync(resolve(process.cwd(), 'src/fiche/prototype/cahierExportUrls.ts'), 'utf8')
    const code = source.split('\n').filter((line) => !/^\s*(\*|\/\*)/.test(line)).join('\n')
    expect(code).not.toMatch(/\blocation\b|\.origin\b/)
  })
}, 180000)
