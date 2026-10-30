/**
 * The browser theme catalogue seam (#868).
 *
 * The served `theme_<theme>.json` (public/data — nginx in production, Vite
 * dev/build via copy-payload-build) is the REDUCED browser projection produced
 * by the pipeline publish seam (`projection_navigateur`, pipeline/R/
 * publier_theme_metadata.R): producer-only top-level fields (story_keys,
 * observed_collection_contracts, semantic_resources) are not shipped; the
 * full canonical declarations stay pinned under pipeline/inst/extdata/
 * theme-metadata/. What the browser still reads — factual labels, source
 * records, indicator-page contracts, sources map, and the two retained framing
 * clauses (transport thresholds in Mobilité, grant-eligibility scope in
 * Programmes et subventions) — is served and validated here (validerThemeMetadata,
 * with story_keys optional since #868). Stable presentation grammar lives in
 * app-owned content (fiche/content/ficheGrammar.ts); the catalogue never carries
 * the fiche's numerical runtime — numerics are API-only (acquisition par thème).
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
