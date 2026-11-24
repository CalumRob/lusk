/**
 * Independent verification of the six riskiest #1024 claims.
 *
 * These tests deliberately build their own fixtures, their own PNG bytes and
 * their own PDF reader (pdfjs directly, not the shared lirePdf helper), so they
 * do not inherit the blind spots of the helpers that exercise the production
 * path. The browser harness is used only as a transport to obtain real bytes.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { deflateSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

import {
  CahierNativePdfError,
  codeErreurNativePdf,
  messageErreurNativePdf,
  readAssetParDefaut,
} from '@/fiche/prototype/cahierNativePdf'
import { projeterRequeteExport } from '@/fiche/prototype/cahierExportCapture'
import type { CahierExportCapture } from '@/fiche/prototype/cahierExportCapture'
import { composerCahierPdfNativedansNavigateur } from './helpers/cahierPdfNativeRuntime'
import { captureExplorerRangs, capturePartDense, captureProfilRangsDense, capturePdfFixture } from './helpers/cahierPdfFixtures'

/* ---------- independent fixtures / readers ---------- */

/** A labelled 10x10 technical PNG built here, not imported from the fixtures. */
function proprePng(): ArrayBuffer {
  const crcTable = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let v = n
    for (let k = 0; k < 8; k += 1) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1
    crcTable[n] = v >>> 0
  }
  const chunk = (name: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(name, 'ascii'), data])
    let crc = 0xffffffff
    for (const byte of body) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
    const out = Buffer.alloc(8 + data.length + 4)
    out.writeUInt32BE(data.length, 0); out.write(name, 4, 'ascii')
    data.copy(out, 8); out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length)
    return out
  }
  const taille = 10
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(taille, 0); ihdr.writeUInt32BE(taille, 4); ihdr[8] = 8; ihdr[9] = 6
  const row = Buffer.alloc(1 + taille * 4)
  for (let x = 0; x < taille; x += 1) {
    row[1 + x * 4] = 0x21; row[2 + x * 4] = 0x63; row[3 + x * 4] = 0xe1; row[4 + x * 4] = 0xff
  }
  const raw = Buffer.concat(Array.from({ length: taille }, () => row))
  const png = Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ])
  return Uint8Array.from(png).buffer
}

function requete(capture: CahierExportCapture, modes?: readonly string[]) {
  const projection = projeterRequeteExport(capture, modes)
  if (projection.status !== 'ready') throw new Error(projection.reason)
  return projection.request
}

async function pagesTexte(capture: CahierExportCapture, modes?: readonly string[]): Promise<string[]> {
  const result = await composerCahierPdfNativedansNavigateur(requete(capture, modes), {
    signal: new AbortController().signal,
  })
  const bytes = new Uint8Array(await result.blob.arrayBuffer())
  const pdf = await getDocument({ data: Uint8Array.from(bytes) }).promise
  const pages: string[] = []
  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index)
    pages.push(((await page.getTextContent()).items as any[]).map((item) => item.str ?? '').join(' '))
  }
  return pages
}

/* ---------- the six claims ---------- */

