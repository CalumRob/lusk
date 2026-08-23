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
  HistoireEconomie,
  HistoireMobilite,
  Indicateur,
  MembreProgramme,
  NoeudTexteRiche,
  Payload,
  ProgrammesPayload,
  RaisonSaillance,
  RunReport,
  SigleProgramme,
  StatutRun,
  SubventionProgramme,
  Territoire,
  TerritoireType,
  Theme,
  ThemeMetadata,
  IndicatorPageMetadataBase,
  TrajectoryMetadata,
  CompositionMetadata,
  DistributionMetadata,
  RelationshipMetadata,
  ListMetadata,
  PyramidMetadata,
  ComparisonBarsMetadata,
  FamilleFigure,
  Vintage,
  Sexe,
} from './types'
import {
  CLES_HISTOIRES_PAR_THEME,
  FAMILLES_FIGURE,
  GROUPES_PAR_STORY,
  RAISONS_SAILLANCE,
  SIGLES_PROGRAMMES,
  THEMES_CANONIQUES,
  TYPES_NOEUD_TEXTE_RICHE,
} from './types'

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

/**
 * Les deux sexes du contrat éclaté par sexe (issue #390) — jamais « _T » (le
 * total n'est pas une ligne : il se lit en sommant F + M).
 */
export const SEXES_INDICATEUR: readonly Sexe[] = ['F', 'M']

/**
 * Les SEPT tranches d'âge FIXES de la structure par âge (issue #390) — le
 * contrat, pas une observation. La validation exige exactement ces sept
 * tranches × {F, M} = 14 lignes par territoire : les tranches attendues ne sont
 * JAMAIS dérivées de ce que le payload porte, sinon une tranche entièrement
 * absente (les deux sexes manquants) passerait inaperçue et la pyramide se
 * dessinerait avec un étage en moins, sans un mot.
 */
export const TRANCHES_STRUCTURE_AGE: readonly string[] = [
  '<15',
  '15-24',
  '25-39',
  '40-54',
  '55-64',
  '65-79',
  '80+',
]

/** La clé de l'indicateur éclaté par sexe dont le contrat est FIXE (issue #390). */
const CLE_STRUCTURE_AGE = 'structure_age'

/** Les story_keys du thème Milieux (issue #174, ADR-0014) — la Story unique « Se densifier, s'étaler, ou s'en aller ». */
const CLES_HISTOIRES_MILIEUX = ['se-densifier-setaler-ou-sen-aller'] as const

/** Les classifications Milieux — les quatre lectures par signes (seuil 0, ADR-0014). */
const CLASSIFICATIONS_MILIEUX = [
  'grandir-en-se-densifiant',
  'grandir-en-setalant',
  'sen-aller-et-consommer-quand-meme',
  'les-departs-laissent-la-place-a-la-renaturation',
] as const

/** Les classifications de saillance du flagship (theme_mobilite.R — la règle du delta réel). */
const CLASSIFICATIONS_SAILLANCE = ['saillant', 'notable', 'non-saillant'] as const

/** Les 20 champs précalculés de la signature de distribution (dens_1..10 + dec_1..10). */
type SignatureDistribution = Pick<
  HistoireMobilite,
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

function estChaineNonVide(x: unknown): x is string { return estChaine(x) && x.length > 0 }

function estNombre(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x)
}

function estUneDe<T extends string>(x: unknown, valeurs: readonly T[]): x is T {
  return typeof x === 'string' && (valeurs as readonly string[]).includes(x)
}

/**
 * Un rang ordinal directionnel (ADR-0015) : 1 = meilleur, un entier ≥ 1 — ou
 * null (NA = pas de groupe de comparaison à ce niveau). Une fraction (le
 * percentile retiré du payload) ou un rang ≤ 0 est une dérive du contrat.
 */
function estRang(x: unknown): x is number | null {
  return x === null || (estNombre(x) && x >= 1 && Number.isInteger(x))
}

