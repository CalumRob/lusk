/**
 * The app's half of validate_payload() — the pipeline's guard (compute.R)
 * mirrored in TypeScript. Raw JSON shapes in, typed structures out; contract
 * drift is a loud, typed error (PayloadError), never silent wrong figures.
 *
 * What the app validates (the shape contract, docs/architecture.md):
 * - territoires: unique, one row per territoire, real names, the EPCI ladder
 *   (commune → EPCI → département → région) — a commune carries its EPCI
 *   (SIREN), non-communes carry null
 * - indicateurs: ranks live in [0,1] or null (NA = no comparison group),
 *   value number|null (NA = non calculable), two ISO vintage dates, theme in
 *   the canonical set, no duplicate (territoire × key × detail) rows
 * - histoires: the story row per territoire, soldes numbers
 * - apercu: one row per (territoire × key), value number|null
 * - run-report: mode + ISO timestamp + per-source statuts
 * - referential integrity: facts only cite known territoires, and their
 *   `type` matches the reference
 *
 * What the app does NOT validate (the pipeline's job, compute.R): key
 * multiplicity against the INDICATEURS_<theme> table and stamp equality
 * against the vintages table — the pipeline fails those before publishing.
 */

import type {
  ApercuRow,
  Histoire,
  Indicateur,
  Payload,
  RunReport,
  StatutRun,
  Territoire,
  TerritoireType,
  Theme,
} from './types'
import { THEMES_CANONIQUES } from './types'

export type PayloadErrorKind = 'fetch' | 'validation'

/** The typed error for the UI's error state — a file that failed to load or to validate. */
export class PayloadError extends Error {
  readonly kind: PayloadErrorKind
  readonly file: string

  constructor(kind: PayloadErrorKind, file: string, message: string) {
    super(message)
    this.name = 'PayloadError'
    this.kind = kind
    this.file = file
  }
}

type LigneBrute = Record<string, unknown>

const TYPES_TERRITOIRE: readonly TerritoireType[] = [
  'commune',
  'epci',
  'departement',
  'region',
]

const STATUTS_SOURCE: readonly StatutRun['status'][] = [
  'frais',
  'échec',
  'à traiter à la main',
]

const MODES_SOURCE: readonly StatutRun['mode'][] = ['cron', 'manuel']

const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/

function estObjet(x: unknown): x is LigneBrute {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function estChaine(x: unknown): x is string {
  return typeof x === 'string'
}

function estNombre(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x)
}

function estUneDe<T extends string>(x: unknown, valeurs: readonly T[]): x is T {
  return typeof x === 'string' && (valeurs as readonly string[]).includes(x)
}

/** Un rang vit dans [0,1] ou est null (NA = pas de groupe de comparaison). */
function estRang(x: unknown): x is number | null {
  return x === null || (estNombre(x) && x >= 0 && x <= 1)
}

function estDateIso(x: unknown): x is string {
  if (!estChaine(x) || !DATE_ISO.test(x)) return false
  const [annee, mois, jour] = x.split('-').map(Number)
  const date = new Date(Date.UTC(annee, mois - 1, jour))
  return (
    date.getUTCFullYear() === annee &&
    date.getUTCMonth() === mois - 1 &&
    date.getUTCDate() === jour
  )
}

/** Nombre ou null — null = non calculable pour ce territoire. */
function estValeur(x: unknown): x is number | null {
  return x === null || estNombre(x)
}

function erreur(fichier: string, ligne: number, detail: string): PayloadError {
  return new PayloadError(
    'validation',
    fichier,
    `Payload invalide (${fichier}, ligne ${ligne}) : ${detail}.`,
  )
}

function exiger(x: unknown, fichier: string, ligne: number, detail: string): asserts x {
  if (!x) throw erreur(fichier, ligne, detail)
}

function lireChaine(ligne: LigneBrute, champ: string, fichier: string, i: number): string {
  const valeur = ligne[champ]
  exiger(estChaine(valeur), fichier, i, `« ${champ} » doit être une chaîne`)
  return valeur
}

