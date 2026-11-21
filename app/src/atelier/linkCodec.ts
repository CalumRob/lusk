/**
 * The Atelier share-link codec (ADR-0046, #1074/#1079).
 *
 * A whole page is versioned JSON → deflate-raw → base64url, carried in `?c=`.
 * The caller owns URL sync (debounced in the view); this module only turns a
 * state into a string and a string back into a state. Decoding is total: an
 * invalid, truncated or unknown-version link opens an empty page with a quiet
 * notice — it never throws and never half-restores a page.
 */

import { emptyAtelierState, isValidAtelierState, STATE_VERSION, type AtelierState } from './state'

/** Query parameter the link lives in; the router/view owns the sync. */
export const LINK_PARAM = 'c'

/**
 * Compression seam. Injected by tests (and any host without Web Streams); the
 * default uses the platform's deflate-raw CompressionStream/DecompressionStream.
 */
export interface Codec {
  deflate(bytes: Uint8Array): Promise<Uint8Array>
  inflate(bytes: Uint8Array): Promise<Uint8Array>
}

export interface DecodedAtelierLink {
  state: AtelierState
  notice?: string
}

const INVALID_NOTICE = 'Ce lien Atelier est illisible : une page vide a été ouverte.'
const VERSION_NOTICE = 'Ce lien Atelier provient d’une version inconnue : une page vide a été ouverte.'

function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const source = new Blob([bytes as BlobPart]).stream()
    .pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)
  return new Response(source).arrayBuffer().then((buffer) => new Uint8Array(buffer))
}

export function defaultCodec(): Codec {
  return {
    deflate: (bytes) => pipe(bytes, new CompressionStream('deflate-raw')),
    inflate: (bytes) => pipe(bytes, new DecompressionStream('deflate-raw')),
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export async function encodeAtelierLink(state: AtelierState, codec: Codec = defaultCodec()): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(state))
  return toBase64Url(await codec.deflate(json))
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export async function decodeAtelierLink(
  encoded: string,
  codec: Codec = defaultCodec(),
): Promise<DecodedAtelierLink> {
  try {
    const compressed = fromBase64Url(encoded)
    const inflated = await codec.inflate(compressed)
    // Fatal decoding: a truncated or corrupt byte stream cannot become a page.
    const json = new TextDecoder('utf-8', { fatal: true }).decode(inflated)
    const parsed: unknown = JSON.parse(json)
    if (isRecord(parsed) && parsed.v !== STATE_VERSION) {
      return { state: emptyAtelierState(), notice: VERSION_NOTICE }
    }
    if (!isValidAtelierState(parsed)) {
      return { state: emptyAtelierState(), notice: INVALID_NOTICE }
    }
    // A valid link carries no notice: the caller shows nothing.
    return { state: parsed }
  } catch {
    // atob, inflate, UTF-8 decoding and JSON parsing all throw on bad input;
    // every one of them is the same quiet, empty-page outcome.
    return { state: emptyAtelierState(), notice: INVALID_NOTICE }
  }
}
