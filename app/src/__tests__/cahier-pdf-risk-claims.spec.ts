/**
 * Independent unit verification of two #1024 contracts: frozen map bytes reach
 * the default reader without fetch, and every native reason maps to a controlled
 * French error. Rendered document claims are verify:* acceptance coverage.
 */
import { deflateSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'

import {
  CahierNativePdfError,
  codeErreurNativePdf,
  messageErreurNativePdf,
  readAssetParDefaut,
} from '@/fiche/prototype/cahierNativePdf'

/** A labelled 10x10 technical PNG built here, not imported from the fixtures. */
function proprePng(): ArrayBuffer {
  const crcTable = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let v = n
    for (let k = 0; k < 8; k += 1) v = v & 1 ? 0xedb88320 ^ (v >>> 8) : v << 1
    crcTable[n] = v >>> 0
  }
  const chunk = (name: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(name, 'ascii'), data])
    let crc = 0xffffffff
    for (const byte of body) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
    const out = Buffer.alloc(data.length + 12)
    out.writeUInt32BE(data.length, 0); out.write(name, 4, 4, 'ascii')
    data.copy(out, 8)
    out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8)
    return out
  }
  const taille = 10
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(taille, 0); ihdr.writeUInt32BE(taille, 4); ihdr[8] = 8; ihdr[9] = 6
  const row = Buffer.alloc(taille * 4 + 1)
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

describe('affirmations risquées retenues — vérification indépendante (#1024)', () => {
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
  })

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
      expect(message.length, reason).toBeGreaterThan(10)
      expect(message, reason).toMatch(/\s/)
    }
    expect(new CahierNativePdfError('map-unavailable').reason).toBe('map-unavailable')
  })
})