/** La taille du groupe de comparaison — le dénominateur du rang (entier ≥ 1). */
function estTailleGroupe(x: unknown): x is number | null {
  return x === null || (estNombre(x) && x >= 1 && Number.isInteger(x))
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

/**
 * Le sexe d'une ligne d'indicateur (issue #390) : « F », « M », ou null (ligne
 * non éclatée par sexe — le comportement historique). Toute autre valeur est
 * une dérive de contrat.
 */
function lireSexe(ligne: LigneBrute, fichier: string, i: number): Sexe | null {
  const valeur = ligne['sex']
  if (valeur === null || valeur === undefined) return null
  exiger(
    valeur === 'F' || valeur === 'M',
    fichier,
    i,
    `« sex » doit être « F », « M » ou null, reçu « ${String(valeur)} »`,
  )
  return valeur
}

function lireRang(ligne: LigneBrute, champ: string, fichier: string, i: number): number | null {
  const valeur = ligne[champ]
  exiger(estRang(valeur), fichier, i, `« ${champ} » doit être un rang ordinal (entier ≥ 1, 1 = meilleur) ou null`)
  return valeur
}

function lireTailleGroupe(
  ligne: LigneBrute,
  champ: string,
  fichier: string,
  i: number,
): number | null {
  const valeur = ligne[champ]
  exiger(estTailleGroupe(valeur), fichier, i, `« ${champ} » doit être la taille du groupe (entier ≥ 1) ou null`)
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

/** Un tableau de chaînes non vides, sans doublon — la forme des registres du contrat. */
function lireTableauChaines(ligne: LigneBrute, champ: string, fichier: string, i: number): string[] {
  const brut = ligne[champ]
  exiger(Array.isArray(brut), fichier, i, `« ${champ} » doit être un tableau`)
  const valeurs = brut as unknown[]
  const chaines = valeurs.map((v, j) => {
    exiger(
      estChaine(v) && (v as string).length > 0,
      fichier,
      i,
      `« ${champ} » : l'entrée ${j + 1} doit être une chaîne non vide`,
    )
    return v as string
  })
  exiger(
    new Set(chaines).size === chaines.length,
    fichier,
    i,
    `« ${champ} » : une entrée est en double`,
  )
  return chaines
}

/**
 * Un nœud du texte riche TYPÉ (parent #308) — la liste fermée
 * text | param | territoire | strong | link, jamais de HTML brut. Le
 * paramètre d'un nœud param doit être déclaré dans reading.params (le lien
 * résolu : la lecture ne cite que sa matière). Un lien ne peut pas en
 * contenir un autre.
 */
function validerNoeudTexteRiche(
  brut: unknown,
  fichier: string,
  params: string[],
  cleGroupe: string,
): NoeudTexteRiche {
  exiger(estObjet(brut), fichier, 0, `« ${cleGroupe} » : un nœud de texte riche doit être un objet`)
  const noeud = brut as LigneBrute
  const type = lireChaine(noeud, 'type', fichier, 0)
  exiger(
    estUneDe(type, TYPES_NOEUD_TEXTE_RICHE),
    fichier,
    0,
    `« ${cleGroupe} » : type de nœud « ${type} » hors contrat — attendu l'un de ${TYPES_NOEUD_TEXTE_RICHE.join(' | ')} (le HTML brut n'est pas un type de nœud)`,
  )
  if (type === 'text') {
    const content = lireChaine(noeud, 'content', fichier, 0)
    exiger(content.length > 0, fichier, 0, `« ${cleGroupe} » : un nœud text sans contenu`)
    exiger(
      !/[<>]/.test(content),
      fichier,
      0,
      `« ${cleGroupe} » : HTML brut interdit dans le contenu « ${content} »`,
    )
    return { type, content }
  }
  if (type === 'param') {
    const key = lireChaine(noeud, 'key', fichier, 0)
    exiger(
      params.includes(key),
      fichier,
      0,
      `« ${cleGroupe} » : le paramètre « ${key} » n'est pas déclaré dans reading.params`,
    )
    return { type, key }
  }
  if (type === 'territoire') return { type }
  // strong | link — des conteneurs à enfants non vides
  let href: string | undefined
  if (type === 'link') {
    const hrefBrut = noeud['href']
    exiger(
      estChaine(hrefBrut) && hrefBrut.length > 0,
      fichier,
      0,
      `« ${cleGroupe} » : un lien sans href`,
    )
    href = hrefBrut as string
  }
  exiger(Array.isArray(noeud['children']), fichier, 0, `« ${cleGroupe} » : un nœud ${type} sans enfants`)
  const enfants = noeud['children'] as unknown[]
  exiger(enfants.length > 0, fichier, 0, `« ${cleGroupe} » : un nœud ${type} sans enfants`)
  const children = enfants.map((enfant, j) => {
    if (estObjet(enfant) && (enfant as LigneBrute)['type'] === 'link') {
      throw erreur(fichier, 0, `« ${cleGroupe} » : un lien ne peut pas en contenir un autre (nœud ${type}, enfant ${j + 1})`)
    }
    return validerNoeudTexteRiche(enfant, fichier, params, cleGroupe)
  })
  if (type === 'link') return { type, href: href as string, children }
  return { type, children }
}

function validerTemplate(
  brut: unknown,
  fichier: string,
  params: string[],
  cleGroupe: string,
): NoeudTexteRiche[] {
  exiger(Array.isArray(brut), fichier, 0, `« ${cleGroupe} » : le template doit être un tableau`)
  const tableau = brut as unknown[]
  exiger(tableau.length > 0, fichier, 0, `« ${cleGroupe} » : le template de lecture est vide`)
  return tableau.map((noeud) => validerNoeudTexteRiche(noeud, fichier, params, cleGroupe))
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

  const result = lignes.map((ligne, i) => {
    const ligneIndexee = i + 1
    exiger(estObjet(ligne), fichier, ligneIndexee, 'chaque ligne doit être un objet')
    verifierReference(ligne, reference, fichier, ligneIndexee)

    const territoire = ligne['territoire'] as string
    const type = lireType(ligne, fichier, ligneIndexee)
    const theme = lireTheme(ligne, fichier, ligneIndexee)
    const key = lireChaine(ligne, 'key', fichier, ligneIndexee)

    const detail = ligne['detail']
    exiger(detail === null || estChaine(detail), fichier, ligneIndexee, '« detail » doit être une chaîne ou null')

    const dimension = ligne['dimension']
    exiger(dimension === undefined || dimension === null || estChaineNonVide(dimension), fichier, ligneIndexee, '« dimension » doit être une chaîne non vide ou null')

    const sex = lireSexe(ligne, fichier, ligneIndexee)

    // Unicité : territoire × key × detail × sex (issue #390 — la dimension sexe
    // entre dans la clé pour que les lignes F et M d'une même tranche soient
    // distinctes, jamais un doublon).
    const cle = `${territoire}\u0000${key}\u0000${detail ?? ''}\u0000${sex ?? ''}\u0000${dimension ?? ''}`
    exiger(!vus.has(cle), fichier, ligneIndexee, `ligne en double (territoire × key × detail × sex) pour « ${key} » de « ${territoire} »`)
    vus.add(cle)

    const value = ligne['value']
    exiger(estValeur(value), fichier, ligneIndexee, '« value » doit être un nombre ou null')
    const unit = lireChaine(ligne, 'unit', fichier, ligneIndexee)
    const rider = ligne['rider']
    exiger(rider === null || rider === undefined || estChaine(rider), fichier, ligneIndexee,
      '« rider » doit être une chaîne ou null')

    const rang_epci = lireRang(ligne, 'rang_epci', fichier, ligneIndexee)
    const rang_dep = lireRang(ligne, 'rang_dep', fichier, ligneIndexee)
    const rang_reg = lireRang(ligne, 'rang_reg', fichier, ligneIndexee)
    const rang_epci_n = lireTailleGroupe(ligne, 'rang_epci_n', fichier, ligneIndexee)
    const rang_dep_n = lireTailleGroupe(ligne, 'rang_dep_n', fichier, ligneIndexee)
    const rang_reg_n = lireTailleGroupe(ligne, 'rang_reg_n', fichier, ligneIndexee)

    // Le contrat ordinal (ADR-0015) : chaque rang porte la taille de SON groupe
    // (le « / Y » du rendu) — les deux présents ou absents ensemble, et un rang
    // ne dépasse jamais la taille de son groupe (competition ranking).
    for (const [colonne, taille] of [
      ['rang_epci', rang_epci_n],
      ['rang_dep', rang_dep_n],
      ['rang_reg', rang_reg_n],
    ] as const) {
      const position = ligne[colonne] as number | null
      if (position === null && taille !== null) {
        throw erreur(fichier, ligneIndexee, `« ${colonne} » est null mais « ${colonne}_n » est porté — le rang et sa taille vont ensemble`)
      }
      if (position !== null && (taille === null || position > taille)) {
        throw erreur(fichier, ligneIndexee, `« ${colonne} » (${position}) dépasse la taille de son groupe « ${colonne}_n » (${taille ?? 'null'})`)
      }
    }

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
      sex,
      dimension: dimension === undefined ? null : dimension,
      value,
      unit,
      rider: rider === undefined ? null : rider,
      rang_epci,
      rang_dep,
      rang_reg,
      rang_epci_n,
      rang_dep_n,
      rang_reg_n,
      vintage_source,
      vintage_version,
      vintage_date_reference,
      vintage_date_publication,
    }
  })

  // Issue #390 — intégrité de la dimension sexe. Deux niveaux :
  //   1. GÉNÉRIQUE : un groupe (territoire × key) ne mélange jamais des lignes
  //      sexuées et des lignes sans sexe — une clé est éclatée par sexe ou elle
  //      ne l'est pas ; la représentation mixte est un payload à moitié migré.
  //   2. FIXE pour la structure par âge : les SEPT tranches DÉCLARÉES du contrat
  //      × {F, M} = 14 lignes par territoire (ou, tant que le pipeline n'a pas
  //      republié, les sept tranches sans sexe — le repli hérité, strict lui
  //      aussi). Les tranches attendues sont le contrat, jamais une dérivation
  //      de ce qui est présent.
  verifierDimensionSexe(result, fichier)
  return result
}

/**
 * Vérifie la dimension sexe des indicateurs (issue #390), par groupe
 * (territoire × key) :
 *
 * - aucune représentation MIXTE (des lignes sexuées ET des lignes sans sexe
 *   dans le même groupe) — c'est un payload à moitié migré, pas une donnée ;
 * - pour la structure par âge, le contrat FIXE : les sept tranches déclarées ×
 *   {F, M}, chacune exactement une fois. Une tranche entièrement absente, un
 *   sexe manquant, une tranche inconnue ou une paire en double échouent fort ;
 * - pour toute AUTRE clé éclatée par sexe, le produit cartésien des détails
 *   observés × {F, M} doit être complet (garde de complétude minimale, faute de
 *   contrat déclaré pour cette clé).
 */
function verifierDimensionSexe(indicateurs: Indicateur[], fichier: string): void {
  const groupes = new Map<string, { territoire: string; key: string; lignes: Indicateur[] }>()
  for (const l of indicateurs) {
    const cle = `${l.territoire}\u0000${l.key}`
    const groupe = groupes.get(cle)
    if (groupe) groupe.lignes.push(l)
    else groupes.set(cle, { territoire: l.territoire, key: l.key, lignes: [l] })
  }

  for (const { territoire, key, lignes } of groupes.values()) {
    // La structure par âge a son contrat FIXE, déclaré — il se vérifie en entier
    // (tranches attendues comprises), pas seulement sur la dimension sexe.
    if (key === CLE_STRUCTURE_AGE) {
      verifierStructureAge(territoire, lignes, fichier)
      continue
    }

    const sexuees = lignes.filter((l) => l.sex !== null && l.sex !== undefined)
    const sansSexe = lignes.filter((l) => l.sex === null || l.sex === undefined)

    if (sexuees.length === 0) continue

    if (sansSexe.length > 0) {
      throw erreur(
        fichier,
        0,
        `indicateur « ${key} » de « ${territoire} » : représentation du sexe mixte — ` +
          `${sexuees.length} ligne(s) sexuée(s) et ${sansSexe.length} ligne(s) sans sexe ` +
          `dans le même groupe (une clé est éclatée par sexe, ou elle ne l'est pas)`,
      )
    }

    const paires = new Set(sexuees.map((l) => `${l.detail}\u0000${l.sex}`))
    for (const detail of new Set(sexuees.map((l) => l.detail))) {
      for (const sex of SEXES_INDICATEUR) {
        if (!paires.has(`${detail}\u0000${sex}`)) {
          throw erreur(
            fichier,
            0,
            `indicateur « ${key} » de « ${territoire} » : paire détail×sexe manquante ` +
              `(détail « ${detail} » × sexe « ${sex} »)`,
          )
        }
      }
    }
  }
}

/**
 * Le contrat de la structure par âge (issue #390). Les tranches attendues sont
 * TOUJOURS les sept tranches déclarées (TRANCHES_STRUCTURE_AGE) — jamais une
 * dérivation de ce que le payload porte : c'est ce qui permet d'attraper une
 * tranche ENTIÈREMENT absente (ses deux sexes manquants), qu'une validation
 * dérivée laisserait passer sans un mot.
 *
 * Deux formes sont acceptées, et rien d'autre :
 *
 * 1. la forme ÉCLATÉE PAR SEXE (le contrat #390) — les sept tranches × {F, M},
 *    chacune exactement une fois : 14 lignes par territoire ;
 * 2. la forme HÉRITÉE (pré-#390) — les sept tranches, aucune sexuée : 7 lignes
 *    par territoire. Le payload committé est encore dans cette forme : le
 *    pipeline ne l'a pas republié (cela demande la source réelle complète). Le
 *    repli hérité est celui que l'issue #390 prévoit explicitement, « jusqu'à ce
 *    que cette issue atterrisse ». Il reste STRICT sur les sept tranches : une
 *    tranche manquante ou en double échoue dans cette forme aussi.
 *
 * Dès qu'UNE ligne porte un sexe, la forme #390 s'applique en entier — une
 * représentation mixte (des lignes sexuées ET des lignes sans sexe) est un
 * payload à moitié migré, refusé.
 */
function verifierStructureAge(
  territoire: string,
  lignes: readonly Indicateur[],
  fichier: string,
): void {
  const prefixe = `indicateur « ${CLE_STRUCTURE_AGE} » de « ${territoire} »`
  const sexuees = lignes.filter((l) => l.sex !== null && l.sex !== undefined)
  const sansSexe = lignes.filter((l) => l.sex === null || l.sex === undefined)

  // Les tranches du contrat, dans les deux formes : une tranche hors contrat est
  // une dérive, pas un étage bonus.
  for (const ligne of lignes) {
    if (!TRANCHES_STRUCTURE_AGE.includes(ligne.detail as string)) {
      throw erreur(
        fichier,
        0,
        `${prefixe} : tranche d'âge hors contrat « ${String(ligne.detail)} » ` +
          `(attendues : ${TRANCHES_STRUCTURE_AGE.join(', ')})`,
      )
    }
  }

  // Forme HÉRITÉE (pré-#390) : les sept tranches, aucune sexuée — strict sur les
  // tranches (manquante / en double), le sexe n'est simplement pas encore publié.
  if (sexuees.length === 0) {
    verifierCartesienStructureAge(prefixe, lignes, [null], fichier)
    return
  }

  // Représentation MIXTE : refusée — une clé est éclatée par sexe, ou elle ne
  // l'est pas.
  if (sansSexe.length > 0) {
    throw erreur(
      fichier,
      0,
      `${prefixe} : représentation du sexe mixte — ${sexuees.length} ligne(s) sexuée(s) ` +
        `et ${sansSexe.length} ligne(s) sans sexe (la structure par âge est éclatée ` +
        `par sexe « F » / « M », ou elle ne l'est pas)`,
    )
  }

  // Forme ÉCLATÉE PAR SEXE (le contrat #390) : 7 tranches × {F, M} = 14 lignes.
  verifierCartesienStructureAge(prefixe, lignes, SEXES_INDICATEUR, fichier)
}

/**
 * Le produit cartésien FIXE tranches × sexes de la structure par âge : chaque
 * paire attendue exactement une fois, et aucune ligne en trop. `sexes` vaut
 * {F, M} (le contrat #390) ou [null] (la forme héritée, sans sexe publié).
 */
function verifierCartesienStructureAge(
  prefixe: string,
  lignes: readonly Indicateur[],
  sexes: readonly (Sexe | null)[],
  fichier: string,
): void {
  const comptes = new Map<string, number>()
  for (const ligne of lignes) {
    const paire = `${ligne.detail}\u0000${ligne.sex ?? ''}`
    comptes.set(paire, (comptes.get(paire) ?? 0) + 1)
  }

  const attendu = TRANCHES_STRUCTURE_AGE.length * sexes.length
  const forme =
    sexes.length === 1
      ? `${TRANCHES_STRUCTURE_AGE.length} tranches (forme héritée, sans sexe)`
      : `${TRANCHES_STRUCTURE_AGE.length} tranches × ${sexes.length} sexes`

  for (const detail of TRANCHES_STRUCTURE_AGE) {
    for (const sex of sexes) {
      const compte = comptes.get(`${detail}\u0000${sex ?? ''}`) ?? 0
      const paire = sex === null ? `tranche « ${detail} »` : `tranche « ${detail} » × sexe « ${sex} »`
      if (compte === 0) {
        throw erreur(
          fichier,
          0,
          `${prefixe} : ${paire} manquante — le contrat est ${forme} = ` +
            `${attendu} lignes par territoire`,
        )
      }
      if (compte > 1) {
        throw erreur(fichier, 0, `${prefixe} : ${paire} en double (${compte} lignes)`)
      }
    }
  }

  // La ceinture après les bretelles : aucune ligne en trop.
  if (lignes.length !== attendu) {
    throw erreur(
      fichier,
      0,
      `${prefixe} : ${lignes.length} lignes au lieu de ${attendu} (${forme})`,
    )
  }
}

/** La raison de saillance attendue pour chaque story (le miroir R du registre). */
const RAISON_PAR_STORY: Record<string, RaisonSaillance> = {
  'vingt-minutes-sans-voiture': 'defaut',
  'ce-que-le-velo-preserve': 'delta-velo-saillant',
  'trajectoire-demographique': 'defaut',
  'etat-energetique-du-parc': 'defaut',
  'ce-que-la-commune-abrite': 'defaut',
  'se-densifier-setaler-ou-sen-aller': 'defaut',
}

/** L'en-tête commun d'une lecture résolue — l'identité (territoire × groupe) + la story choisie + la saillance. */
interface EnteteLectureResolue {
  territoire: string
  type: TerritoireType
  theme: Theme
  groupe: string
  story_key: string
  salience_reason: RaisonSaillance
}

/** The histoires (Story) facts table — RESOLVED readings (issue #312): one row per (territoire × groupe), the explicit subgroup join (groupe), the SELECTED story key and the salience reason. Per-theme shape (types.ts). */
export function validerHistoires(
  brut: unknown,
  fichier: string,
  territoires: Territoire[],
): Histoire[] {
  exiger(Array.isArray(brut), fichier, 0, 'la table des histoires doit être un tableau')
  const lignes = brut as unknown[]
  const reference = indexerReference(territoires)
  // l'identité (territoire × groupe) est UNIQUE — le pool non résolu ou une
  // lecture en double échoue ICI, jamais deux lectures pour le même slot
  const vus = new Set<string>()

  return lignes.map((ligne, i) => {
    const ligneIndexee = i + 1
    exiger(estObjet(ligne), fichier, ligneIndexee, 'chaque ligne doit être un objet')
    verifierReference(ligne, reference, fichier, ligneIndexee)

    const territoire = ligne['territoire'] as string
    const type = lireType(ligne, fichier, ligneIndexee)
    const theme = lireTheme(ligne, fichier, ligneIndexee)
    const story_key = lireChaine(ligne, 'story_key', fichier, ligneIndexee)
    const groupe = lireChaine(ligne, 'groupe', fichier, ligneIndexee)
    const salience_reason = lireChaine(ligne, 'salience_reason', fichier, ligneIndexee)

    // la lecture résolue : la story appartient au registre du thème, vit dans
    // SON groupe de fiche et porte la raison de saillance DÉCLARÉE — jamais
    // une story hors contrat, jamais un slot déplacé, jamais une raison
    // inventée (le miroir R de valider_histoires_resolues, #312)
    exiger(
      estUneDe(story_key, CLES_HISTOIRES_PAR_THEME[theme]),
      fichier,
      ligneIndexee,
      `Story « ${story_key} » inconnue du contrat du thème « ${theme} »`,
    )
    const groupeAttendu = GROUPES_PAR_STORY[theme][story_key]
    exiger(
      groupe === groupeAttendu,
      fichier,
      ligneIndexee,
      `la story « ${story_key} » vit dans le groupe « ${groupeAttendu} », reçu « ${groupe} »`,
    )
    const raisonAttendue = RAISON_PAR_STORY[story_key]
    exiger(
      estUneDe(salience_reason, RAISONS_SAILLANCE),
      fichier,
      ligneIndexee,
      `« salience_reason » doit être l'un de ${RAISONS_SAILLANCE.join(' | ')}, reçu « ${String(salience_reason)} »`,
    )
    exiger(
      salience_reason === raisonAttendue,
      fichier,
      ligneIndexee,
      `« salience_reason » incohérente avec la story « ${story_key} » (attendu « ${raisonAttendue} », reçu « ${salience_reason} »)`,
    )
    const cle = `${territoire}\u0000${groupe}`
    exiger(
      !vus.has(cle),
      fichier,
      ligneIndexee,
      `plusieurs lectures pour « ${territoire} » (groupe « ${groupe} »)`,
    )
    vus.add(cle)

    const entete: EnteteLectureResolue = { territoire, type, theme, story_key, groupe, salience_reason }

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
      return { ...entete, theme: 'demographie', story_key: 'trajectoire-demographique', solde_naturel, solde_migratoire, taux_solde_naturel, taux_solde_migratoire, classification, periode }
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
      return { ...entete, theme: 'habitat', story_key: 'etat-energetique-du-parc', classification, part_passoires, part_abc, n_dpe }
    }

    if (theme === 'milieux') return lireHistoireMilieux(ligne, entete, ligneIndexee, fichier)
    if (theme === 'mobilite') return lireHistoireMobilite(ligne, entete, ligneIndexee, fichier)
    if (theme === 'economie') return lireHistoireEconomie(ligne, entete, ligneIndexee, fichier)

    // Un thème sans Story construite ne publie pas d'histoires (le loader 404
    // sur histoires_<theme>.json) — une ligne ici est une dérive du contrat.
    throw erreur(fichier, ligneIndexee, `Story du thème « ${theme} » inconnue de l'app`)
  })
}