function lireType(ligne: LigneBrute, fichier: string, i: number): TerritoireType {
  const valeur = ligne['type']
  exiger(
    estUneDe(valeur, TYPES_TERRITOIRE),
    fichier,
    i,
    `« type » doit être commune | epci | departement | region, reçu « ${String(valeur)} »`,
  )
  return valeur
}

function lireTheme(ligne: LigneBrute, fichier: string, i: number): Theme {
  const valeur = ligne['theme']
  exiger(
    estUneDe(valeur, THEMES_CANONIQUES),
    fichier,
    i,
    `« theme » doit être l'un de ${THEMES_CANONIQUES.join(' | ')}, reçu « ${String(valeur)} »`,
  )
  return valeur
}

function lireRang(ligne: LigneBrute, champ: string, fichier: string, i: number): number | null {
  const valeur = ligne[champ]
  exiger(estRang(valeur), fichier, i, `« ${champ} » doit être un rang dans [0,1] ou null`)
  return valeur
}

/** The reference table: unique territoires, real names, the EPCI ladder. */
export function validerTerritoires(brut: unknown, fichier: string): Territoire[] {
  exiger(Array.isArray(brut), fichier, 0, 'la table de référence doit être un tableau')
  const lignes = brut as unknown[]
  const vus = new Set<string>()

  const territoires = lignes.map((ligne, i) => {
    const ligneIndexee = i + 1
    exiger(estObjet(ligne), fichier, ligneIndexee, 'chaque ligne doit être un objet')

    const territoire = lireChaine(ligne, 'territoire', fichier, ligneIndexee)
    exiger(!vus.has(territoire), fichier, ligneIndexee, `territoire en double « ${territoire} »`)
    vus.add(territoire)

    const type = lireType(ligne, fichier, ligneIndexee)
    const nom = lireChaine(ligne, 'nom', fichier, ligneIndexee)
    exiger(nom.length > 0, fichier, ligneIndexee, 'un territoire sans nom')

    const departement = ligne['departement']
    exiger(
      departement === null || estChaine(departement),
      fichier,
      ligneIndexee,
      '« departement » doit être une chaîne ou null',
    )

    const epci = ligne['epci']
    exiger(epci === null || estChaine(epci), fichier, ligneIndexee, '« epci » doit être une chaîne ou null')

    // La colonne epci est le miroir de departement : une commune porte son
    // EPCI (SIREN), les EPCIs / départements / région portent null.
    if (type === 'commune') {
      exiger(estChaine(epci), fichier, ligneIndexee, `la commune « ${territoire} » n'a pas d'EPCI`)
    } else {
      exiger(epci === null, fichier, ligneIndexee, `« ${territoire} » (${type}) porte un EPCI`)
    }

    return { territoire, type, nom, departement, epci }
  })

  // Intégrité référentielle de l'échelle (compute.R 5bis) : chaque EPCI porté
  // par une commune est un territoire EPCI de la référence — sinon le
  // contexte switcher (commune → EPCI → département → région) casse.
  const epcis = new Set(
    territoires.filter((t) => t.type === 'epci').map((t) => t.territoire),
  )
  for (const t of territoires) {
    if (t.type === 'commune' && t.epci !== null && !epcis.has(t.epci)) {
      throw erreur(fichier, 0, `l'EPCI « ${t.epci} » de la commune « ${t.territoire} » est inconnu de la référence`)
    }
  }

  return territoires
}

function indexerReference(territoires: Territoire[]): Map<string, TerritoireType> {
  const index = new Map<string, TerritoireType>()
  for (const t of territoires) index.set(t.territoire, t.type)
  return index
}

function verifierReference(
  ligne: LigneBrute,
  reference: Map<string, TerritoireType>,
  fichier: string,
  i: number,
): void {
  const territoire = ligne['territoire']
  exiger(estChaine(territoire), fichier, i, '« territoire » doit être une chaîne')
  exiger(reference.has(territoire), fichier, i, `territoire inconnu « ${territoire} »`)
  const type = ligne['type'] as unknown
  exiger(
    estUneDe(type, TYPES_TERRITOIRE) && reference.get(territoire) === type,
    fichier,
    i,
    `« type » incohérent avec la référence pour « ${territoire} »`,
  )
}

