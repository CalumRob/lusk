/**
 * Embedded faces and typographic roles of the shared Cahier PDF (#1024).
 *
 * The binaries are derived from the app's own `@fontsource-variable` packages
 * by `scripts/derive-pdf-fonts.py`; `manifest.json` records source, licence and
 * SHA-256. Loading is lazy (only a PDF request fetches a face) and a missing or
 * unreadable face rejects the generation instead of silently substituting a
 * system font.
 */
import manifest from '../../assets/fonts/pdf/manifest.json'

export interface PdfFontFace {
  readonly id: string
  readonly family: string
  readonly weight: number
  readonly style: 'normal' | 'italic'
  readonly file: string
  readonly bytes: number
  readonly sha256: string
  readonly source: string
  readonly sourcePackage: string
  readonly license: string
  readonly licenseSpdx: string
  readonly url: string
}

interface ManifestFace {
  readonly id: string
  readonly family: string
  readonly weight: number
  readonly style: string
  readonly file: string
  readonly bytes: number
  readonly sha256: string
  readonly source: string
  readonly sourcePackage: string
  readonly license: string
  readonly licenseSpdx: string
}

function urlAsset(file: string): string {
  // Static glob: Vite emits every referenced TTF as a hashed asset. A dynamic
  // `new URL(..., import.meta.url)` would not be statically analysable and the
  // production fetch would 404.
  const urls = import.meta.glob('../../assets/fonts/pdf/*.ttf', {
    query: '?url',
    import: 'default',
    eager: true,
  }) as Record<string, string>
  const url = urls[`../../assets/fonts/pdf/${file}`]
  if (!url) {
    throw new Error(`Police PDF absente du bundle : ${file}`)
  }
  return url
}

export const POLICES_PDF: readonly PdfFontFace[] = (manifest.faces as readonly ManifestFace[])
  .map((face) => ({
    ...face,
    style: face.style === 'italic' ? 'italic' : 'normal',
    url: urlAsset(face.file),
  }))

export const POLICE_PDF = {
  display: 'mozilla-headline-400',
  displayStrong: 'mozilla-headline-600',
  body: 'mozilla-text-400',
  bodyMedium: 'mozilla-text-500',
  bodyStrong: 'mozilla-text-600',
  value: 'fira-code-500',
  valueStrong: 'fira-code-700',
  meta: 'fira-code-400',
  metaMedium: 'fira-code-500',
  wordmark: 'newsreader-600-italic',
} as const

export type PdfFontId = (typeof POLICE_PDF)[keyof typeof POLICE_PDF]

/** Loads the raw bytes of one embedded face; injectable for tests/SSR. */
export type ChargeurPolicePdf = (
  face: PdfFontFace,
  options: { readonly signal: AbortSignal },
) => Promise<ArrayBuffer>

function verifierTaille(face: PdfFontFace, bytes: ArrayBuffer): void {
  if (bytes.byteLength !== face.bytes) {
    throw new Error(
      `Police PDF incomplète (${face.id}) : ${bytes.byteLength} octets au lieu de ${face.bytes}.`,
    )
  }
}

/** Production loader: the browser fetches the bundled, hashed asset. */
export const chargerPolicePdf: ChargeurPolicePdf = async (face, { signal }) => {
  const response = await fetch(face.url, { signal })
  if (!response.ok) {
    throw new Error(`Police PDF introuvable (${face.id}) : HTTP ${response.status}.`)
  }
  const bytes = await response.arrayBuffer()
  verifierTaille(face, bytes)
  return bytes
}

/** Test/SSR helper: reads the exact same bundled bytes from disk. */
export function chargeurPoliceDepuisDisque(
  lire: (face: PdfFontFace) => ArrayBuffer,
): ChargeurPolicePdf {
  return async (face) => {
    const bytes = lire(face)
    verifierTaille(face, bytes)
    return bytes
  }
}

export function policeParId(id: string): PdfFontFace {
  const face = POLICES_PDF.find((candidate) => candidate.id === id)
  if (!face) throw new Error(`Police PDF inconnue : ${id}`)
  return face
}
