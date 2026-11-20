/** PROTOTYPE — the « unique » link: the whole page as versioned JSON, deflate-raw compressed, base64url, in `?c=`. */
import type { FigureState } from './prototypeFigure'

export interface SharedAxisTitles {
  x: string | null
  y: string | null
}
export type SharedBlock =
  | { k: 'p'; x: string }
  | { k: 'f'; s: FigureState; ct: string | null; ax: SharedAxisTitles }
export interface SharedPage {
  v: 1
  t: string
  b: SharedBlock[]
}

const toBase64Url = (bytes: Uint8Array) => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const fromBase64Url = (text: string) => {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

export async function encodePage(page: SharedPage): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(page))
  return toBase64Url(await pipe(json, new CompressionStream('deflate-raw')))
}

const isStringOrNull = (v: unknown) => v === null || typeof v === 'string'
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function assertFigureState(s: unknown): asserts s is FigureState {
  if (!isRecord(s) || !['commune', 'epci', 'departement'].includes(String(s.level)) || !isRecord(s.population) || !isRecord(s.channels)) throw new Error('figure')
  for (const k of ['departement', 'epci', 'classe_densite', 'littoral']) if (!Array.isArray(s.population[k])) throw new Error('population')
  for (const id of ['x', 'y', 'taille', 'couleur']) {
    const c = s.channels[id]
    if (!isRecord(c) || !['aucune', 'cellule', 'formule', 'categorie', 'appartenance'].includes(String(c.mode)) || !Array.isArray(c.operands) || typeof c.expression !== 'string') throw new Error('canal')
  }
}

/** Throws on anything that is not a v1 page. */
export async function decodePage(c: string): Promise<SharedPage> {
  const json = new TextDecoder().decode(await pipe(fromBase64Url(c), new DecompressionStream('deflate-raw')))
  const page: unknown = JSON.parse(json)
  if (!isRecord(page) || page.v !== 1 || typeof page.t !== 'string' || !Array.isArray(page.b)) throw new Error('version')
  for (const b of page.b as unknown[]) {
    if (!isRecord(b)) throw new Error('bloc')
    if (b.k === 'p') {
      if (typeof b.x !== 'string') throw new Error('texte')
    } else if (b.k === 'f') {
      assertFigureState(b.s)
      if (!isStringOrNull(b.ct) || !isRecord(b.ax) || !isStringOrNull(b.ax.x) || !isStringOrNull(b.ax.y)) throw new Error('titres')
    } else throw new Error('bloc')
  }
  return page as unknown as SharedPage
}