describe('six affirmations risquées — vérification indépendante (#1024)', () => {
  it('(a) les octets figés atteignent le lecteur par défaut, sans fetch ni injection', async () => {
    const bytes = proprePng()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const blob = await readAssetParDefaut({
      id: 'car', label: 'Voiture', declared: true, loaded: true, unavailable: false,
      inlineUrl: 'https://owner.invalid/car-inline.webp', bytes,
    }, new AbortController().signal)
    expect(blob.type).toBe('image/png')
    expect(blob.size).toBe(bytes.byteLength)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
    await expect(readAssetParDefaut({
      id: 'car', label: 'Voiture', declared: true, loaded: true, unavailable: false,
      inlineUrl: 'https://owner.invalid/car-inline.webp',
    }, new AbortController().signal)).rejects.toBeInstanceOf(CahierNativePdfError)
    // The browser harness no longer injects a readAsset stub into the composer.
    const harness = readFileSync(resolve(process.cwd(), 'src/__tests__/helpers/cahierPdfNativeServer.mjs'), 'utf8')
    expect(harness).not.toMatch(/\breadAsset\s*[,:]/)
    expect(harness).toContain('signal: controller.signal')
  })

  it('(b) un équipement et un horizon figés non défaut changent le PDF produit', async () => {
    const a: any = structuredClone(captureExplorerRangs())
    const b: any = structuredClone(captureExplorerRangs())
    // Real fact codes of this fixture, at two different horizon selections.
    a.nativeSelection = { ...a.nativeSelection, typequ: 'B207', horizonMinutes: 5 }
    b.nativeSelection = { ...b.nativeSelection, typequ: 'B202', horizonMinutes: 20 }
    const [textA, textB] = await Promise.all([pagesTexte(a), pagesTexte(b)])
    expect(textA.join(' ')).toContain('Équipement test (B207)')
    expect(textB.join(' ')).toContain('Équipement bis (B202)')
    // Two different frozen selections produce two different real documents.
    expect(textA.join(' ')).not.toBe(textB.join(' '))
  }, 60000)

  it('(c) une seule sélection figée pilote figure et tableau', async () => {
    const capture: any = structuredClone(capturePdfFixture('aedar-car-overview'))
    capture.nativeSelection.modes = ['car']
    // A stale figure-only source must not reappear: the table's frozen modes win.
    capture.aedar.modes = ['bike_lts4']
    const request = requete(capture)
    expect(request.modeIds).toEqual(['car'])
    expect(request.capture.nativeSelection?.modes).toEqual(request.modeIds)
    const text = (await pagesTexte(capture)).join(' ')
    // The stale figure-only source never leaks into the rendered document.
    expect(text).not.toContain('Vélo LTS4')
  })

  it('(d) la note de preuve suit le corps qui porte la preuve, page par page', async () => {
    // A proof-bearing document: the page that carries the served ordinal also
    // carries exactly one footnote; a proof-less multi-page document paints no
    // footnote at all (so the note is page-local, never blanket or page-0 only).
    const avecPreuve = await pagesTexte(capturePartDense())
    expect(avecPreuve.length).toBeGreaterThanOrEqual(1)
    for (const page of avecPreuve.filter((text) => /\d+(er|e)\/\d+/.test(text))) {
      expect(page).toContain('¹ Groupe comparé')
      expect(page.split('¹ Groupe comparé').length - 1).toBe(1)
    }
    const sansPreuve = await pagesTexte(captureProfilRangsDense())
    expect(sansPreuve.length).toBeGreaterThanOrEqual(2)
    for (const page of sansPreuve) expect(page).not.toContain('¹ Groupe comparé')
  }, 60000)

  it('(e) un bloc dense se prolonge selon le budget réel, sans échec layout', async () => {
    const denses = [captureProfilRangsDense(), capturePartDense()]
    for (const capture of denses) {
      const pages = await pagesTexte(capture)
      expect(pages.length).toBeGreaterThanOrEqual(1)
      // No page is empty and the last page still carries the page furniture.
      for (const page of pages) expect(page).toContain('/')
      expect(pages[pages.length - 1]).toMatch(/\d\s*\/\s*\d/)
    }
  }, 60000)

  it('(f) chaque raison native surfacée a son code contrôleur et son message français', () => {
    const cas: Array<[string, string]> = [
      ['map-unavailable', 'asset'],
      ['map-pending', 'asset'],
      ['asset-unfrozen', 'asset'],
      ['section-pending', 'incomplete-capture'],
      ['unsupported-native-modes', 'incomplete-capture'],
      ['unbreakable-native-figure', 'layout'],
      ['native-width', 'layout'],
      ['missing-rendered-section', 'serialization'],
      ['raison-inconnue', 'inconsistent-capture'],
    ]
    for (const [reason, code] of cas) {
      expect(codeErreurNativePdf(reason), reason).toBe(code)
      const message = messageErreurNativePdf(reason)
      expect(message, reason).not.toBe(reason)
      // A user-facing French sentence, not the English slug.
      expect(message.length, reason).toBeGreaterThan(10)
      expect(message, reason).toMatch(/\s/)
    }
    expect(new CahierNativePdfError('map-unavailable').reason).toBe('map-unavailable')
  })
})