/** The indicateurs facts table. */
export function validerIndicateurs(
  brut: unknown,
  fichier: string,
  territoires: Territoire[],
): Indicateur[] {
  exiger(Array.isArray(brut), fichier, 0, 'la table des indicateurs doit être un tableau')
  const lignes = brut as unknown[]
  const reference = indexerReference(territoires)
  const vus = new Set<string>()

  return lignes.map((ligne, i) => {
    const ligneIndexee = i + 1
    exiger(estObjet(ligne), fichier, ligneIndexee, 'chaque ligne doit être un objet')
    verifierReference(ligne, reference, fichier, ligneIndexee)

    const territoire = ligne['territoire'] as string
    const type = lireType(ligne, fichier, ligneIndexee)
    const theme = lireTheme(ligne, fichier, ligneIndexee)
    const key = lireChaine(ligne, 'key', fichier, ligneIndexee)

    const detail = ligne['detail']
    exiger(detail === null || estChaine(detail), fichier, ligneIndexee, '« detail » doit être une chaîne ou null')

    const cle = `${territoire}\u0000${key}\u0000${detail ?? ''}`
    exiger(!vus.has(cle), fichier, ligneIndexee, `ligne en double (territoire × key × detail) pour « ${key} » de « ${territoire} »`)
    vus.add(cle)

    const value = ligne['value']
    exiger(estValeur(value), fichier, ligneIndexee, '« value » doit être un nombre ou null')
    const unit = lireChaine(ligne, 'unit', fichier, ligneIndexee)

    const rang_epci = lireRang(ligne, 'rang_epci', fichier, ligneIndexee)
    const rang_dep = lireRang(ligne, 'rang_dep', fichier, ligneIndexee)
    const rang_reg = lireRang(ligne, 'rang_reg', fichier, ligneIndexee)

    const vintage_source = lireChaine(ligne, 'vintage_source', fichier, ligneIndexee)
    const vintage_version = lireChaine(ligne, 'vintage_version', fichier, ligneIndexee)
    const vintage_date_reference = ligne['vintage_date_reference']
    const vintage_date_publication = ligne['vintage_date_publication']
    exiger(
      estDateIso(vintage_date_reference),
      fichier,
      ligneIndexee,
      '« vintage_date_reference » doit être une date ISO (AAAA-MM-JJ)',
    )
    exiger(
      estDateIso(vintage_date_publication),
      fichier,
      ligneIndexee,
      '« vintage_date_publication » doit être une date ISO (AAAA-MM-JJ)',
    )

    return {
      territoire,
      type,
      theme,
      key,
      detail,
      value,
      unit,
      rang_epci,
      rang_dep,
      rang_reg,
      vintage_source,
      vintage_version,
      vintage_date_reference,
      vintage_date_publication,
    }
  })
}

/** The histoires (Story) facts table. */
export function validerHistoires(
  brut: unknown,
  fichier: string,
  territoires: Territoire[],
): Histoire[] {
  exiger(Array.isArray(brut), fichier, 0, 'la table des histoires doit être un tableau')
  const lignes = brut as unknown[]
  const reference = indexerReference(territoires)
  const vus = new Set<string>()

  return lignes.map((ligne, i) => {
    const ligneIndexee = i + 1
    exiger(estObjet(ligne), fichier, ligneIndexee, 'chaque ligne doit être un objet')
    verifierReference(ligne, reference, fichier, ligneIndexee)

    const territoire = ligne['territoire'] as string
    exiger(!vus.has(territoire), fichier, ligneIndexee, `plusieurs histoires pour « ${territoire} »`)
    vus.add(territoire)

    const type = lireType(ligne, fichier, ligneIndexee)
    const theme = lireTheme(ligne, fichier, ligneIndexee)
    const story_key = lireChaine(ligne, 'story_key', fichier, ligneIndexee)

    const solde_naturel = ligne['solde_naturel']
    const solde_migratoire = ligne['solde_migratoire']
    exiger(estNombre(solde_naturel), fichier, ligneIndexee, '« solde_naturel » doit être un nombre')
    exiger(estNombre(solde_migratoire), fichier, ligneIndexee, '« solde_migratoire » doit être un nombre')

    const classification = lireChaine(ligne, 'classification', fichier, ligneIndexee)

    return {
      territoire,
      type,
      theme,
      story_key,
      solde_naturel,
      solde_migratoire,
      classification,
    }
  })
}