/** Une ligne d'Histoire Économie (issue #120, RÉSOLUE par #312) — le top-5 replié en paramètres plats top1_*..top5_*, une lecture par (territoire, groupe). */
function lireHistoireEconomie(
  ligne: LigneBrute,
  entete: EnteteLectureResolue,
  ligneIndexee: number,
  fichier: string,
): Histoire {
  const { territoire, type, groupe, salience_reason } = entete

  // Le top-5 replié : chaque rang porte code + label (+ LQ pour la lecture de
  // spécialisation). Le premier
  // rang EXISTE toujours (une lecture sans sa première activité est une
  // dérive) ; un territoire à moins de cinq activités porte NA au-delà (jamais
  // de padding). Le label vient TOUJOURS du payload — jamais codé en dur.
  const top = {} as Record<`top${1 | 2 | 3 | 4 | 5}_${'activity_code' | 'activity_label' | 'lq' | 'n' | 'part_parc'}`, string | number | null>
  for (const prefixe of ['top1', 'top2', 'top3', 'top4', 'top5'] as const) {
    const k = Number(prefixe.slice(3))
    const code = ligne[`${prefixe}_activity_code`]
    const label = ligne[`${prefixe}_activity_label`]
    const lq = ligne[`${prefixe}_lq`]
    const n = ligne[`${prefixe}_n`]
    const part_parc = ligne[`${prefixe}_part_parc`]
    if (k === 1) {
      exiger(estChaine(code) && (code as string).length > 0, fichier, ligneIndexee, `« ${prefixe}_activity_code » doit être une chaîne non vide`)
      exiger(estChaine(label) && (label as string).length > 0, fichier, ligneIndexee, `« ${prefixe}_activity_label » doit être une chaîne non vide`)
    } else {
      exiger(code === null || (estChaine(code) && (code as string).length > 0), fichier, ligneIndexee, `« ${prefixe}_activity_code » doit être une chaîne non vide ou null`)
      exiger(label === null || (estChaine(label) && (label as string).length > 0), fichier, ligneIndexee, `« ${prefixe}_activity_label » doit être une chaîne non vide ou null`)
      // un rang vide au-delà du premier impose les suivants vides (jamais un
      // trou : top3 présent avec top2 absent est une dérive du repli)
      if (code === null) {
        for (const suivant of ['top3', 'top4', 'top5'] as const) {
          if (Number(suivant.slice(3)) < k) continue
          exiger(ligne[`${suivant}_activity_code`] === null, fichier, ligneIndexee, `le rang ${suivant} est présent alors que le rang ${k - 1} est vide (jamais un trou)`)
        }
        break
      }
    }
    exiger(estValeur(lq), fichier, ligneIndexee, `« ${prefixe}_lq » doit être un nombre ou null`)
    exiger(estValeur(n), fichier, ligneIndexee, `« ${prefixe}_n » doit être un nombre ou null`)
    exiger(estValeur(part_parc), fichier, ligneIndexee, `« ${prefixe}_part_parc » doit être un nombre ou null`)
    // la matière de la lecture : la LQ pour la spécialisation ; la part du parc
    // régionale a quitté le contrat de fiche.
    exiger(estNombre(lq), fichier, ligneIndexee, `« ${prefixe}_lq » doit être un nombre pour ce-que-la-commune-abrite`)
    exiger(part_parc === null, fichier, ligneIndexee, `« ${prefixe}_part_parc » doit être null pour ce-que-la-commune-abrite`)
    exiger(estNombre(n), fichier, ligneIndexee, `« ${prefixe}_n » doit être un nombre`)
    top[`${prefixe}_activity_code`] = code
    top[`${prefixe}_activity_label`] = label
    top[`${prefixe}_lq`] = lq
    top[`${prefixe}_n`] = n
    top[`${prefixe}_part_parc`] = part_parc
  }
  // les rangs au-delà du dernier présent (une lecture courte, jamais un trou)
  // portent null — le padding est interdit par le contrat
  for (const prefixe of ['top1', 'top2', 'top3', 'top4', 'top5'] as const) {
    if (top[`${prefixe}_activity_code`] === undefined) top[`${prefixe}_activity_code`] = null
    if (top[`${prefixe}_activity_label`] === undefined) top[`${prefixe}_activity_label`] = null
    if (top[`${prefixe}_lq`] === undefined) top[`${prefixe}_lq`] = null
    if (top[`${prefixe}_n`] === undefined) top[`${prefixe}_n`] = null
    if (top[`${prefixe}_part_parc`] === undefined) top[`${prefixe}_part_parc`] = null
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

  // la matière est vérifiée rang par rang (top1_* non vide, lq/part_parc/n
  // par lecture) — le resserrage des types plats se fait ici, comme les
  // formes discriminées des autres thèmes
  const lecture = {
    territoire,
    type,
    theme: 'economie' as const,
    groupe,
    story_key: 'ce-que-la-commune-abrite' as const,
    salience_reason,
    ...top,
    vintage_source,
    vintage_version,
    vintage_date_reference,
    vintage_date_publication,
  }
  return lecture as HistoireEconomie
}

/**
 * Une ligne d'Histoire Mobilité (issue #142, RÉSOLUE par #312, ADR-0012) —
 * UNE ligne par territoire : le défaut « vingt-minutes-sans-voiture »
 * (div_loss_t + la signature de distribution), remplacé là où la saillance
 * tire par « ce-que-le-velo-preserve » (le delta seul — la signature est la
 * matière du défaut, null sur la ligne vélo). L'estampille snapshot est
 * portée par chaque ligne comme l'Économie (issue #74).
 */
function lireHistoireMobilite(
  ligne: LigneBrute,
  entete: EnteteLectureResolue,
  ligneIndexee: number,
  fichier: string,
): Histoire {
  const { territoire, type, story_key, groupe, salience_reason } = entete

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

  // La saillance ne se déclenche que sur le delta réel : la story vélo exige
  // la classification « saillant » ET la raison de saillance déclarée
  // (déjà vérifiée dans l'en-tête — la raison attendue de cette story)
  if (story_key === 'ce-que-le-velo-preserve') {
    exiger(
      classification_saillance === 'saillant',
      fichier,
      ligneIndexee,
      'une Story « ce-que-le-velo-preserve » sans saillance « saillant »',
    )
    const dens_min = ligne['dens_min']
    const dens_max = ligne['dens_max']
    exiger(estNombre(dens_min), fichier, ligneIndexee, '« dens_min » doit être numérique pour une Story vélo')
    exiger(estNombre(dens_max), fichier, ligneIndexee, '« dens_max » doit être numérique pour une Story vélo')
    exiger((dens_max as number) >= (dens_min as number), fichier, ligneIndexee, '« dens_min/dens_max » doit avoir un intervalle valide')
    const densites: number[] = []
    const deciles: number[] = []
    for (let k = 1; k <= 10; k++) {
      const dens = ligne[`dens_${k}`]
      const dec = ligne[`dec_${k}`]
      exiger(estNombre(dens), fichier, ligneIndexee, `« dens_${k} » doit être numérique pour une Story vélo`)
      exiger(estNombre(dec), fichier, ligneIndexee, `« dec_${k} » doit être numérique pour une Story vélo`)
      densites.push(dens as number)
      deciles.push(dec as number)
    }
    exiger(densites.some((valeur) => valeur > 0), fichier, ligneIndexee, 'la signature plate de densité doit être exploitable')
    return {
      territoire,
      type,
      theme: 'mobilite',
      groupe,
      story_key: 'ce-que-le-velo-preserve',
      salience_reason,
      div_loss_t: div_loss_t as number,
      div_loss_b: div_loss_b as number,
      delta: delta as number,
      pct_iso_full_t: null,
      dens_min: dens_min as number,
      dens_max: dens_max as number,
      dens_1: densites[0], dens_2: densites[1], dens_3: densites[2], dens_4: densites[3], dens_5: densites[4],
      dens_6: densites[5], dens_7: densites[6], dens_8: densites[7], dens_9: densites[8], dens_10: densites[9],
      dec_1: deciles[0], dec_2: deciles[1], dec_3: deciles[2], dec_4: deciles[3], dec_5: deciles[4],
      dec_6: deciles[5], dec_7: deciles[6], dec_8: deciles[7], dec_9: deciles[8], dec_10: deciles[9],
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
    theme: 'mobilite',
    groupe,
    story_key: 'vingt-minutes-sans-voiture',
    salience_reason,
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

/**
 * Une ligne d'Histoire Milieux (issue #174, ADR-0014, re-keyed par la spec
 * #225) — la Story unique « Se densifier, s'étaler, ou s'en aller » : une
 * ligne par territoire, la lecture par les signes (seuil 0). Les deux forces
 * (Δpopulation de la série historique, trajectoire de la surface artificialisée
 * par habitant — les états OCS-GE), les deux fenêtres nommées séparément
 * (population / états — la règle des deux horloges) et la classification
 * (null = fenêtre incomplète, jamais une lecture inventée). L'invariant du
 * contrat : sign(ratio − 1) = sign(delta) — le classifieur et le graphe ne
 * peuvent jamais se contredire.
 *
 * Trois formes sont contractuelles (la découverte #243 du pipeline) : (1) les
 * quatre états présents avec M2 par habitant > 0 → la trajectoire est un
 * nombre strictement positif et l'invariant tient ; (2) les états présents
 * avec M2 par habitant == 0 (102 communes réelles, ~8 %) → le ratio M3/0 est
 * INDÉFINI, la trajectoire est null et la classification est null — jamais un
 * rapport infini inventé, jamais une lecture fabriquée ; (3) les états
 * absents (le trou NA honnête d'un territoire dont la donnée manque) → tout
 * est null. Aucune forme mixte, aucun mélange : la cohérence est le contrat.
 */
function lireHistoireMilieux(
  ligne: LigneBrute,
  entete: EnteteLectureResolue,
  ligneIndexee: number,
  fichier: string,
): Histoire {
  const { territoire, type, story_key, groupe, salience_reason } = entete

  exiger(
    estUneDe(story_key, CLES_HISTOIRES_MILIEUX),
    fichier,
    ligneIndexee,
    `Story Milieux « ${story_key} » inconnue du contrat`,
  )

  // L'unicité (territoire × groupe) est déjà vérifiée dans validerHistoires —
  // une lecture par slot de sous-groupe, jamais deux.

  // Les deux fenêtres nommées séparément — la règle des deux horloges (spec
  // #225) : la fenêtre partagée de la population (le bracket RP) et la fenêtre
  // des états OCS-GE (le span par département pour les agrégats multi-dépt).
  // Jamais codées en dur (« 2017-2023 ») ni fusionnées en une seule période.
  // La fenêtre des états est null quand le territoire n'a AUCUNE donnée OCS-GE
  // (le trou NA honnête — pas de fenêtre sans états, ADR-0017) ; la fenêtre de
  // population, elle, existe toujours (la règle de source d'ADR-0014).
  const periode_pop = lireChaine(ligne, 'periode_pop', fichier, ligneIndexee)
  exiger(periode_pop.length > 0, fichier, ligneIndexee, '« periode_pop » vide')
  const periode_artif = ligne['periode_artif']
  exiger(
    periode_artif === null ||
      (estChaine(periode_artif) && periode_artif.length > 0),
    fichier,
    ligneIndexee,
    '« periode_artif » doit être une chaîne non vide ou null (territoire sans données OCS-GE)',
  )

  const delta_population = ligne['delta_population']
  exiger(estNombre(delta_population), fichier, ligneIndexee, '« delta_population » doit être un nombre')

  // Le taux annuel de variation (‰/an, issue #306) — la force population du
  // quadrant, annualisée et normalisée par la population moyenne du bracket
  // INSEE (la même convention que Démographie). Null quand la population
  // moyenne est nulle (le 0 réel des villages détruits — jamais une division
  // par zéro, jamais un taux inventé) ; défini sinon, avec le MÊME signe que
  // le delta brut (la classification lit le signe seul du delta — identique
  // pour le compte et pour le taux, rien ne bouge en aval).
  const taux_variation_population = ligne['taux_variation_population']
  const tauxDefini = estNombre(taux_variation_population)
  if (tauxDefini) {
    exiger(
      Math.sign(taux_variation_population as number) === Math.sign(delta_population as number),
      fichier,
      ligneIndexee,
      `« taux_variation_population » (${taux_variation_population}) et « delta_population » (${delta_population}) se contredisent — le taux et le compte partagent le signe`,
    )
  } else {
    exiger(
      taux_variation_population === null,
      fichier,
      ligneIndexee,
      '« taux_variation_population » doit être un nombre (le taux ‰/an) ou null (population moyenne nulle — jamais un taux inventé)',
    )
  }

  // Les états OCS-GE (ha à chaque millésime) + la surface par habitant
  // (m²/hab) — SOIT les quatre présents (nombres non négatifs), SOIT les
  // quatre absents (null — le trou NA honnête d'un territoire dont la donnée
  // manque, ADR-0017 « la NA propage, jamais un 0 inventé »). Jamais un
  // mélange : un état incomplet est une erreur de contrat.
  const artif_m2 = ligne['artif_m2']
  const artif_m3 = ligne['artif_m3']
  const artif_m2_par_habitant = ligne['artif_m2_par_habitant']
  const artif_m3_par_habitant = ligne['artif_m3_par_habitant']
  const etats = [artif_m2, artif_m3, artif_m2_par_habitant, artif_m3_par_habitant] as const
  const etatsAbsents = etats.every((e) => e === null)
  exiger(
    etatsAbsents || etats.every((e) => estNombre(e) && e >= 0),
    fichier,
    ligneIndexee,
    'les quatre états (artif_m2, artif_m3, artif_m2_par_habitant, artif_m3_par_habitant) doivent être tous présents (nombres non négatifs) ou tous absents (null)',
  )
  // NOTA : la fenêtre des états et les états ne sont PAS liés par une
  // cohérence stricte — la fenêtre dérive des couples (département ->
  // millésimes) des membres porteurs de donnée, les états suivent la NA
  // PROPAGÉE (un membre manquant rend le niveau NA, jamais la fenêtre) : un
  // agrégat peut porter sa fenêtre avec des états NA (le 29 du fixture,
  // periode_artif « 2021-2024 », états NA par 29003). Seul le territoire
  // SANS aucune donnée porte les deux à null (29003).

  // La trajectoire M3/M2 par habitant — le ratio n'existe QUE quand l'état
  // initial par habitant est strictement positif. Découverte #243 : 102
  // communes réelles (~8 %) ont M2 = 0 — M3/0 est INDÉFINI, la trajectoire
  // est null (jamais un rapport infini inventé, jamais un « s'étale » fabriqué
  // sur un rapport sans sens). L'état absent (le trou NA honnête) rend aussi
  // la trajectoire null. Une trajectoire définie est NON NÉGATIVE : 0 est la
  // renaturation COMPLÈTE (M3 = 0 — 11 communes réelles, la même forme que le
  // 56001 du fixture), jamais un ratio négatif (m3ph >= 0 et m2ph > 0).
  const trajectoire_artif_par_habitant = ligne['trajectoire_artif_par_habitant']
  const trajectoireDefinie = estNombre(trajectoire_artif_par_habitant)
  if (trajectoireDefinie) {
    exiger(
      (trajectoire_artif_par_habitant as number) >= 0,
      fichier,
      ligneIndexee,
      '« trajectoire_artif_par_habitant » doit être un nombre non négatif (le ratio M3/M2) quand il est défini',
    )
  } else {
    exiger(
      trajectoire_artif_par_habitant === null,
      fichier,
      ligneIndexee,
      '« trajectoire_artif_par_habitant » doit être un nombre non négatif (le ratio M3/M2) ou null (état initial nul ou absent — jamais un rapport infini)',
    )
  }

  if (!etatsAbsents) {
    // Les états présents : la trajectoire suit l'état initial.
    if ((artif_m2_par_habitant as number) === 0) {
      // M2 = 0 (et même les deux états nuls 0/0) : le ratio est indéfini —
      // la trajectoire DOIT être null (fix #243), jamais un Inf sérialisé.
      exiger(
        !trajectoireDefinie,
        fichier,
        ligneIndexee,
        '« trajectoire_artif_par_habitant » doit être null quand l’état initial par habitant est nul — le ratio M3/0 est indéfini',
      )
    } else {
      // M2 par habitant > 0 : la trajectoire est requise — l'invariant du
      // contrat (spec #225) : sign(ratio − 1) = sign(delta) — la lecture (le
      // ratio) et le graphe quadrant (le delta signé) ne peuvent jamais se
      // contredire. Un ratio < 1 exige un delta < 0 (la densification ou la
      // renaturation MESURÉE) ; un ratio > 1 exige un delta > 0 ; ratio == 1
      // ⟺ delta == 0.
      exiger(
        trajectoireDefinie,
        fichier,
        ligneIndexee,
        '« trajectoire_artif_par_habitant » est requise quand l’état initial par habitant est strictement positif',
      )
      const delta = (artif_m3_par_habitant as number) - (artif_m2_par_habitant as number)
      const ratio = trajectoire_artif_par_habitant as number
      exiger(
        Math.sign(ratio - 1) === Math.sign(delta),
        fichier,
        ligneIndexee,
        `« trajectoire_artif_par_habitant » (${ratio}) et le delta par habitant (${delta}) se contredisent — sign(ratio − 1) doit valoir sign(delta)`,
      )
    }
  } else {
    // États absents : la trajectoire ne peut pas être là sans ses états.
    exiger(
      !trajectoireDefinie,
      fichier,
      ligneIndexee,
      '« trajectoire_artif_par_habitant » doit être null quand les états sont absents',
    )
  }

  // La classification : l'une des quatre lectures, ou null (fenêtre
  // incomplète — jamais une lecture hors contrat). Quand la trajectoire est
  // absente, la lecture est FORCÉMENT null : la seconde force manque, aucune
  // des quatre lectures ne peut être énoncée (fix #243).
  const classification = ligne['classification']
  exiger(
    classification === null || estUneDe(classification, CLASSIFICATIONS_MILIEUX),
    fichier,
    ligneIndexee,
    `« classification » doit être l'un de ${CLASSIFICATIONS_MILIEUX.join(' | ')}, reçu « ${String(classification)} »`,
  )
  if (!trajectoireDefinie) {
    exiger(
      classification === null,
      fichier,
      ligneIndexee,
      '« classification » doit être null quand la trajectoire est absente — jamais une lecture sans sa seconde force',
    )
  }

  return {
    territoire,
    type,
    theme: 'milieux',
    groupe,
    story_key: 'se-densifier-setaler-ou-sen-aller',
    salience_reason,
    periode_pop,
    periode_artif: periode_artif as string | null,
    delta_population: delta_population as number,
    taux_variation_population: taux_variation_population as number | null,
    artif_m2: artif_m2 as number,
    artif_m3: artif_m3 as number,
    artif_m2_par_habitant: artif_m2_par_habitant as number,
    artif_m3_par_habitant: artif_m3_par_habitant as number,
    trajectoire_artif_par_habitant: trajectoire_artif_par_habitant as number | null,
    classification: classification as string | null,
  }
}

/**
 * The apercu basic-stats table (ADR-0007). Optional (404 → null), like the
 * run report: since #116 the pipeline only publishes apercu.json when a
 * theme HAS an aperçu — absent, the Aperçu element is simply not built,
 * never a fetch error.
 */
export function validerApercu(
  brut: unknown,
  fichier: string,
  territoires: Territoire[],
): ApercuRow[] | null {
  if (brut === null) return null
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
 * The programmes payload (issue #179, ADR-0013) — the app's half of the
 * pipeline's verifier_membres_programmes / verifier_contrat_subventions.
 * programmes.json is a JSON OBJECT with two arrays ({ membres, subventions }),
 * never an array; null = the file is absent (the « 404 = table absent »
 * contract — the element is simply absent, never an error).
 */
export function validerProgrammes(
  brut: unknown,
  fichier: string,
  territoires: Territoire[],
): ProgrammesPayload | null {
  if (brut === null) return null
  exiger(estObjet(brut), fichier, 0, 'le fichier programmes doit être un objet { membres, subventions }')
  const ligne = brut as LigneBrute

  const membres = validerMembresProgrammes(ligne['membres'], fichier, territoires)
  const subventions = validerSubventionsProgrammes(ligne['subventions'], fichier, territoires)

  return { membres, subventions }
}

/** One membership row per (territoire × sigle), anchored per ADR-0013. */
function validerMembresProgrammes(
  brut: unknown,
  fichier: string,
  territoires: Territoire[],
): MembreProgramme[] {
  exiger(Array.isArray(brut), fichier, 0, 'la table « membres » doit être un tableau')
  const lignes = brut as unknown[]
  const reference = indexerReference(territoires)
  const vus = new Set<string>()
  // Le rider « convention valant ORT » n'existe que sur les labels ACV/PVD —
  // le drapeau sur une ligne contrat/ORT est une dérive du contrat (#162-9).
  const labels = new Set<string>(['ACV', 'PVD'])

  return lignes.map((ligne, i) => {
    const ligneIndexee = i + 1
    exiger(estObjet(ligne), fichier, ligneIndexee, 'chaque ligne d\u2019adhésion doit être un objet')
    verifierReference(ligne, reference, fichier, ligneIndexee)

    const territoire = ligne['territoire'] as string
    const type = lireType(ligne, fichier, ligneIndexee)
    // L'ancrage du contrat : les adhésions vivent à la commune ou à l'EPCI,
    // jamais au département / à la région (ADR-0013 — l'échelle est dérivée).
    exiger(
      type === 'commune' || type === 'epci',
      fichier,
      ligneIndexee,
      'une ligne d\u2019adhésion est ancrée commune ou epci, jamais département ou région',
    )

    const sigle = lireSigle(ligne, fichier, ligneIndexee)

    const cle = `${territoire}\u0000${sigle}`
    exiger(
      !vus.has(cle),
      fichier,
      ligneIndexee,
      `ligne en double (territoire × sigle) pour « ${sigle} » de « ${territoire} »`,
    )
    vus.add(cle)

    const convention_valant_ort = ligne['convention_valant_ort']
    exiger(
      typeof convention_valant_ort === 'boolean',
      fichier,
      ligneIndexee,
      '« convention_valant_ort » doit être un booléen',
    )
    if (!labels.has(sigle)) {
      exiger(
        convention_valant_ort === false,
        fichier,
        ligneIndexee,
        'le drapeau « convention valant ORT » n\u2019existe que sur les lignes de label ACV/PVD',
      )
    }

    const vintage_source = lireChaine(ligne, 'vintage_source', fichier, ligneIndexee)
    const vintage_version = lireChaine(ligne, 'vintage_version', fichier, ligneIndexee)
    const vintage_date_reference = ligne['vintage_date_reference']
    // L'ORT porte l'actualisation PAR LIGNE comme référence — jamais null
    // (verifier_membres_programmes : une ligne ORT sans actualisation échoue).
    exiger(
      estDateIso(vintage_date_reference),
      fichier,
      ligneIndexee,
      '« vintage_date_reference » doit être une date ISO (AAAA-MM-JJ), jamais null',
    )
    // La publication source est NA pour l'ORT par contrat (la métadonnée de
    // page est périmée — manifest #175) — null légitime, rien d'autre.
    const vintage_date_publication = ligne['vintage_date_publication']
    exiger(
      vintage_date_publication === null || estDateIso(vintage_date_publication),
      fichier,
      ligneIndexee,
      '« vintage_date_publication » doit être une date ISO (AAAA-MM-JJ) ou null',
    )

    return {
      territoire,
      type,
      sigle,
      convention_valant_ort: convention_valant_ort as boolean,
      vintage_source,
      vintage_version,
      vintage_date_reference: vintage_date_reference as string,
      vintage_date_publication: vintage_date_publication as string | null,
    }
  })
}

function lireSigle(ligne: LigneBrute, fichier: string, i: number): SigleProgramme {
  const valeur = ligne['sigle']
  exiger(
    estUneDe(valeur, SIGLES_PROGRAMMES),
    fichier,
    i,
    `« sigle » doit être l'un de ${SIGLES_PROGRAMMES.join(' | ')}, reçu « ${String(valeur)} »`,
  )
  return valeur
}

/** One subvention aggregate row — commune splits, EPCI/département/région totals. */
function validerSubventionsProgrammes(
  brut: unknown,
  fichier: string,
  territoires: Territoire[],
): SubventionProgramme[] {
  exiger(Array.isArray(brut), fichier, 0, 'la table « subventions » doit être un tableau')
  const lignes = brut as unknown[]
  const reference = indexerReference(territoires)

  return lignes.map((ligne, i) => {
    const ligneIndexee = i + 1
    exiger(estObjet(ligne), fichier, ligneIndexee, 'chaque ligne de subvention doit être un objet')
    verifierReference(ligne, reference, fichier, ligneIndexee)

    const territoire = ligne['territoire'] as string
    const type = lireType(ligne, fichier, ligneIndexee)

    const annee = ligne['annee']
    exiger(estNombre(annee), fichier, ligneIndexee, '« annee » doit être un nombre')

    const programme_libl = ligne['programme_libl']
    // La ventilation par domaine n'existe que sur les lignes communales — un
    // libellé sur une ligne agrégat est une dérive (#176, ADR-0013).
    if (type === 'commune') {
      exiger(estChaine(programme_libl), fichier, ligneIndexee, 'une ligne communale porte « programme_libl » (la ventilation par domaine)')
    } else {
      exiger(
        programme_libl === null,
        fichier,
        ligneIndexee,
        '« programme_libl » est null sur les lignes agrégat (epci / departement / region)',
      )
    }

    const montant = ligne['montant']
    exiger(estNombre(montant), fichier, ligneIndexee, '« montant » doit être un nombre')

    const vintage_source = lireChaine(ligne, 'vintage_source', fichier, ligneIndexee)
    const vintage_version = lireChaine(ligne, 'vintage_version', fichier, ligneIndexee)
    const vintage_date_reference = ligne['vintage_date_reference']
    const vintage_date_publication = ligne['vintage_date_publication']
    // Le vintage SCDL est hebdomadaire et verrouillé : les deux dates sont ISO
    // (verifier_contrat_subventions — la publication jamais avant la référence).
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
      annee: annee as number,
      programme_libl: programme_libl as string | null,
      montant: montant as number,
      vintage_source,
      vintage_version,
      vintage_date_reference: vintage_date_reference as string,
      vintage_date_publication: vintage_date_publication as string,
    }
  })
}

/**
 * Assemble + validate a complete payload from the raw documents (the JSON
 * projections as fetched). The loader merges per-theme facts files before
 * calling this; per-file error attribution lives in the loader.
 */export function parsePayload(documents: {
  territoires: unknown
  indicateurs: unknown
  histoires: unknown
  apercu: unknown
  runReport: unknown
  vintages?: unknown
  programmes?: unknown
}): Payload {
  const territoires = validerTerritoires(documents.territoires, 'territoires.json')
  const indicateurs = validerIndicateurs(documents.indicateurs, 'indicateurs', territoires)
  const histoires = validerHistoires(documents.histoires, 'histoires', territoires)
  const apercu = validerApercu(documents.apercu, 'apercu.json', territoires)
  const runReport = validerRapportRun(documents.runReport, 'run-report.json')
  const vintages = validerVintages(documents.vintages ?? null, 'vintages.json')
  const programmes = validerProgrammes(documents.programmes ?? null, 'programmes.json', territoires)

  return { territoires, indicateurs, histoires, apercu, runReport, vintages, programmes }
}

/**
 * The theme metadata file (theme_<theme>.json, issue #309) — the app's half
 * of valider_theme_metadata() (pipeline/R/theme_metadata.R): subgroup order,
 * labels/framing, figure families, typed rich text, the resolved-histoire
 * linkage and the source-reference policy. Raw JSON in, typed ThemeMetadata
 * out; drift is a loud, typed PayloadError — never silent wrong figures.
 * Programmes is rejected: it is a separate publication contract, never a
 * theme.
 */
export function validerThemeMetadata(brut: unknown, fichier: string): ThemeMetadata {
  exiger(estObjet(brut), fichier, 0, 'le fichier theme_<theme>.json doit être un objet JSON, jamais un tableau')
  const meta = brut as LigneBrute

  // 1. le thème — présent, canonique, jamais « programmes » (la frontière
  //    explicite du parent #308 : Programmes est un contrat de publication
  //    séparé, il ne reçoit pas de fichier theme_programmes.json fabriqué)
  const theme = lireChaine(meta, 'theme', fichier, 0)
  if (theme === 'programmes') {
    throw erreur(fichier, 0, '« programmes » est un contrat de publication SÉPARÉ (programmes.json, ADR-0013), jamais un thème — aucun fichier theme_programmes.json fabriqué')
  }
  exiger(
    estUneDe(theme, THEMES_CANONIQUES),
    fichier,
    0,
    `thème inconnu « ${theme} » — attendu l'un de ${THEMES_CANONIQUES.join(' | ')}`,
  )

  // 2. le label du thème
  const label = lireChaine(meta, 'label', fichier, 0)
  exiger(label.length > 0, fichier, 0, 'le label du thème est absent ou vide')

  // 3. les clés d'indicateurs — le registre du thème
  const indicator_keys = lireTableauChaines(meta, 'indicator_keys', fichier, 0)
  exiger(indicator_keys.length > 0, fichier, 0, '« indicator_keys » : la liste des clés d\u2019indicateurs est vide')

  // 4. les story_keys — le registre des histoires, avec la règle
  //    d'herméticité (ADR-0020) : un thème ne peut lier que SES histoires
  const story_keys = lireTableauChaines(meta, 'story_keys', fichier, 0)
  exiger(story_keys.length > 0, fichier, 0, '« story_keys » : la liste des histoires est vide')
  const portees = CLES_HISTOIRES_PAR_THEME[theme]
  const autres = new Set(
    (Object.keys(CLES_HISTOIRES_PAR_THEME) as Theme[])
      .filter((t) => t !== theme)
      .flatMap((t) => CLES_HISTOIRES_PAR_THEME[t]),
  )
  for (const cle of story_keys) {
    if (!portees.includes(cle)) {
      if (autres.has(cle)) {
        throw erreur(fichier, 0, `référence cross-thème : la story « ${cle} » appartient à un AUTRE thème — l'herméticité (ADR-0020) interdit toute référence cross-thème`)
      }
      throw erreur(fichier, 0, `la story « ${cle} » est inconnue du contrat`)
    }
  }

  // 5. les sources de référence — la politique : chaque indicateur déclare la
  //    source de son composant signature ; la carte déclare EXACTEMENT les
  //    indicateurs du registre (le « Reference source » de CONTEXT.md)
  const sourcesBrut = meta['sources']
  exiger(estObjet(sourcesBrut), fichier, 0, '« sources » doit être un objet — la carte des sources de référence')
  const sources = sourcesBrut as LigneBrute
  const clesSources = Object.keys(sources)
  for (const cle of clesSources) {
    exiger(
      estChaine(sources[cle]) && (sources[cle] as string).length > 0,
      fichier,
      0,
      `« sources » : la source de « ${cle} » doit être une chaîne non vide`,
    )
  }
  const manquantes = indicator_keys.filter((cle) => !clesSources.includes(cle))
  const fantomes = clesSources.filter((cle) => !indicator_keys.includes(cle))
  exiger(
    manquantes.length === 0 && fantomes.length === 0,
    fichier,
    0,
    `« sources » : la carte des sources doit déclarer EXACTEMENT les indicateurs du registre — sans source : ${manquantes.join(', ')} ; non déclarés : ${fantomes.join(', ')}`,
  )

  // 5bis. les libellés d'indicateurs (issue #318) — la carte du vocabulaire
  //      payload-owned : EXACTEMENT indicator_keys (la bijection, comme les
  //      sources), chaque valeur un libellé français non vide. C'est le seul
  //      vocabulaire que la fiche et la carte rendent — jamais une clé brute.
  const indicator_labels = lireCarteChaines(meta, 'indicator_labels', fichier)
  const sansLibelle = indicator_keys.filter((cle) => !(cle in indicator_labels))
  const fantomesLibelle = Object.keys(indicator_labels).filter(
    (cle) => !indicator_keys.includes(cle),
  )
  exiger(
    sansLibelle.length === 0 && fantomesLibelle.length === 0,
    fichier,
    0,
    `« indicator_labels » : la carte des libellés doit déclarer EXACTEMENT les indicateurs du registre — sans libellé : ${sansLibelle.join(', ')} ; non déclarés : ${fantomesLibelle.join(', ')}`,
  )

  // 5ter. les libellés de détail (issue #318) — la carte détail → libellé des
  //      clés multi-détails : chaque clé déclarée appartient au registre
  //      indicator_keys, chaque libellé est une chaîne non vide. La COUVERTURE
  //      bidirectionnelle contre les faits publiés est la garde
  //      verifierPariteLibelles (le loader) — le fichier, lui, reste
  //      auto-contenu comme sources.
  const detailLabelsBrut = meta['detail_labels']
  exiger(
    estObjet(detailLabelsBrut),
    fichier,
    0,
    '« detail_labels » doit être un objet — la carte des libellés de détail',
  )
  const detail_labels: Record<string, Record<string, string>> = {}
  for (const [cle, valeur] of Object.entries(detailLabelsBrut as LigneBrute)) {
    exiger(
      indicator_keys.includes(cle),
      fichier,
      0,
      `« detail_labels » : clé « ${cle} » hors du registre indicator_keys`,
    )
    exiger(
      estObjet(valeur),
      fichier,
      0,
      `« detail_labels » : « ${cle} » doit être un objet (détail → libellé)`,
    )
    const details = valeur as LigneBrute
    exiger(
      Object.keys(details).length > 0,
      fichier,
      0,
      `« detail_labels » : « ${cle} » : la carte des détails est vide`,
    )
    for (const [detail, libelle] of Object.entries(details)) {
      exiger(
        estChaine(libelle) && (libelle as string).length > 0,
        fichier,
        0,
        `« detail_labels » : le libellé du détail « ${detail} » de « ${cle} » doit être une chaîne non vide`,
      )
    }
    detail_labels[cle] = details as Record<string, string>
  }

  // 6. les sous-groupes — l'ordre de la fiche (le premier est le premier
  //    rendu) ; chaque sous-groupe porte ses indicateurs et sa figure. La
  //    lecture est optionnelle : un slot indicateur-only reste silencieux,
  //    jamais une histoire inventée (#370).
  const subgroupsBrut = meta['subgroups']
  exiger(Array.isArray(subgroupsBrut) && subgroupsBrut.length > 0, fichier, 0, '« subgroups » doit être un tableau non vide')
  const clesGroupes = new Set<string>()
  const indicateursGroupes = new Map<string, number>()
  const histoiresGroupes = new Map<string, number>()
  // L'union des paramètres de lecture DÉCLARÉS, dans l'ordre de première
  // déclaration — la base de la carte param_labels (#318).
  const paramsUniques: string[] = []

  const subgroups = (subgroupsBrut as unknown[]).map((g, i) => {
    const ligneIndexee = i + 1
    exiger(estObjet(g), fichier, ligneIndexee, 'chaque sous-groupe doit être un objet')
    const groupe = g as LigneBrute

    const cle = lireChaine(groupe, 'key', fichier, ligneIndexee)
    exiger(!clesGroupes.has(cle), fichier, ligneIndexee, `clé de sous-groupe en double « ${cle} »`)
    clesGroupes.add(cle)

    const libelle = lireChaine(groupe, 'label', fichier, ligneIndexee)
    exiger(libelle.length > 0, fichier, ligneIndexee, `« ${cle} » : le label est absent ou vide`)
    const framing = lireChaine(groupe, 'framing', fichier, ligneIndexee)
    exiger(framing.length > 0, fichier, ligneIndexee, `« ${cle} » : le cadrage (framing) est absent ou vide`)

    const indicators = lireTableauChaines(groupe, 'indicators', fichier, ligneIndexee)
    exiger(indicators.length > 0, fichier, ligneIndexee, `« ${cle} » : la liste des indicateurs est vide`)
    for (const ind of indicators) {
      exiger(
        indicator_keys.includes(ind),
        fichier,
        ligneIndexee,
        `« ${cle} » : indicateur « ${ind} » hors du registre indicator_keys`,
      )
      indicateursGroupes.set(ind, (indicateursGroupes.get(ind) ?? 0) + 1)
    }

    // la figure — une famille du contrat, un indicateur que le sous-groupe
    // possède (la figure rend la matière du sous-groupe, jamais une autre)
    const figureBrut = groupe['figure']
    exiger(estObjet(figureBrut), fichier, ligneIndexee, `« ${cle} » : la figure est absente ou non-objet`)
    const figure = figureBrut as LigneBrute
    const family = lireChaine(figure, 'family', fichier, ligneIndexee)
    exiger(
      estUneDe(family, FAMILLES_FIGURE),
      fichier,
      ligneIndexee,
      `« ${cle} » : la famille de figure « ${family} » est hors contrat — attendue l'une de ${FAMILLES_FIGURE.join(' | ')}`,
    )
    const indicateurFigure = lireChaine(figure, 'indicator', fichier, ligneIndexee)
    exiger(
      indicators.includes(indicateurFigure),
      fichier,
      ligneIndexee,
      `« ${cle} » : la figure doit rendre un indicateur que le sous-groupe possède`,
    )

    // la lecture résolue — le lien explicite vers l'histoire du sous-groupe
    // (parent #308 : l'app n'infère jamais la relation depuis les noms). Un
    // sous-groupe sans lecture est valide : il ne lie aucune story et ne
    // déclare aucun paramètre/template.
    const readingBrut = groupe['reading']
    if (readingBrut === undefined || readingBrut === null) {
      return {
        key: cle,
        label: libelle,
        framing,
        indicators,
        figure: { family, indicator: indicateurFigure },
      }
    }
    exiger(estObjet(readingBrut), fichier, ligneIndexee, `« ${cle} » : la lecture (reading) est absente ou non-objet`)
    const reading = readingBrut as LigneBrute
    const story_key = lireChaine(reading, 'story_key', fichier, ligneIndexee)
    exiger(
      story_keys.includes(story_key),
      fichier,
      ligneIndexee,
      `« ${cle} » : lien d'histoire inconnu « ${story_key} » — la story doit être déclarée dans story_keys`,
    )
    histoiresGroupes.set(story_key, (histoiresGroupes.get(story_key) ?? 0) + 1)

    // les paramètres de lecture — les valeurs d'histoire que le template peut
    // lire (le lien résolu : la matière de la lecture, jamais inventée)
    const params = reading['params'] === undefined
      ? []
      : lireTableauChaines(reading, 'params', fichier, ligneIndexee)
    for (const p of params) {
      if (!paramsUniques.includes(p)) paramsUniques.push(p)
    }

    // le template — le texte riche TYPÉ
    const template = validerTemplate(reading['template'], fichier, params, cle)
    const readingFigureBrut = reading['figure']
    let readingFigure: { family: FamilleFigure; indicator: string } | undefined
    if (readingFigureBrut !== undefined) {
      exiger(estObjet(readingFigureBrut), fichier, ligneIndexee, `« ${cle} » : reading.figure doit être un objet`)
      const rf = readingFigureBrut as LigneBrute
      const rfFamily = lireChaine(rf, 'family', fichier, ligneIndexee)
      exiger(estUneDe(rfFamily, FAMILLES_FIGURE), fichier, ligneIndexee, `« ${cle} » : famille de reading.figure inconnue`)
      const rfIndicator = lireChaine(rf, 'indicator', fichier, ligneIndexee)
      exiger(params.includes(rfIndicator), fichier, ligneIndexee, `« ${cle} » : reading.figure doit rendre un paramètre déclaré`)
      readingFigure = { family: rfFamily as FamilleFigure, indicator: rfIndicator }
    }

    return {
      key: cle,
      label: libelle,
      framing,
      indicators,
      figure: { family, indicator: indicateurFigure },
      reading: { story_key, params, template, ...(readingFigure ? { figure: readingFigure } : {}) },
    }
  })

  // 7. la bijection sous-groupes ↔ registres : chaque indicateur vit dans
  //    EXACTEMENT un sous-groupe, chaque histoire non-candidate est lue par
  //    EXACTEMENT un sous-groupe — rien d'orphelin, rien de partagé (l'identité
  //    (territoire × groupe) unique du parent #308). Une story déclarée au
  //    registre sans sous-groupe qui la lit est LÉGITIME quand le registre de
  //    résolution la déclare candidate de saillance (ADR-0002) du groupe d'un
  //    sous-groupe déclaré : le pool Mobilité partage SON slot — le candidat
  //    « ce-que-le-velo-preserve » remplace le défaut dans le même groupe,
  //    jamais une lecture en double, jamais un slot supplémentaire.
  const orphelinsInd = indicator_keys.filter((cle) => !indicateursGroupes.has(cle))
  exiger(
    orphelinsInd.length === 0,
    fichier,
    0,
    `indicateur(s) orphelin(s) — déclaré(s) au registre sans sous-groupe : ${orphelinsInd.join(', ')}`,
  )
  const partagesInd = [...indicateursGroupes.entries()].filter(([, n]) => n > 1).map(([cle]) => cle)
  exiger(partagesInd.length === 0, fichier, 0, `indicateur(s) dans plusieurs sous-groupes : ${partagesInd.join(', ')}`)
  const nonLiees = story_keys.filter((cle) => !histoiresGroupes.has(cle))
  const illegitimes = nonLiees.filter((cle) => {
    const groupe = GROUPES_PAR_STORY[theme]?.[cle]
    if (groupe === undefined) return true
    if (RAISON_PAR_STORY[cle] === 'defaut') return true
    return !clesGroupes.has(groupe)
  })
  exiger(
    illegitimes.length === 0,
    fichier,
    0,
    `histoire(s) orpheline(s) — déclarée(s) au registre sans sous-groupe qui la lit, sans être candidate de saillance déclarée (ADR-0002) : ${illegitimes.join(', ')}`,
  )
  const partageesHist = [...histoiresGroupes.entries()].filter(([, n]) => n > 1).map(([cle]) => cle)
  exiger(partageesHist.length === 0, fichier, 0, `histoire(s) lue(s) par plusieurs sous-groupes : ${partageesHist.join(', ')}`)

  // 6bis. les libellés des paramètres de lecture (issue #318) — la carte du
  //      vocabulaire des reading.params : EXACTEMENT l'union des paramètres
  //      déclarés (la bijection, comme indicator_labels), chaque valeur un
  //      libellé français non vide. La carte lit ces libellés pour les
  //      couches de scalaires de Story — jamais le nom brut d'un champ.
  const param_labels = lireCarteChaines(meta, 'param_labels', fichier)
  const sansParam = paramsUniques.filter((p) => !(p in param_labels))
  const fantomesParam = Object.keys(param_labels).filter(
    (p) => !paramsUniques.includes(p),
  )
  exiger(
    sansParam.length === 0 && fantomesParam.length === 0,
    fichier,
    0,
    `« param_labels » : la carte des libellés de paramètres doit déclarer EXACTEMENT les reading.params — sans libellé : ${sansParam.join(', ')} ; non déclarés : ${fantomesParam.join(', ')}`,
  )

  // 6ter. les libellés des classifications (issue #362) — la 4e carte, les
  //      VALEURS de lecture (les quadrants/lectures du pipeline), pas les
  //      paramètres : une lecture qui référence `classification` SANS carte
  //      rendrait la clé brute (attire-meurt) dans le texte français — rejetée.
  //      Présente, la carte doit être NON VIDE de chaînes non vides (la
  //      discipline #318). L'ensemble des clés est piloté par les données (les
  //      valeurs publiées) — la parité complète est la garde de chargement
  //      verifierPariteLibelles, jamais une contrainte de bijection ici.
  const referenceClassification = paramsUniques.includes('classification')
  const classificationLabelsBrut = meta['classification_labels']
  if (referenceClassification) {
    exiger(
      estObjet(classificationLabelsBrut),
      fichier,
      0,
      '« classification_labels » : la carte des libellés de classification est REQUISE dès qu\u2019un reading.params référence « classification » — jamais une clé brute dans le texte',
    )
  }
  let classification_labels: Record<string, string> | undefined
  if (classificationLabelsBrut !== undefined) {
    classification_labels = lireCarteChaines(meta, 'classification_labels', fichier)
    exiger(
      Object.keys(classification_labels).length > 0,
      fichier,
      0,
      '« classification_labels » : la carte des libellés de classification est vide',
    )
  }

  let indicator_pages: ThemeMetadata['indicator_pages']
  if (meta['indicator_pages'] !== undefined) {
    exiger(estObjet(meta['indicator_pages']), fichier, 0, '« indicator_pages » doit être un objet')
    indicator_pages = {}
    for (const [key, raw] of Object.entries(meta['indicator_pages'] as LigneBrute)) {
      exiger(indicator_keys.includes(key) && estObjet(raw), fichier, 0, `« indicator_pages.${key} » doit référencer un indicateur publié`)
      const page = raw as LigneBrute
      exiger(page['vintage'] === undefined, fichier, 0, `« indicator_pages.${key}.vintage » est interdit : la fraîcheur vient des source_records`)
      exiger(page['indicator'] === key, fichier, 0, `« indicator_pages.${key}.indicator » doit correspondre à sa clé`)
      exiger(page['direction'] === 'high' || page['direction'] === 'low', fichier, 0, `« indicator_pages.${key}.direction » doit être high ou low`)
       for (const champ of ['label', 'definition', 'unit', 'calculation', 'direction', 'caveats']) exiger(estChaine(page[champ]) && (page[champ] as string).length > 0, fichier, 0, `« indicator_pages.${key}.${champ} » doit être renseigné`)
      const detail = page['detail']; exiger(detail === undefined || detail === null || estChaine(detail), fichier, 0, `« indicator_pages.${key}.detail » doit être une chaîne ou null`)
      if (detail !== undefined && detail !== null) exiger(estObjet(meta['detail_labels']) && estObjet((meta['detail_labels'] as LigneBrute)[key]) && Object.prototype.hasOwnProperty.call((meta['detail_labels'] as LigneBrute)[key], detail), fichier, 0, `« indicator_pages.${key}.detail » est inconnu`)
      exiger(Array.isArray(page['levels']) && page['levels'].length > 0 && new Set(page['levels'] as unknown[]).size === (page['levels'] as unknown[]).length && (page['levels'] as unknown[]).every((x) => x === 'commune' || x === 'epci' || x === 'departement'), fichier, 0, `« indicator_pages.${key}.levels » est invalide`)
      exiger(Array.isArray(page['sources']) && page['sources'].length > 0 && new Set(page['sources'] as unknown[]).size === (page['sources'] as unknown[]).length && (page['sources'] as unknown[]).every((source) => estChaine(source) && source.length > 0), fichier, 0, `« indicator_pages.${key}.sources » est vide ou invalide`)
      const pageSources = page['sources'] as string[]
      exiger(pageSources.includes(sources[key] as string), fichier, 0, `« indicator_pages.${key}.sources » doit contenir sa source de référence « ${sources[key]} »`)
      exiger(estObjet(meta['source_records']), fichier, 0, '« source_records » est requis par les pages scalaires')
      for (const source of pageSources) { const record = (meta['source_records'] as LigneBrute)[source]; exiger(estObjet(record), fichier, 0, `source référencée « ${source} » introuvable`); for (const field of ['dataset', 'publisher', 'url', 'licence', 'vintage', 'freshness']) exiger(estChaine((record as LigneBrute)[field]) && ((record as LigneBrute)[field] as string).length > 0, fichier, 0, `source.${field} doit être renseignée`) }
        const family = (page['family'] === undefined ? 'scalar' : page['family']) as FamilleFigure
       exiger(estUneDe(family, FAMILLES_FIGURE), fichier, 0, `« indicator_pages.${key}.family » est hors contrat`)
       const comparison = page['comparison']
       if (comparison !== undefined) {
         exiger(estObjet(comparison), fichier, 0, `« indicator_pages.${key}.comparison » doit être un objet`)
         for (const field of ['indicator', 'detail', 'dimension', 'unit']) exiger(comparison[field] === undefined || comparison[field] === null || estChaineNonVide(comparison[field]), fichier, 0, `« indicator_pages.${key}.comparison.${field} » est invalide`)
         for (const field of ['details', 'sexes', 'dimensions']) exiger(comparison[field] === undefined || (Array.isArray(comparison[field]) && (comparison[field] as unknown[]).length > 0 && new Set(comparison[field] as unknown[]).size === (comparison[field] as unknown[]).length && (comparison[field] as unknown[]).every((value) => estChaineNonVide(value))), fichier, 0, `« indicator_pages.${key}.comparison.${field} » est invalide`)
         if (comparison['indicator'] !== undefined) exiger(indicator_keys.includes(comparison['indicator'] as string), fichier, 0, `« indicator_pages.${key}.comparison.indicator » est inconnu`)
         if (comparison['detail'] !== undefined && comparison['details'] !== undefined) exiger((comparison['details'] as unknown[]).includes(comparison['detail']), fichier, 0, `« indicator_pages.${key}.comparison.detail » n'est pas déclaré dans details`)
         if (comparison['sex'] !== undefined && comparison['sex'] !== null && comparison['sexes'] !== undefined) exiger((comparison['sexes'] as unknown[]).includes(comparison['sex']), fichier, 0, `« indicator_pages.${key}.comparison.sex » n'est pas déclaré dans sexes`)
         if (comparison['dimension'] !== undefined && comparison['dimension'] !== null && comparison['dimensions'] !== undefined) exiger((comparison['dimensions'] as unknown[]).includes(comparison['dimension']), fichier, 0, `« indicator_pages.${key}.comparison.dimension » n'est pas déclaré dans dimensions`)
         if (comparison['sexes'] !== undefined) exiger((comparison['sexes'] as unknown[]).every((value) => value === 'F' || value === 'M'), fichier, 0, `« indicator_pages.${key}.comparison.sexes » est invalide`)
         exiger(comparison['sex'] === undefined || comparison['sex'] === null || comparison['sex'] === 'F' || comparison['sex'] === 'M', fichier, 0, `« indicator_pages.${key}.comparison.sex » est invalide`)
         exiger(comparison['direction'] === undefined || comparison['direction'] === 'high' || comparison['direction'] === 'low', fichier, 0, `« indicator_pages.${key}.comparison.direction » est invalide`)
         if (comparison['labels'] !== undefined) exiger(estObjet(comparison['labels']) && Object.values(comparison['labels'] as LigneBrute).every((value) => estChaineNonVide(value)), fichier, 0, `« indicator_pages.${key}.comparison.labels » est invalide`)
       }
        const base: IndicatorPageMetadataBase = { indicator: key, detail: detail === undefined ? null : detail as string | null, label: page['label'] as string, definition: page['definition'] as string, unit: page['unit'] as string, calculation: page['calculation'] as string, direction: page['direction'] as 'high' | 'low', caveats: page['caveats'] as string, levels: page['levels'] as ('commune' | 'epci' | 'departement')[], sources: pageSources, ...(comparison === undefined ? {} : { comparison: comparison as IndicatorPageMetadataBase['comparison'] }) }
       const extensionFields: Record<string, string[]> = { trajectory: ['endpoints'], composition: ['parts'], distribution: ['signature', 'summary'], list: ['categories'], pyramid: ['dimensions'], 'comparison-bars': ['series'] }
       const extensionKey = family === 'comparison-bars' ? 'comparison-bars' : family
       const extension = page[extensionKey]
       for (const candidate of ['trajectory', 'composition', 'distribution', 'relationship', 'list', 'pyramid', 'comparison-bars', 'comparison_bars']) {
         if (candidate !== extensionKey && page[candidate] !== undefined) exiger(false, fichier, 0, `« indicator_pages.${key}.${candidate} » ne correspond pas à la famille déclarée`)
       }
       if (family !== 'scalar') exiger(estObjet(extension), fichier, 0, `« indicator_pages.${key}.${extensionKey} » est requis`)
         if (extension !== undefined) {
         exiger(estObjet(extension), fichier, 0, `« indicator_pages.${key}.${family} » doit être un objet`)
          for (const field of extensionFields[family as string] ?? []) exiger(Array.isArray(extension[field]) ? (extension[field] as unknown[]).length > 0 && (extension[field] as unknown[]).every((value) => estChaineNonVide(value)) : estChaineNonVide(extension[field]), fichier, 0, `« indicator_pages.${key}.${extensionKey}.${field} » est incomplet`)
          if (family === 'composition' || family === 'pyramid') {
            const declared = extension[family === 'composition' ? 'parts' : 'dimensions'] as unknown[]
            // Issue #431 : le miroir strict de valider_theme_metadata — les
            // libellés canonical des parts, les dimensions detail/sex et les
            // sexes de la pyramide sont requis SANS CONDITION (jamais une
            // dérive silencieuse quand detail_labels est absent pour la clé).
            const labels = detail_labels[key] ?? {}
            if (family === 'composition') {
              exiger(declared.every((value) => Object.prototype.hasOwnProperty.call(labels, value as PropertyKey)), fichier, 0, `« indicator_pages.${key}.${extensionKey} » référence un détail sans libellé canonical`)
            } else {
              exiger(declared.includes('detail') && declared.includes('sex'), fichier, 0, `« indicator_pages.${key}.pyramid » doit déclarer detail et sex`)
            }
            if (comparison !== undefined && comparison['details'] !== undefined) {
              exiger(Array.isArray(comparison['details']) && declared.filter((value) => Object.prototype.hasOwnProperty.call(labels, value as PropertyKey)).every((value) => (comparison['details'] as unknown[]).includes(value)), fichier, 0, `« indicator_pages.${key}.comparison.details » ne couvre pas les détails déclarés`)
            }
             if (family === 'pyramid') exiger(comparison !== undefined && Array.isArray(comparison['sexes']) && (comparison['sexes'] as unknown[]).length > 0, fichier, 0, `« indicator_pages.${key}.comparison.sex » est requis pour une pyramide`)
          }
         if (family === 'relationship') { exiger(estObjet(extension['roles']) && estChaineNonVide(extension['roles']['x']) && estChaineNonVide(extension['roles']['y']) && estChaineNonVide(extension['measure']), fichier, 0, `« indicator_pages.${key}.relationship » est incomplet`) }
        }
        const assertNever = (value: never): never => { throw new Error(`Famille de figure non implémentée : ${String(value)}`) }
        switch (family) {
          case 'scalar': indicator_pages[key] = page['family'] === undefined ? base : { ...base, family: 'scalar' }; break
          case 'trajectory': indicator_pages[key] = { ...base, family, trajectory: extension as unknown as TrajectoryMetadata }; break
          case 'composition': indicator_pages[key] = { ...base, family, composition: extension as unknown as CompositionMetadata }; break
          case 'distribution': indicator_pages[key] = { ...base, family, distribution: extension as unknown as DistributionMetadata }; break
          case 'relationship': indicator_pages[key] = { ...base, family, relationship: extension as unknown as RelationshipMetadata }; break
          case 'list': indicator_pages[key] = { ...base, family, list: extension as unknown as ListMetadata }; break
          case 'pyramid': indicator_pages[key] = { ...base, family, pyramid: extension as unknown as PyramidMetadata }; break
          case 'comparison-bars': indicator_pages[key] = { ...base, family, comparisonBars: extension as unknown as ComparisonBarsMetadata }; break
          default: assertNever(family)
        }
    }
  }

  return {
    theme,
    label,
    subgroups,
    indicator_keys,
    story_keys,
    sources: sources as Record<string, string>,
    indicator_labels,
    detail_labels,
    param_labels,
    classification_labels,
    indicator_pages,
    source_records: meta['source_records'] as ThemeMetadata['source_records'],
  }
}

/** Une carte clé → libellé français non vide (le type des trois cartes #318). */
function lireCarteChaines(ligne: LigneBrute, champ: string, fichier: string): Record<string, string> {
  const brut = ligne[champ]
  exiger(estObjet(brut), fichier, 0, `« ${champ} » doit être un objet — la carte des libellés`)
  const carte = brut as LigneBrute
  for (const [cle, valeur] of Object.entries(carte)) {
    exiger(
      estChaine(valeur) && (valeur as string).length > 0,
      fichier,
      0,
      `« ${champ} » : le libellé de « ${cle} » doit être une chaîne non vide`,
    )
  }
  return carte as Record<string, string>
}

/**
 * La parité BIDIRECTIONNELLE libellés ↔ payload (issue #318) — la garde de
 * chargement qui prouve que les libellés sont payload-owned : pour chaque
 * thème présent, chaque ligne (key, detail) publiée dans les faits a son
 * libellé (indicator_labels pour la clé, detail_labels pour le détail) — et
 * aucun libellé de détail déclaré n'est mort (chaque détail déclaré est
 * publié quelque part). La fiche et la carte ne retombent JAMAIS sur la clé
 * brute : c'est cette garde qui garantit que le vocabulaire vit dans les
 * métadonnées. Appelée par le loader à l'assemblage (chargerPayload).
 *
 * Issue #362 — la parité des classifications, UNIDIRECTIONNELLE (publié →
 * libellé) : chaque valeur `classification` non nulle publiée dans
 * histoires_<theme> doit avoir son libellé dans classification_labels — jamais
 * une clé brute (attire-meurt) dans le texte. Contrairement à detail_labels,
 * AUCUNE bijection : les quatre lectures sont le vocabulaire complet du thème,
 * un quadrant légitimement vide dans les données actuelles garde son libellé
 * (le libellé reste vrai pour la lecture que le pipeline émettra demain).
 */
export function verifierPariteLibelles(payload: Payload): void {
  const violations: string[] = []
  for (const [theme, meta] of Object.entries(payload.themeMetadata ?? {})) {
    const indicateursTheme = payload.indicateurs.filter((i) => i.theme === theme)

    for (const ligne of indicateursTheme) {
      if (!(ligne.key in meta.indicator_labels)) {
        violations.push(`${theme}: indicateur « ${ligne.key} » publié sans libellé (indicator_labels)`)
      }
      if (ligne.detail !== null) {
        const carte = meta.detail_labels[ligne.key]
        if (!carte || !(ligne.detail in carte)) {
          violations.push(`${theme}: détail « ${ligne.detail} » de « ${ligne.key} » publié sans libellé (detail_labels)`)
        }
      }
    }

    for (const [cle, carte] of Object.entries(meta.detail_labels)) {
      const publies = new Set(
        indicateursTheme
          .filter((i) => i.key === cle && i.detail !== null)
          .map((i) => i.detail as string),
      )
      for (const detail of Object.keys(carte)) {
        if (!publies.has(detail)) {
          violations.push(`${theme}: détail « ${detail} » de « ${cle} » déclaré jamais publié (libellé mort)`)
        }
      }
    }

    // Issue #362 — la parité des classifications : chaque valeur publiée a son
    // libellé (direction unique, jamais la clé brute ; les libellés au-delà
    // des valeurs publiées restent légitimes — un quadrant vide garde le sien).
    if (meta.classification_labels) {
      const classificationsPubliees = new Set(
        payload.histoires
          .filter(
            (h) => h.theme === theme && (h as unknown as LigneBrute)['classification'] !== null,
          )
          .map((h) => (h as unknown as LigneBrute)['classification'] as string),
      )
      for (const valeur of classificationsPubliees) {
        if (!(valeur in meta.classification_labels)) {
          violations.push(`${theme}: classification « ${valeur} » publiée sans libellé (classification_labels)`)
        }
      }
    }
  }
  if (violations.length > 0) {
    throw new PayloadError(
      'validation',
      'theme_<theme>.json',
      `Parité libellés ↔ payload rompue — ${violations.join(' · ')}`,
    )
  }
}
