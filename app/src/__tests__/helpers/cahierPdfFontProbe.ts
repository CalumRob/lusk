/**
 * Minimal TrueType reader for the PDF font contract (#1024).
 *
 * The composer embeds whole TrueType programs; a reader can therefore verify
 * the actual glyph source (advances, outlines, italic angle) instead of the
 * nominal family name. Only the tables this contract needs are parsed, and the
 * bytes always come from the produced PDF — never from the derivation script.
 */

export interface PoliceTtf {
  readonly unitsPerEm: number
  readonly italicAngle: number
  readonly glyphCount: number
  /** Advance width in font units for one character, or null when unmapped. */
  advance(char: string): number | null
  /** `hmtx` left side bearing in font units. */
  leftSideBearing(char: string): number | null
  /** `glyf` bounding box left edge in font units (post-skew asset). */
  xMin(char: string): number | null
  /** `glyf` bounding box right edge in font units. */
  xMax(char: string): number | null
  /** Number of points of one simple glyph, or null when unmapped/composite. */
  pointCount(char: string): number | null
  /** Contour count of one glyph (-1 for a composite), or null when unmapped. */
  contourCount(char: string): number | null
}

function u16(view: DataView, offset: number): number {
  return view.getUint16(offset, false)
}

function i16(view: DataView, offset: number): number {
  return view.getInt16(offset, false)
}

function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, false)
}

function i32(view: DataView, offset: number): number {
  return view.getInt32(offset, false)
}

function fixed16(view: DataView, offset: number): number {
  return i32(view, offset) / 65536
}

interface TableRecord {
  readonly offset: number
  readonly length: number
}

export function lirePoliceTtf(program: Uint8Array): PoliceTtf {
  const view = new DataView(program.buffer, program.byteOffset, program.byteLength)
  const numTables = u16(view, 4)
  const tables = new Map<string, TableRecord>()
  for (let index = 0; index < numTables; index += 1) {
    const record = 12 + index * 16
    const tag = String.fromCharCode(
      program[record]!, program[record + 1]!, program[record + 2]!, program[record + 3]!,
    )
    tables.set(tag, { offset: u32(view, record + 8), length: u32(view, record + 12) })
  }
  const require = (tag: string): TableRecord => {
    const table = tables.get(tag)
    if (!table) throw new Error(`Table TTF absente : ${tag}`)
    return table
  }
  const head = require('head')
  const maxp = require('maxp')
  const hhea = require('hhea')
  const hmtx = require('hmtx')
  const loca = require('loca')
  const glyf = require('glyf')
  const post = require('post')
  const cmap = require('cmap')

  const unitsPerEm = u16(view, head.offset + 18)
  const indexToLocFormat = i16(view, head.offset + 50)
  const glyphCount = u16(view, maxp.offset + 4)
  const numberOfHMetrics = u16(view, hhea.offset + 34)
  const italicAngle = fixed16(view, post.offset + 4)

  // Format 4 Unicode BMP subtable (the Fontsource `latin` subset uses it).
  let format4 = -1
  const cmapCount = u16(view, cmap.offset + 2)
  for (let index = 0; index < cmapCount; index += 1) {
    const record = cmap.offset + 4 + index * 8
    const platform = u16(view, record)
    const encoding = u16(view, record + 2)
    const subtable = cmap.offset + u32(view, record + 4)
    if ((platform === 3 && (encoding === 1 || encoding === 10)) || (platform === 0 && encoding <= 4)) {
      if (u16(view, subtable) === 4) format4 = subtable
    }
  }
  if (format4 < 0) throw new Error('Sous-table cmap format 4 absente')

  const glyphFor = (char: string): number | null => {
    const code = char.codePointAt(0)
    if (code === undefined) return null
    const segCount = u16(view, format4 + 6) / 2
    const endCodes = format4 + 14
    const startCodes = endCodes + segCount * 2 + 2
    const idDeltas = startCodes + segCount * 2
    const idRangeOffsets = idDeltas + segCount * 2
    for (let segment = 0; segment < segCount; segment += 1) {
      const end = u16(view, endCodes + segment * 2)
      if (code > end) continue
      const start = u16(view, startCodes + segment * 2)
      if (code < start) return null
      const delta = i16(view, idDeltas + segment * 2)
      const rangeOffset = u16(view, idRangeOffsets + segment * 2)
      if (rangeOffset === 0) return (code + delta) & 0xffff
      const glyphAddress = idRangeOffsets + segment * 2 + rangeOffset + (code - start) * 2
      const glyph = u16(view, glyphAddress)
      return glyph === 0 ? null : (glyph + delta) & 0xffff
    }
    return null
  }

  const advance = (char: string): number | null => {
    const glyph = glyphFor(char)
    if (glyph === null) return null
    const metric = glyph < numberOfHMetrics ? glyph : numberOfHMetrics - 1
    return u16(view, hmtx.offset + metric * 4)
  }

  const leftSideBearing = (char: string): number | null => {
    const glyph = glyphFor(char)
    if (glyph === null) return null
    if (glyph < numberOfHMetrics) return i16(view, hmtx.offset + glyph * 4 + 2)
    const trailing = hmtx.offset + numberOfHMetrics * 4 + (glyph - numberOfHMetrics) * 2
    return i16(view, trailing)
  }

  const glyphOffset = (glyph: number): number => {
    if (indexToLocFormat === 0) {
      return glyf.offset + u16(view, loca.offset + glyph * 2) * 2
    }
    return glyf.offset + u32(view, loca.offset + glyph * 4)
  }

  const contourCount = (char: string): number | null => {
    const glyph = glyphFor(char)
    if (glyph === null || glyph >= glyphCount) return null
    const offset = glyphOffset(glyph)
    const next = glyphOffset(glyph + 1)
    if (next <= offset) return 0
    return i16(view, offset)
  }

  const bounds = (char: string): { xMin: number; xMax: number } | null => {
    const contours = contourCount(char)
    if (contours === null || contours === 0) return null
    const glyph = glyphFor(char)
    if (glyph === null) return null
    const offset = glyphOffset(glyph)
    return { xMin: i16(view, offset + 2), xMax: i16(view, offset + 6) }
  }

  const pointCount = (char: string): number | null => {
    const contours = contourCount(char)
    if (contours === null || contours < 0) return null
    if (contours === 0) return 0
    const glyph = glyphFor(char)
    if (glyph === null) return null
    const offset = glyphOffset(glyph)
    return u16(view, offset + 10 + (contours - 1) * 2) + 1
  }

  return {
    unitsPerEm,
    italicAngle,
    glyphCount,
    advance,
    leftSideBearing,
    xMin: (char) => bounds(char)?.xMin ?? null,
    xMax: (char) => bounds(char)?.xMax ?? null,
    pointCount,
    contourCount,
  }
}
