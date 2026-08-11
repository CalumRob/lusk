/**
 * THE SINGLE SEAM — the only module in the app that touches the raw JSON
 * payload (docs/architecture.md §The fiche payload). Nothing else imports
 * this. It fetches the JSON projections from the /data/ hosting, validates
 * each file against the contract (the app's half of validate_payload(),
 * validate.ts) and parses the merged result into a typed Payload.
 *
 * Two entry points (issue #297 — the T1 prefactor of the progressive store,
 * PRD #296 « la page d'abord, le reste en arrière-plan ») :
 * - chargerFichier(nom) — ONE named file in, its typed section out (or null
 *   for an optional file absent by 404). The per-file seam the store ticket
 *   builds on; nothing consumes it yet.
 * - chargerPayload(options) — the assembled payload: all files, today's
 *   all-or-nothing semantics. Implemented on top of chargerFichier — same
 *   order, same errors, byte for byte.
 *
 * Theme discovery is payload-driven (ADR-0007): the canonical themes are
 * tried in order, a 404 on indicateurs_<theme>.json means the theme is
 * absent (dead tab — never an error), while a present theme without its
 * histoires file is contract drift (loud). The same presence rule holds for
 * the theme's metadata (theme_<theme>.json, issue #309, wired by #313): a
 * present theme REQUIRES its metadata file — 404 is drift, loud. run-report
 * and vintages.json are optional — a 404 means the static-rhythm freshness
 * claim, never an error. So is apercu.json (issue #122): since #116 the
 * pipeline only publishes it when a theme HAS an aperçu — a 404 means the
 * Aperçu element is simply not built, never an error.
 *
 * The reference-table dependency holds for any caller of the per-file entry
 * point that needs it: theme files (indicateurs_<theme>, histoires_<theme>),
 * apercu and programmes validate AGAINST the validated territoires table —
 * the ordering constraint of the loader, kept (chargerFichier('indicateurs_
 * habitat', territoires)). theme_<theme>.json does NOT validate against the
 * table (validerThemeMetadata is self-contained) — its per-file entry takes
 * no reference; the presence rule lives in chargerPayload and the store.
 *
 * Failure is typed (PayloadError, validate.ts): kind 'fetch' for transport
 * problems (the UI's error state), kind 'validation' for contract drift.
 */

