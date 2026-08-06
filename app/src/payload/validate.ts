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
 * - vintages: the shared source table, one row per dataset — two ISO dates or
 *   null (base roulante / pas encore mise en ligne), like vintage_date_*
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
  HistoireMobiliteVingtMinutes,
  Indicateur,
  Payload,
  RunReport,
  StatutRun,
  Territoire,
  TerritoireType,
  Theme,
  Vintage,
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

/** Les story_keys du thème Économie (issue #120) — la spécialisation top-5 et la lecture de structure régionale. */
const CLES_HISTOIRES_ECONOMIE = [
  'ce-que-la-commune-abrite',
  'ce-que-la-bretagne-abrite',
] as const

/** Les story_keys du thème Mobilité (issue #142, ADR-0012) — le défaut toujours allumé et la saillance vélo. */
const CLES_HISTOIRES_MOBILITE = [
  'vingt-minutes-sans-voiture',
  'ce-que-le-velo-preserve',
] as const

/** Les classifications de saillance du flagship (theme_mobilite.R — la règle du delta réel). */
const CLASSIFICATIONS_SAILLANCE = ['saillant', 'notable', 'non-saillant'] as const

/** Les 20 champs précalculés de la signature de distribution (dens_1..10 + dec_1..10). */
type SignatureDistribution = Pick<
  HistoireMobiliteVingtMinutes,
  | 'dens_1' | 'dens_2' | 'dens_3' | 'dens_4' | 'dens_5'
  | 'dens_6' | 'dens_7' | 'dens_8' | 'dens_9' | 'dens_10'
  | 'dec_1' | 'dec_2' | 'dec_3' | 'dec_4' | 'dec_5'
  | 'dec_6' | 'dec_7' | 'dec_8' | 'dec_9' | 'dec_10'
