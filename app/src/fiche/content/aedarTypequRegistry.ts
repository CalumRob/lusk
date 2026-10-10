import csv from '../../../../pipeline/inst/extdata/aedar-typequ-2025.csv?raw'

/** Consume the producer's pinned closed axis, never a second browser-owned list. */
export const AEDAR_TYPEQU_REGISTRY = csv.trim().split(/\r?\n/).slice(1).map((line) => {
  const match = line.match(/^"([^"]+)","((?:[^"]|"")*)"$/)
  if (!match) throw new Error('Registre TYPEQU AEDAR invalide')
  return { code: match[1]!, label: match[2]!.replaceAll('""', '"') }
})