import type {
  ApercuRow,
  Histoire,
  Indicateur,
  Payload,
  ProgrammesPayload,
  RunReport,
  Territoire,
  Theme,
  ThemeMetadata,
  Vintage,
} from './types'
import { THEMES_CANONIQUES } from './types'
import {
  PayloadError,
  validerApercu,
  validerHistoires,
  validerIndicateurs,
  validerProgrammes,
  validerRapportRun,
  validerTerritoires,
  validerThemeMetadata,
  validerVintages,
  verifierPariteLibelles,
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
 * 'territoires', 'run-report', 'indicateurs_demographie', …
 */
export type Fichier =
  | 'territoires'
  | 'run-report'
  | 'vintages'
  | 'apercu'
  | 'programmes'
  | `indicateurs_${Theme}`
  | `histoires_${Theme}`
  | `theme_${Theme}`

/** Les fichiers MANDATOIRES — un 404 dessus est une erreur de chargement, jamais une absence. */
const FICHIERS_MANDATOIRES: ReadonlySet<Fichier> = new Set<Fichier>(['territoires'])

/** Les fichiers qui se valident SANS la table de référence (les territoires validés). */
const FICHIERS_SANS_REFERENCE: ReadonlySet<Fichier> = new Set<Fichier>([
  'territoires',
  'run-report',
  'vintages',
  ...THEMES_CANONIQUES.map((theme) => `theme_${theme}` as Fichier),
])

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
type ValiderFichier = (brut: unknown, fichier: string, territoires: Territoire[]) => unknown | null

const VALIDER_PAR_FICHIER = new Map<Fichier, ValiderFichier>([
  ['territoires', (brut, fichier) => validerTerritoires(brut, fichier)],
  ['run-report', (brut, fichier) => validerRapportRun(brut, fichier)],
  ['vintages', (brut, fichier) => validerVintages(brut, fichier)],
  ['apercu', (brut, fichier, territoires) => validerApercu(brut, fichier, territoires)],
  ['programmes', (brut, fichier, territoires) => validerProgrammes(brut, fichier, territoires)],
])

// Les fichiers de thème (ADR-0007) : les mêmes validateurs par thème, la
// table de référence requise — la découverte reste pilotée par le payload.
for (const theme of THEMES_CANONIQUES) {
  VALIDER_PAR_FICHIER.set(`indicateurs_${theme}`, (brut, fichier, territoires) =>
    validerIndicateurs(brut, fichier, territoires),
  )
  VALIDER_PAR_FICHIER.set(`histoires_${theme}`, (brut, fichier, territoires) =>
    validerHistoires(brut, fichier, territoires),
  )
  // La métadonnée du thème (issue #309/#313) — le validateur est autonome
  // (aucune table de référence) ; la règle de présence vit dans
  // chargerPayload et le store, jamais ici.
  VALIDER_PAR_FICHIER.set(`theme_${theme}`, (brut, fichier) =>
    validerThemeMetadata(brut, fichier),
  )
}

/** La table de référence est REQUISE pour les fichiers qui se valident contre elle. */
function exigerReference(nom: Fichier, territoires: Territoire[] | undefined): asserts territoires is Territoire[] {
  if (!FICHIERS_SANS_REFERENCE.has(nom) && territoires === undefined) {
    throw new PayloadError(
      'validation',
      `${nom}.json`,
      `« ${nom}.json » se valide contre la table de référence — passez les territoires validés : chargerFichier(nom, territoires)`,
    )
  }
}

/**
 * Fetch + validate ONE named file — the per-file seam of the progressive
 * store (issue #297). Returns the typed section, or null for an optional
 * file absent by 404 (the « 404 = table absente » contract, ADR-0013).
 * Theme / apercu / programmes files validate AGAINST the reference table:
 * pass the VALIDATED territoires (chargerFichier('indicateurs_habitat',
 * territoires)) — the ordering constraint of the loader, kept.
 */
export async function chargerFichier(nom: 'territoires', options?: ChargerOptions): Promise<Territoire[]>
export async function chargerFichier(nom: 'run-report', options?: ChargerOptions): Promise<RunReport | null>
export async function chargerFichier(nom: 'vintages', options?: ChargerOptions): Promise<Vintage[] | null>
export async function chargerFichier(
  nom: 'apercu',
  territoires: Territoire[],
  options?: ChargerOptions,
): Promise<ApercuRow[] | null>
export async function chargerFichier(
  nom: 'programmes',
  territoires: Territoire[],
  options?: ChargerOptions,
): Promise<ProgrammesPayload | null>
export async function chargerFichier(
  nom: `indicateurs_${Theme}`,
  territoires: Territoire[],
  options?: ChargerOptions,
): Promise<Indicateur[] | null>
export async function chargerFichier(
  nom: `histoires_${Theme}`,
  territoires: Territoire[],
  options?: ChargerOptions,
): Promise<Histoire[] | null>
export async function chargerFichier(
  nom: `theme_${Theme}`,
  options?: ChargerOptions,
): Promise<ThemeMetadata | null>
export async function chargerFichier(
  nom: Fichier,
  territoiresOuOptions?: Territoire[] | ChargerOptions,
  options?: ChargerOptions,
): Promise<unknown> {
  const territoires = Array.isArray(territoiresOuOptions) ? territoiresOuOptions : undefined
  const opts: ChargerOptions = Array.isArray(territoiresOuOptions)
    ? (options ?? {})
    : (territoiresOuOptions ?? {})
  exigerReference(nom, territoires)

  const brut = await obtenir(nom, opts)
  // Le contournement du validateur n'existe que pour les fichiers OPTIONNELS :
  // un corps null sur un fichier mandataire (territoires) est une dérive du
  // contrat, pas une absence — il doit tomber dans son validateur et lever
  // l'erreur typée (relecture #297), jamais devenir un null silencieux.
  if (brut === null && !FICHIERS_MANDATOIRES.has(nom)) return null
  return VALIDER_PAR_FICHIER.get(nom)!(brut, `${nom}.json`, territoires)
}

export async function chargerPayload(options: ChargerOptions = {}): Promise<Payload> {
  const territoires = await chargerFichier('territoires', options)

  const indicateurs: Indicateur[] = []
  const histoires: Histoire[] = []
  const themeMetadata: Partial<Record<Theme, ThemeMetadata>> = {}

  for (const theme of THEMES_CANONIQUES) {
    const indicateursTheme = await chargerFichier(`indicateurs_${theme}`, territoires, options)
    if (indicateursTheme === null) continue

    const histoiresTheme = await chargerFichier(`histoires_${theme}`, territoires, options)
    if (histoiresTheme === null) {
      throw new PayloadError(
        'validation',
        `histoires_${theme}.json`,
        `Le thème « ${theme} » publie des indicateurs sans histoires (histoires_${theme}.json introuvable)`,
      )
    }

    // La règle de présence des métadonnées (issue #313) : un thème présent
    // REQUIERT son theme_<theme>.json — 404 = dérive typée, jamais une
    // absence silencieuse (le même contrat que les histoires).
    const metadataTheme = await chargerFichier(`theme_${theme}`, options)
    if (metadataTheme === null) {
      throw new PayloadError(
        'validation',
        `theme_${theme}.json`,
        `Le thème « ${theme} » publie des indicateurs sans métadonnées (theme_${theme}.json introuvable)`,
      )
    }

    indicateurs.push(...indicateursTheme)
    histoires.push(...histoiresTheme)
    themeMetadata[theme] = metadataTheme
  }

  const apercu = await chargerFichier('apercu', territoires, options)
  const runReport = await chargerFichier('run-report', options)
  const vintages = await chargerFichier('vintages', options)
  // Le payload programmes (issue #179) — optionnel : un 404 sur programmes.json
  // signifie que l'élément est simplement absent (l'état vide honnête), jamais
  // une erreur de chargement — la machinerie optionnelle établie (le précédent
  // run-report / vintages, ADR-0013 « 404 = table absente »).
  const programmes = await chargerFichier('programmes', territoires, options)

  // La parité bidirectionnelle libellés ↔ payload (issue #318) : chaque ligne
  // (key, detail) publiée a son libellé dans les métadonnées du thème — et
  // aucun libellé déclaré n'est mort. Une dérive échoue FORT ici, jamais au
  // rendu (la fiche et la carte ne retombent jamais sur la clé brute).
  const payload = { territoires, indicateurs, histoires, apercu, runReport, vintages, programmes, themeMetadata }
  verifierPariteLibelles(payload)

  return payload
}