>

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
    // EPCI (SIREN) — sauf les trois îles sans EPCI (22016, 29083, 29155, fix
    // « Sans objet », issue #131) — et les EPCIs / départements / région
    // portent null. L'intégrité référentielle de l'échelle reste verrouillée
    // plus bas : un SIREN porté doit être un territoire EPCI de la référence.
    if (type !== 'commune') {
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
    // La date de référence est null pour une base roulante (DPE — ADR-0009,
    // spec #12 : date_reference NA, date_publication = date du pull).
    exiger(
      vintage_date_reference === null || estDateIso(vintage_date_reference),
      fichier,
      ligneIndexee,
      '« vintage_date_reference » doit être une date ISO (AAAA-MM-JJ) ou null',
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

/** The histoires (Story) facts table — per-theme shape (types.ts). */
export function validerHistoires(
  brut: unknown,
  fichier: string,
  territoires: Territoire[],
): Histoire[] {
  exiger(Array.isArray(brut), fichier, 0, 'la table des histoires doit être un tableau')
  const lignes = brut as unknown[]
  const reference = indexerReference(territoires)
  const vus = new Set<string>()
  // Les groupes (territoire × story_key) de l'Économie — le top-5 multi-lignes.
  const groupes = new Map<string, Set<number>>()
  // La Mobilité est multi-lignes par territoire (défaut + saillance vélo) —
  // une ligne par (territoire × story_key), jamais deux.
  const groupesMobilite = new Set<string>()

  return lignes.map((ligne, i) => {
    const ligneIndexee = i + 1
    exiger(estObjet(ligne), fichier, ligneIndexee, 'chaque ligne doit être un objet')
    verifierReference(ligne, reference, fichier, ligneIndexee)

    const territoire = ligne['territoire'] as string
    const type = lireType(ligne, fichier, ligneIndexee)
    const theme = lireTheme(ligne, fichier, ligneIndexee)
    const story_key = lireChaine(ligne, 'story_key', fichier, ligneIndexee)

    // L'Économie est MULTI-LIGNES (issue #120) : le top-5 par (territoire ×
    // story_key) — l'invariant « une ligne par territoire » meurt pour ce
    // thème (le même relâchement que la LQ côté R), il reste en vigueur pour
    // Démographie / Habitat (plus bas).
    if (theme === 'economie') return lireHistoireEconomie(ligne, { territoire, type, theme, story_key }, ligneIndexee, fichier, groupes)

    // La Mobilité est multi-lignes AUSSI (issue #142) : le défaut toujours
    // allumé + la saillance vélo quand le delta est réel — l'invariant devient
    // « une ligne par (territoire × story_key) », jamais deux.
    if (theme === 'mobilite') return lireHistoireMobilite(ligne, { territoire, type, theme, story_key }, ligneIndexee, fichier, groupesMobilite)

    // Démographie / Habitat : une ligne par territoire, jamais deux.
    exiger(!vus.has(territoire), fichier, ligneIndexee, `plusieurs histoires pour « ${territoire} »`)
    vus.add(territoire)

    // La forme du Story est spécifique au thème (le contrat R) : Démographie
    // porte les deux soldes et leurs taux annuels (ADR-0011), Habitat les
    // parts de lecture du parc.
    if (theme === 'demographie') {
      const solde_naturel = ligne['solde_naturel']
      const solde_migratoire = ligne['solde_migratoire']
      const taux_solde_naturel = ligne['taux_solde_naturel']
      const taux_solde_migratoire = ligne['taux_solde_migratoire']
      exiger(estNombre(solde_naturel), fichier, ligneIndexee, '« solde_naturel » doit être un nombre')
      exiger(estNombre(solde_migratoire), fichier, ligneIndexee, '« solde_migratoire » doit être un nombre')
      exiger(estNombre(taux_solde_naturel), fichier, ligneIndexee, '« taux_solde_naturel » doit être un nombre')
      exiger(estNombre(taux_solde_migratoire), fichier, ligneIndexee, '« taux_solde_migratoire » doit être un nombre')
      const classification = lireChaine(ligne, 'classification', fichier, ligneIndexee)
      // La période est OPTIONNELLE : le pipeline ne la publie pas encore
      // (issue #113) — absente, le titre reste non daté (honnête).
      const periode = estChaine(ligne['periode']) ? (ligne['periode'] as string) : null
      return {
        territoire,
        type,
        theme,
        story_key,
        solde_naturel,
        solde_migratoire,
        taux_solde_naturel,
        taux_solde_migratoire,
        classification,
        periode,
      }
    }

    if (theme === 'habitat') {
      // La classification et les parts sont null sous le seuil de suppression
      // n < 30 (le n, lui, est publié — test-histoires-habitat.R).
      const classification = ligne['classification']
      exiger(
        classification === null || estChaine(classification),
        fichier,
        ligneIndexee,
        '« classification » doit être une chaîne ou null',
      )
      const part_passoires = ligne['part_passoires']
      const part_abc = ligne['part_abc']
      const n_dpe = ligne['n_dpe']
      exiger(estValeur(part_passoires), fichier, ligneIndexee, '« part_passoires » doit être un nombre ou null')
      exiger(estValeur(part_abc), fichier, ligneIndexee, '« part_abc » doit être un nombre ou null')
      exiger(estNombre(n_dpe), fichier, ligneIndexee, '« n_dpe » doit être un nombre')
      return {
        territoire,
        type,
        theme,
        story_key,
        classification,
        part_passoires,
        part_abc,
        n_dpe,
      }
    }

    // Un thème sans Story construite ne publie pas d'histoires (le loader 404
    // sur histoires_<theme>.json) — une ligne ici est une dérive du contrat.
    throw erreur(fichier, ligneIndexee, `Story du thème « ${theme} » inconnue de l'app`)
  })
}

/** Une ligne d'Histoire Économie (issue #120) — le top-5 par (territoire × story_key). */
function lireHistoireEconomie(
  ligne: LigneBrute,
  entete: { territoire: string; type: TerritoireType; theme: 'economie'; story_key: string },
  ligneIndexee: number,
  fichier: string,
  groupes: Map<string, Set<number>>,
): Histoire {
  const { territoire, type, theme, story_key } = entete

  // Une story_key inconnue du thème est une dérive — la lecture n'existe pas.
  exiger(
    estUneDe(story_key, CLES_HISTOIRES_ECONOMIE),
    fichier,
    ligneIndexee,
    `Story Économie « ${story_key} » inconnue du contrat`,
  )

  const rang = ligne['rang']
  exiger(
    estNombre(rang) && Number.isInteger(rang) && rang >= 1 && rang <= 5,
    fichier,
    ligneIndexee,
    '« rang » d\u2019une Story Économie doit être un entier de 1 à 5',
  )

  // Le groupe (territoire × story_key) : rangs uniques — le top-5 ne publie
  // jamais deux fois le même rang. Le plafond de 5 lignes est porté par la
  // contrainte rang ∈ 1..5 (une sixième ligne serait un rang hors contrat).
  const cleGroupe = `${territoire}\u0000${story_key}`
  const groupe = groupes.get(cleGroupe)
  if (groupe) {
    exiger(!groupe.has(rang), fichier, ligneIndexee, `rang « ${rang} » en double pour « ${territoire} » (${story_key})`)
    groupe.add(rang)
  } else {
    groupes.set(cleGroupe, new Set([rang]))
  }

  const activity_code = lireChaine(ligne, 'activity_code', fichier, ligneIndexee)
  // Le label d'activité vient TOUJOURS du payload (activity_label) — jamais
  // codé en dur dans l'app (CONTEXT.md « Ce que la commune abrite »).
  const activity_label = lireChaine(ligne, 'activity_label', fichier, ligneIndexee)
  exiger(activity_label.length > 0, fichier, ligneIndexee, '« activity_label » vide')

  const n = ligne['n']
  exiger(estNombre(n), fichier, ligneIndexee, '« n » doit être un nombre')

  const lq = ligne['lq']
  const part_parc = ligne['part_parc']
  exiger(estValeur(lq), fichier, ligneIndexee, '« lq » doit être un nombre ou null')
  exiger(estValeur(part_parc), fichier, ligneIndexee, '« part_parc » doit être un nombre ou null')
  if (story_key === 'ce-que-la-commune-abrite') {
    // La lecture de spécialisation EST le LQ — une ligne sans quotient est
    // une dérive du contrat (jamais de Story spécialisation sans sa matière).
    exiger(estNombre(lq), fichier, ligneIndexee, '« lq » doit être un nombre pour ce-que-la-commune-abrite')
  } else {
    // La lecture de structure EST la part du parc — idem pour la région.
    exiger(estNombre(part_parc), fichier, ligneIndexee, '« part_parc » doit être un nombre pour ce-que-la-bretagne-abrite')
  }

  // Les estampilles vintage des Stories : deux dates ISO + source/version,
  // comme les indicateurs (issue #74 — la Story cite SA source, jamais
  // inventée). La référence est null pour une base roulante (ADR-0009).
  const vintage_source = lireChaine(ligne, 'vintage_source', fichier, ligneIndexee)
  const vintage_version = lireChaine(ligne, 'vintage_version', fichier, ligneIndexee)
  const vintage_date_reference = ligne['vintage_date_reference']
  const vintage_date_publication = ligne['vintage_date_publication']
  exiger(
    vintage_date_reference === null || estDateIso(vintage_date_reference),
    fichier,
    ligneIndexee,
    '« vintage_date_reference » doit être une date ISO (AAAA-MM-JJ) ou null',
  )
  exiger(
    estDateIso(vintage_date_publication),
    fichier,
    ligneIndexee,
    '« vintage_date_publication » doit être une date ISO (AAAA-MM-JJ)',
  )

  // La forme discriminée : chaque story_key retourne SA ligne de contrat. Les
  // exiger ci-dessus valident la matière (lq nombre pour la spécialisation,
  // part_parc nombre pour la structure) — une garde assert ne narrowing pas le
  // type, les champs sont resserrés ici.
  if (story_key === 'ce-que-la-commune-abrite') {
    return {
      territoire,
      type,
      theme,
      story_key,
      rang,
      activity_code,
      activity_label,
      lq: lq as number,
      n,
      part_parc,
      vintage_source,
      vintage_version,
      vintage_date_reference,
      vintage_date_publication,
    }
  }
  return {
    territoire,
    type,
    theme,
    story_key,
    rang,
    activity_code,
    activity_label,
    lq,
    n,
    part_parc: part_parc as number,
    vintage_source,
    vintage_version,
    vintage_date_reference,
    vintage_date_publication,
  }
}

/**
 * Une ligne d'Histoire Mobilité (issue #142, ADR-0012) — le défaut
 * « vingt-minutes-sans-voiture » (div_loss_t + la signature de distribution)
 * et la saillance « ce-que-le-velo-preserve » (le delta seul). L'estampille
 * snapshot est portée par chaque ligne comme l'Économie (issue #74) — la Story
 * cite SA source, la date d'instantané comme référence.
 */
function lireHistoireMobilite(
  ligne: LigneBrute,
  entete: { territoire: string; type: TerritoireType; theme: 'mobilite'; story_key: string },
  ligneIndexee: number,
  fichier: string,
  groupes: Set<string>,
): Histoire {
  const { territoire, type, theme, story_key } = entete

  exiger(
    estUneDe(story_key, CLES_HISTOIRES_MOBILITE),
    fichier,
    ligneIndexee,
    `Story Mobilité « ${story_key} » inconnue du contrat`,
  )

  const cleGroupe = `${territoire}\u0000${story_key}`
  exiger(
    !groupes.has(cleGroupe),
    fichier,
    ligneIndexee,
    `plusieurs Story « ${story_key} » pour « ${territoire} »`,
  )
  groupes.add(cleGroupe)

  const div_loss_t = ligne['div_loss_t']
  const div_loss_b = ligne['div_loss_b']
  const delta = ligne['delta']
  exiger(
    estNombre(div_loss_t) && div_loss_t >= 0,
    fichier,
    ligneIndexee,
    '« div_loss_t » doit être un nombre non négatif',
  )
  exiger(
    estNombre(div_loss_b) && div_loss_b >= 0,
    fichier,
    ligneIndexee,
    '« div_loss_b » doit être un nombre non négatif',
  )
  exiger(
    estNombre(delta) && delta >= 0,
    fichier,
    ligneIndexee,
    '« delta » doit être un nombre non négatif',
  )

  const classification_saillance = lireChaine(
    ligne,
    'classification_saillance',
    fichier,
    ligneIndexee,
  )
  exiger(
    estUneDe(classification_saillance, CLASSIFICATIONS_SAILLANCE),
    fichier,
    ligneIndexee,
    `« classification_saillance » doit être l'un de ${CLASSIFICATIONS_SAILLANCE.join(' | ')}, reçu « ${String(classification_saillance)} »`,
  )

  const vintage_source = lireChaine(ligne, 'vintage_source', fichier, ligneIndexee)
  const vintage_version = lireChaine(ligne, 'vintage_version', fichier, ligneIndexee)
  const vintage_date_reference = ligne['vintage_date_reference']
  const vintage_date_publication = ligne['vintage_date_publication']
  exiger(
    vintage_date_reference === null || estDateIso(vintage_date_reference),
    fichier,
    ligneIndexee,
    '« vintage_date_reference » doit être une date ISO (AAAA-MM-JJ) ou null',
  )
  exiger(
    estDateIso(vintage_date_publication),
    fichier,
    ligneIndexee,
    '« vintage_date_publication » doit être une date ISO (AAAA-MM-JJ)',
  )

  const estampille = { vintage_source, vintage_version, vintage_date_reference, vintage_date_publication }

  // La saillance ne se déclenche que sur le delta réel — une Story vélo sans
  // classification « saillant » est une dérive du contrat (theme_mobilite.R).
  if (story_key === 'ce-que-le-velo-preserve') {
    exiger(
      classification_saillance === 'saillant',
      fichier,
      ligneIndexee,
      'une Story « ce-que-le-velo-preserve » sans saillance « saillant »',
    )
    return {
      territoire,
      type,
      theme,
      story_key,
      div_loss_t: div_loss_t as number,
      div_loss_b: div_loss_b as number,
      delta: delta as number,
      classification_saillance: classification_saillance as 'saillant',
      ...estampille,
    }
  }

  const pct_iso_full_t = ligne['pct_iso_full_t']
  exiger(
    estValeur(pct_iso_full_t),
    fichier,
    ligneIndexee,
    '« pct_iso_full_t » doit être un nombre ou null',
  )
  const dens_min = ligne['dens_min']
  const dens_max = ligne['dens_max']
  exiger(estValeur(dens_min), fichier, ligneIndexee, '« dens_min » doit être un nombre ou null')
  exiger(estValeur(dens_max), fichier, ligneIndexee, '« dens_max » doit être un nombre ou null')

  // La signature de distribution — les 10 densités et les 10 bornes de déciles
  // (la leçon de l'issue #131 : JAMAIS la matrice, seulement les précalculés).
  // Le trou du portage (Brest Métropole) porte NA — jamais une valeur inventée.
  const signature = {} as SignatureDistribution
  for (const famille of ['dens', 'dec'] as const) {
    for (let k = 1; k <= 10; k++) {
      const champ = `${famille}_${k}` as keyof SignatureDistribution
      const valeur = ligne[champ]
      exiger(
        estValeur(valeur),
        fichier,
        ligneIndexee,
        `« ${champ} » doit être un nombre ou null`,
      )
      signature[champ] = valeur as number | null
    }
  }

  return {
    territoire,
    type,
    theme,
    story_key,
    div_loss_t: div_loss_t as number,
    div_loss_b: div_loss_b as number,
    delta: delta as number,
    pct_iso_full_t,
    dens_min,
    dens_max,
    ...signature,
    classification_saillance,
    ...estampille,
  }
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
 * The shared vintage table (vintages.json) — one row per dataset of the run.
 * Optional (404 → null), like the run report: the story blocks read it to
 * cite THEIR datasets, but a payload without it still renders (no invented
 * sourcing — the source line simply doesn't show).
 */
export function validerVintages(brut: unknown, fichier: string): Vintage[] | null {
  if (brut === null) return null
  exiger(Array.isArray(brut), fichier, 0, 'la table des vintages doit être un tableau')
  return (brut as unknown[]).map((ligne, i) => {
    const ligneIndexee = i + 1
    exiger(estObjet(ligne), fichier, ligneIndexee, 'chaque vintage doit être un objet')
    const id = lireChaine(ligne, 'id', fichier, ligneIndexee)
    const source = lireChaine(ligne, 'source', fichier, ligneIndexee)
    const version = lireChaine(ligne, 'version', fichier, ligneIndexee)
    const licence = lireChaine(ligne, 'licence', fichier, ligneIndexee)
    const dateReference = ligne['date_reference']
    const datePublication = ligne['date_publication']
    // Les deux dates sont ISO ou null (date_publication null = pas encore
    // mise en ligne, date_reference null = base roulante) — le même traitement
    // que vintage_date_* des indicateurs (ADR-0009).
    exiger(
      dateReference === null || estDateIso(dateReference),
      fichier,
      ligneIndexee,
      '« date_reference » doit être une date ISO (AAAA-MM-JJ) ou null',
    )
    exiger(
      datePublication === null || estDateIso(datePublication),
      fichier,
      ligneIndexee,
      '« date_publication » doit être une date ISO (AAAA-MM-JJ) ou null',
    )
    return { id, source, version, licence, date_reference: dateReference, date_publication: datePublication }
  })
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
  vintages?: unknown
}): Payload {
  const territoires = validerTerritoires(documents.territoires, 'territoires.json')
  const indicateurs = validerIndicateurs(documents.indicateurs, 'indicateurs', territoires)
  const histoires = validerHistoires(documents.histoires, 'histoires', territoires)
  const apercu = validerApercu(documents.apercu, 'apercu.json', territoires)
  const runReport = validerRapportRun(documents.runReport, 'run-report.json')
  const vintages = validerVintages(documents.vintages ?? null, 'vintages.json')

  return { territoires, indicateurs, histoires, apercu, runReport, vintages }
}
