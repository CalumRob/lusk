/**
 * Fetch and validate one named JSON projection from the /data/ hosting.
 * Progressive route/store readers use this per-file boundary; no whole-payload
 * assembly path is provided here.
 */

import type {
  RunReport,
  Territoire,
  Theme,
  ThemeMetadata,
  TerritoryMetadata,
  Vintage,
} from './types'
import { THEMES_CANONIQUES } from './types'
import {
  PayloadError,
  validerRapportRun,
  validerTerritoires,
  validerTerritoiresMetadata,
  validerCatalogueNavigateur,
  validerVintages,
} from './validate'

/** The minimal Response surface the loader needs (fetch() satisfies it). */
export interface ReponseFetch {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

export type FetchImpl = (url: string) => Promise<ReponseFetch>

export interface ChargerOptions {
  /** Base of the /data/ hosting — defaults to '/data/' (nginx alias, self-hosting.md). */
  baseUrl?: string
  /** Injected for tests; defaults to the real fetch. */
  fetchImpl?: FetchImpl
}

/**
 * The per-file vocabulary of the loader — the wait-set vocabulary of the
 * progressive store (PRD #296), the bare file name without the .json suffix:
 * 'territoires', 'run-report', 'theme_demographie', … . The legacy numerical
 * names remain in this vocabulary for injected in-memory stores; the network
 * loader resolves them as absent because those JSON exports are retired.
 */
export type Fichier =
  | 'territoires'
  | 'territoires-metadata'
  | 'run-report'
  | 'vintages'
  // #894/#903 — 'apercu' n'est plus un fichier : la projection apercu.json est
  // retirée source-only (#894), l'artefact commité supprimé (#903) — jamais
  // demandée ni validée
  | `indicateurs_${Theme}`
  | `histoires_${Theme}`
  | `theme_${Theme}`

/** Les fichiers MANDATOIRES — un 404 dessus est une erreur de chargement, jamais une absence. */
const FICHIERS_MANDATOIRES: ReadonlySet<Fichier> = new Set<Fichier>(['territoires'])

/**
 * The fetch + « 404 = table absente » contract (ADR-0013) : optional files
 * return null on 404 (honest absence, never an error), mandatory files throw
 * the typed fetch error. The messages of the original obtenir() — byte for
 * byte.
 */
async function obtenir(nom: Fichier, options: ChargerOptions): Promise<unknown | null> {
  const baseUrl = options.baseUrl ?? '/data/'
  const fetchImpl = options.fetchImpl ?? ((url: string) => fetch(url))
  const fichier = `${nom}.json`
  const url = `${baseUrl}${fichier}`
  const optionnel = !FICHIERS_MANDATOIRES.has(nom)

  let reponse: ReponseFetch
  try {
    reponse = await fetchImpl(url)
  } catch (cause) {
    throw new PayloadError(
      'fetch',
      fichier,
      `Impossible de charger ${url} : ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  if (!reponse.ok) {
    if (optionnel && reponse.status === 404) return null
    throw new PayloadError('fetch', fichier, `Réponse HTTP ${reponse.status} pour ${url}`)
  }
  try {
    return await reponse.json()
  } catch {
    throw new PayloadError('fetch', fichier, `JSON illisible dans ${url}`)
  }
}

/** One validator per file — the existing per-file validators, attributed to their file. */
type ValiderFichier = (brut: unknown, fichier: string) => unknown | null

const VALIDER_PAR_FICHIER = new Map<Fichier, ValiderFichier>([
  ['territoires', (brut, fichier) => validerTerritoires(brut, fichier)],
  ['territoires-metadata', (brut, fichier) => validerTerritoiresMetadata(brut, fichier)],
  ['run-report', (brut, fichier) => validerRapportRun(brut, fichier)],
  ['vintages', (brut, fichier) => validerVintages(brut, fichier)],
])

// Les métadonnées de thème (ADR-0007) sont autonomes. Les anciennes
// projections numériques restent validables par les API adapters via
// `validerIndicateurs` / `validerHistoires`, jamais par une requête JSON ici.
for (const theme of THEMES_CANONIQUES) {
  // La métadonnée du thème (issue #309/#313) — le validateur est autonome
  // (aucune table de référence) ; la règle de présence vit dans
  // les routes et stores consommateurs, jamais ici. #868 : le fichier servi est la
  // projection navigateur → point d'entrée 'navigateur' explicite.
  VALIDER_PAR_FICHIER.set(`theme_${theme}`, (brut, fichier) =>
    validerCatalogueNavigateur(brut, fichier),
  )
}

/**
 * Fetch + validate ONE named file — the per-file seam of the progressive
 * store (issue #297). Returns the typed section, or null for an optional
 * file absent by 404 (the « 404 = table absente » contract, ADR-0013).
 * Retired numerical names resolve as absent without a request. Their validators
 * remain available to API adapters through the validation module.
 */
export async function chargerFichier(nom: 'territoires', options?: ChargerOptions): Promise<Territoire[]>
export async function chargerFichier(nom: 'territoires-metadata', options?: ChargerOptions): Promise<TerritoryMetadata | null>
export async function chargerFichier(nom: 'run-report', options?: ChargerOptions): Promise<RunReport | null>
export async function chargerFichier(nom: 'vintages', options?: ChargerOptions): Promise<Vintage[] | null>
export async function chargerFichier(
  nom: `indicateurs_${Theme}`,
  options?: ChargerOptions,
): Promise<null>
export async function chargerFichier(
  nom: `indicateurs_${Theme}`,
  territoires: Territoire[],
  options?: ChargerOptions,
): Promise<null>
export async function chargerFichier(
  nom: `histoires_${Theme}`,
  options?: ChargerOptions,
): Promise<null>
export async function chargerFichier(
  nom: `histoires_${Theme}`,
  territoires: Territoire[],
  options?: ChargerOptions,
): Promise<null>
export async function chargerFichier(
  nom: `theme_${Theme}`,
  options?: ChargerOptions,
): Promise<ThemeMetadata | null>
export async function chargerFichier(
  nom: Fichier,
  territoiresOuOptions?: Territoire[] | ChargerOptions,
  options?: ChargerOptions,
): Promise<unknown> {
  const opts: ChargerOptions = Array.isArray(territoiresOuOptions)
    ? (options ?? {})
    : (territoiresOuOptions ?? {})

  // Both numerical projections are retired browser exports. Keep accepting
  // their old names so callers fail closed: no network request and no fake
  // metadata-presence signal from a 404.
  if (nom.startsWith('indicateurs_') || nom.startsWith('histoires_')) return null

  const brut = await obtenir(nom, opts)
  // Le contournement du validateur n'existe que pour les fichiers OPTIONNELS :
  // un corps null sur un fichier mandataire (territoires) est une dérive du
  // contrat, pas une absence — il doit tomber dans son validateur et lever
  // l'erreur typée (relecture #297), jamais devenir un null silencieux.
  if (brut === null && !FICHIERS_MANDATOIRES.has(nom)) return null
  return VALIDER_PAR_FICHIER.get(nom)!(brut, `${nom}.json`)
}
