/**
 * The browser theme catalogue seam (#868).
 *
 * After the static runtime retirement, `theme_<theme>.json` is read only for
 * the factual declarations real consumers still need: the producer-owned
 * factual labels and source records, the indicator-page contracts, and the
 * two retained framing clauses (the transport thresholds in Mobilité, the
 * grant-eligibility scope in Programmes et subventions). Stable presentation
 * grammar lives in app-owned content (fiche/content/ficheGrammar.ts); the
 * catalogue never carries the fiche's numerical runtime anymore — numerics
 * are API-only (acquisition par thème).
 *
 * The fiche loads only the SELECTED theme's catalogue, as optional explanation
 * enrichment: missing/invalid metadata leaves the affected explanations
 * pending/unavailable with a scoped metadata-only retry and never clears valid
 * API facts. Metadata is verified only when its own contract validates — never
 * as a side effect of bootstrap identity loading.
 */

import type { InjectionKey } from 'vue'

import type { Theme, ThemeMetadata } from './types'
import { PayloadError, validerThemeMetadata } from './validate'

export type ChargerMetadonneesTheme = (theme: Theme) => Promise<ThemeMetadata>

export const THEME_METADATA_CHARGER_KEY: InjectionKey<ChargerMetadonneesTheme> =
  Symbol('theme-metadata-charger')

/** Load one producer catalogue only when the active native fiche needs its explanations. */
export const chargerMetadonneesTheme: ChargerMetadonneesTheme = async (theme) => {
  const url = `/data/theme_${theme}.json`
  let response: Response
  try {
    response = await fetch(url)
  } catch (cause) {
    throw new PayloadError('fetch', url,
      `Impossible de charger le catalogue thématique : ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  if (!response.ok) throw new PayloadError('fetch', url, `Réponse HTTP ${response.status} pour ${url}`)
  let raw: unknown
  try {
    raw = await response.json()
  } catch {
    throw new PayloadError('validation', url, `JSON illisible dans ${url}`)
  }
  const metadata = validerThemeMetadata(raw, url)
  if (metadata.theme !== theme) {
    throw new PayloadError('validation', url, `Le catalogue ${url} ne correspond pas au thème ${theme}.`)
  }
  return metadata
}