/** The apercu basic-stats table (ADR-0007). */
export function validerApercu(
  brut: unknown,
  fichier: string,
  territoires: Territoire[],
): ApercuRow[] {
  exiger(Array.isArray(brut), fichier, 0, 'la table apercu doit être un tableau')
  const lignes = brut as unknown[]
  const reference = indexerReference(territoires)
  const vus = new Set<string>()

  return lignes.map((ligne, i) => {
    const ligneIndexee = i + 1
    exiger(estObjet(ligne), fichier, ligneIndexee, 'chaque ligne doit être un objet')
    verifierReference(ligne, reference, fichier, ligneIndexee)

    const territoire = ligne['territoire'] as string
    const type = lireType(ligne, fichier, ligneIndexee)
    const key = lireChaine(ligne, 'key', fichier, ligneIndexee)

    const cle = `${territoire}\u0000${key}`
    exiger(!vus.has(cle), fichier, ligneIndexee, `ligne en double (territoire × key) pour « ${key} » de « ${territoire} »`)
    vus.add(cle)

    const value = ligne['value']
    exiger(estValeur(value), fichier, ligneIndexee, '« value » doit être un nombre ou null')
    const unit = lireChaine(ligne, 'unit', fichier, ligneIndexee)

    return { territoire, type, key, value, unit }
  })
}

/** The run report (CONTEXT.md §Run report) — null when absent. */
export function validerRapportRun(brut: unknown, fichier: string): RunReport | null {
  if (brut === null) return null
  exiger(estObjet(brut), fichier, 0, 'le rapport de run doit être un objet ou null')

  const mode = lireChaine(brut, 'mode', fichier, 0)
  const timestamp = lireChaine(brut, 'timestamp', fichier, 0)

  exiger(Array.isArray(brut['statuts']), fichier, 0, '« statuts » doit être un tableau')
  const statuts = (brut['statuts'] as unknown[]).map((ligne, i) => {
    const ligneIndexee = i + 1
    exiger(estObjet(ligne), fichier, ligneIndexee, 'chaque statut doit être un objet')
    const id = lireChaine(ligne, 'id', fichier, ligneIndexee)
    const modeSource = ligne['mode']
    const status = ligne['status']
    exiger(estUneDe(modeSource, MODES_SOURCE), fichier, ligneIndexee, `« mode » inconnu « ${String(modeSource)} »`)
    exiger(estUneDe(status, STATUTS_SOURCE), fichier, ligneIndexee, `« status » inconnu « ${String(status)} »`)
    return { id, mode: modeSource, status }
  })

  return { mode, timestamp, statuts }
}

/**
 * Assemble + validate a complete payload from the raw documents (the JSON
 * projections as fetched). The loader merges per-theme facts files before
 * calling this; per-file error attribution lives in the loader.
 */
export function parsePayload(documents: {
  territoires: unknown
  indicateurs: unknown
  histoires: unknown
  apercu: unknown
  runReport: unknown
}): Payload {
  const territoires = validerTerritoires(documents.territoires, 'territoires.json')
  const indicateurs = validerIndicateurs(documents.indicateurs, 'indicateurs', territoires)
  const histoires = validerHistoires(documents.histoires, 'histoires', territoires)
  const apercu = validerApercu(documents.apercu, 'apercu.json', territoires)
  const runReport = validerRapportRun(documents.runReport, 'run-report.json')

  return { territoires, indicateurs, histoires, apercu, runReport }
}
