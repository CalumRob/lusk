import type { Indicateur, Payload, Territoire, TerritoireType } from '@/payload/types'
import type { ComparisonFacet } from './familySeam'
import type { IndicatorPageMetadata } from '@/payload/types'

export type NiveauIndicateur = Extract<TerritoireType, 'commune' | 'epci' | 'departement'>
export type DirectionIndicateur = 'high' | 'low'
export type TriExploration = 'nom' | 'valeur' | 'rang'
export type OrdreExploration = 'asc' | 'desc'
export interface EtatExploration { niveau?: NiveauIndicateur; departement?: string; epci?: string; territoire?: string; recherche?: string; tri?: TriExploration; ordre?: OrdreExploration }
export interface DensitePoint { x: number; density: number; y: number }
export interface LigneExploration { territoire: Territoire; value: number; rang: number; rangTaille: number; fiche: string; highlighted: boolean }
export interface Extreme { count: number; rows: LigneExploration[] }
export interface ModeleExploration { state: Required<Pick<EtatExploration, 'niveau'>> & EtatExploration; rows: LigneExploration[]; median: number | null; distribution: number[]; density: DensitePoint[]; high: Extreme; low: Extreme; scopeLabel: string; direction: DirectionIndicateur; markerX: number | null; markerY: number | null }

const niveaux: NiveauIndicateur[] = ['commune', 'epci', 'departement']
export const niveauLePlusFin = (supported: readonly TerritoireType[]): NiveauIndicateur => niveaux.find((n) => supported.includes(n)) ?? 'commune'

/**
 * La médiane d'une série — null pour une série vide. L'unique implémentation
 * du codebase (#437) : Repères et les quatre familles de la grammaire la
 * réutilisent, jamais une copie privée.
 */
export function mediane(values: readonly number[]): number | null {
  if (!values.length) return null
  const tries = [...values].sort((a, b) => a - b)
  const milieu = Math.floor(tries.length / 2)
  return tries.length % 2 ? tries[milieu] : (tries[milieu - 1] + tries[milieu]) / 2
}

/**
 * Le rang ordinal directionnel et ex-aequo (ADR-0015, CONTEXT.md Rang) :
 * 1 = meilleur (direction low compte depuis la plus basse valeur, high depuis
 * la plus haute), les égalités partagent le rang et le rang suivant saute —
 * « 1, 1, 3 » (classement en concurrence). Retourne le rang de chaque entrée,
 * dans l'ordre d'entrée. L'unique implémentation du codebase (#437).
 */
export function rangsExAequo(values: readonly number[], direction: DirectionIndicateur): number[] {
  const tries = [...values].sort((a, b) => direction === 'low' ? a - b : b - a)
  const rangParValeur = new Map<number, number>()
  tries.forEach((value, index) => {
    const precedent = index > 0 ? tries[index - 1] : null
    rangParValeur.set(value, precedent !== null && precedent === value ? rangParValeur.get(precedent)! : index + 1)
  })
  return values.map((value) => rangParValeur.get(value)!)
}

/**
 * L'appartenance au périmètre actif (#438, revue) — LE prédicat unique du
 * module : un territoire du niveau demandé, resserré aux filtres
 * département/EPCI au niveau commune seulement. Repères, la carte par état
 * et les trajectoires lisent LA même appartenance, jamais trois copies.
 */
export function dansScope(territoire: Territoire, niveau: NiveauIndicateur, departement?: string, epci?: string): boolean {
  return territoire.type === niveau && (niveau !== 'commune' || ((!departement || territoire.departement === departement) && (!epci || territoire.epci === epci)))
}

export function payloadPourCarte(payload: Payload, facet: ComparisonFacet, etat: { niveau: NiveauIndicateur; departement?: string; epci?: string }): Payload {
  const { niveau, departement, epci } = etat
  const ids = new Set(payload.territoires.filter((territory) => dansScope(territory, niveau, departement, epci)).map((territory) => territory.territoire))
  return { ...payload, indicateurs: payload.indicateurs.filter((fact) => fact.theme === facet.theme && fact.key === facet.indicator && fact.detail === facet.detail && (fact.sex ?? null) === facet.sex && (fact.dimension ?? null) === facet.dimension && fact.type === niveau && ids.has(fact.territoire)) }
}

/** KDE points retain the data-domain x and expose y in a stable 0..100 plot space. */
export function estimerDensite(values: readonly number[], samples = 64): DensitePoint[] {
  if (!values.length) return []
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min
  const bandwidth = Math.max(span / 8, 1e-9)
  const points = Array.from({ length: samples }, (_, index) => {
    const x = span === 0 ? min : min + (span * index) / (samples - 1)
    const density = values.reduce((sum, value) => sum + Math.exp(-0.5 * ((x - value) / bandwidth) ** 2), 0) / (values.length * bandwidth)
    return { x, density: Number.isFinite(density) ? Math.max(0, density) : 0, y: 0 }
  })
  const maximum = Math.max(...points.map((point) => point.density), 0)
  return points.map((point) => ({ ...point, y: maximum > 0 ? 100 - (point.density / maximum) * 100 : 50 }))
}

export function positionDensite(density: readonly DensitePoint[], value: number | null): number | null {
  if (!density.length || value === null) return null
  const min = density[0].x
  const max = density[density.length - 1].x
  return max === min ? 50 : ((value - min) / (max - min)) * 100
}

export function hauteurDensite(density: readonly DensitePoint[], value: number | null): number | null {
  if (!density.length || value === null) return null
  if (density.length === 1 || density[0].x === density[density.length - 1].x) return density[0].y
  const index = density.findIndex((point, i) => i > 0 && point.x >= value)
  if (index < 0) return value <= density[0].x ? density[0].y : density[density.length - 1].y
  const before = density[index - 1]
  const after = density[index]
  const fraction = (value - before.x) / (after.x - before.x)
  return before.y + (after.y - before.y) * fraction
}

export function modeleExploration(facts: readonly Indicateur[], facet: ComparisonFacet, territoires: readonly Territoire[], requested: EtatExploration = {}, remembered?: string): ModeleExploration {
  const supported = facet.levels.filter((level): level is NiveauIndicateur => niveaux.includes(level as NiveauIndicateur))
  const niveau = requested.niveau && supported.includes(requested.niveau) ? requested.niveau : remembered && supported.includes(remembered as NiveauIndicateur) ? remembered as NiveauIndicateur : niveauLePlusFin(supported)
  const refs = new Map(territoires.map((territoire) => [territoire.territoire, territoire] as const))
  const all = facts.filter((fact) => fact.theme === facet.theme && fact.key === facet.indicator && fact.detail === facet.detail && (facet.sex === null || (fact.sex ?? null) === facet.sex) && (facet.dimension === null || (fact.dimension ?? null) === facet.dimension) && fact.type === niveau && fact.value !== null).map((fact) => ({ territoire: refs.get(fact.territoire), value: fact.value as number })).filter((row): row is { territoire: Territoire; value: number } => Boolean(row.territoire && dansScope(row.territoire, niveau, requested.departement, requested.epci)))
  const values = all.map((row) => row.value)
  // La série triée du modèle (la comparaison inter-territoires de Repères) :
  // la médiane et la densité lisent la même série triée que avant #437.
  const distribution = [...values].sort((a, b) => a - b)
  const median = mediane(distribution)
  const rangsCalcules = rangsExAequo(values, facet.direction)
  const ranks = new Map(all.map((row, index) => [row.territoire.territoire, rangsCalcules[index]] as const))
  const project = (row: { territoire: Territoire; value: number }): LigneExploration => ({ territoire: row.territoire, value: row.value, rang: ranks.get(row.territoire.territoire)!, rangTaille: all.length, fiche: `/territoire/${row.territoire.type}/${row.territoire.territoire}?theme=${facet.theme}`, highlighted: row.territoire.territoire === requested.territoire })
  const filtered = all.filter((row) => !requested.recherche || row.territoire.nom.toLocaleLowerCase('fr').includes(requested.recherche.toLocaleLowerCase('fr')))
  const tri = requested.tri ?? 'nom'
  const ordre = requested.ordre ?? 'asc'
  const factor = ordre === 'asc' ? 1 : -1
  const rows = [...filtered].sort((a, b) => {
    if (tri === 'nom') return factor * a.territoire.nom.localeCompare(b.territoire.nom, 'fr')
    if (tri === 'rang') return factor * (ranks.get(a.territoire.territoire)! - ranks.get(b.territoire.territoire)!)
    return factor * (a.value - b.value)
  }).map(project)
  const highRows = all.filter((row) => row.value === Math.max(...all.map((item) => item.value))).map(project)
  const lowRows = all.filter((row) => row.value === Math.min(...all.map((item) => item.value))).map(project)
  const density = estimerDensite(distribution)
  const selected = all.find((row) => row.territoire.territoire === requested.territoire)?.value ?? null
  return { state: { niveau, departement: niveau === 'commune' ? requested.departement : undefined, epci: niveau === 'commune' ? requested.epci : undefined, territoire: requested.territoire, recherche: requested.recherche, tri, ordre }, rows, median, distribution, density, high: { count: highRows.length, rows: highRows.length === 1 ? highRows : [] }, low: { count: lowRows.length, rows: lowRows.length === 1 ? lowRows : [] }, scopeLabel: requested.departement ? `Département ${requested.departement}` : requested.epci ? `EPCI ${requested.epci}` : 'Bretagne', direction: facet.direction, markerX: positionDensite(density, selected), markerY: hauteurDensite(density, selected) }
}

/**
 * Le modèle Repères des trajectoires (#438) — le chemin complet de
 * l'indicateur dans le périmètre actif, à côté du modèle par détail
 * (modeleExploration) qui reste la matière des extrêmes, du tableau et de la
 * carte : le détail (actif) pilote tout cela SANS replier la trajectoire.
 *
 * Deux règles d'honnêteté, verrouillées par test :
 *  - les échelles se dérivent des VALEURES RÉELLES du chemin — jamais un
 *    bornage brut sur une plage de pixels fixe (le défaut du PR supplanté :
 *    prix_m2 aplati sur une ligne) ;
 *  - points ET libellés lisent LA MÊME échelle proportionnelle au temps —
 *    une année = sa position réelle dans la fenêtre (jamais un index pair).
 *
 * Les bornes déclarées de la trajectoire (`endpoints` — états OCS-GE M2/M3
 * pour artif_par_habitant) restent des étapes de l'axe même sans valeur : le
 * payload déclare, l'app rend (ADR-0023) — un état initial/final sans donnée
 * est rendu vide, jamais effacé du chemin. Les bornes non annuelles ancrent
 * les extrémités de la fenêtre : l'état initial avant la première année, l'état
 * final après la dernière.
 */
export interface EtapeTrajectoire {
  detail: string
  label: string
  /** La position 0..100 sur l'échelle partagée — points et libellés lisent LA MÊME coordonnée. */
  x: number
  /** L'étalement territorial du détail dans le périmètre actif — null sans valeur. */
  min: number | null
  mediane: number | null
  max: number | null
  nValeurs: number
  nManquantes: number
}
export interface PointTrajectoire { detail: string; label: string; x: number; value: number | null }
export interface ModeleTrajectoire {
  etapes: readonly EtapeTrajectoire[]
  /** Le domaine des valeurs RÉELLES de tout le chemin — null sans aucune valeur. */
  domaineValeurs: { min: number | null; max: number | null }
  /** Le chemin du territoire mis en avant (null quand il est hors périmètre). */
  serieTerritoire: readonly PointTrajectoire[] | null
}

const ANNEE_DETAIL = /^\d{4}$/

export function modeleTrajectoire(
  facts: readonly Indicateur[],
  facet: ComparisonFacet,
  endpoints: readonly string[],
  territoires: readonly Territoire[],
  etat: { niveau: NiveauIndicateur; departement?: string; epci?: string; territoire?: string },
): ModeleTrajectoire {
  const details = facet.details
  const refs = new Map(territoires.map((territoire) => [territoire.territoire, territoire] as const))

  // L'échelle temporelle partagée — UNE coordonnée par détail déclaré. Une
  // année siège à SA place dans la fenêtre ; une borne déclarée non annuelle
  // (M2/M3) ancre l'extrémité hors de la plage des années ; le repli ordinal
  // (détail ni année ni borne, fenêtre sans années) reste déterministe.
  const annees = details.filter((detail) => ANNEE_DETAIL.test(detail)).map(Number)
  const coordonnees = new Map<string, number>()
  details.forEach((detail, index) => {
    if (ANNEE_DETAIL.test(detail)) coordonnees.set(detail, Number(detail))
    else if (annees.length && detail === endpoints[0]) coordonnees.set(detail, Math.min(...annees) - 1)
    else if (annees.length && detail === endpoints[endpoints.length - 1]) coordonnees.set(detail, Math.max(...annees) + 1)
    else coordonnees.set(detail, index)
  })
  const bornesTemps = [...coordonnees.values()]
  const tMin = Math.min(...bornesTemps)
  const tMax = Math.max(...bornesTemps)
  const xDe = (detail: string) => {
    const coordonnee = coordonnees.get(detail)!
    return tMax === tMin ? 0 : ((coordonnee - tMin) / (tMax - tMin)) * 100
  }

  const lignes = details.map((detail) => {
    const rows = facts.filter((fact) => fact.theme === facet.theme && fact.key === facet.indicator && fact.detail === detail && (facet.sex === null || (fact.sex ?? null) === facet.sex) && (facet.dimension === null || (fact.dimension ?? null) === facet.dimension) && fact.type === etat.niveau).map((fact) => ({ territoire: refs.get(fact.territoire), value: fact.value })).filter((row): row is { territoire: Territoire; value: number | null } => Boolean(row.territoire && dansScope(row.territoire, etat.niveau, etat.departement, etat.epci)))
    const valeurs = rows.filter((row) => row.value !== null).map((row) => row.value as number)
    return {
      detail,
      label: facet.labels[detail] ?? detail,
      x: xDe(detail),
      min: valeurs.length ? Math.min(...valeurs) : null,
      mediane: mediane(valeurs),
      max: valeurs.length ? Math.max(...valeurs) : null,
      nValeurs: valeurs.length,
      nManquantes: rows.length - valeurs.length,
    } satisfies EtapeTrajectoire
  }).sort((a, b) => (coordonnees.get(a.detail)! - coordonnees.get(b.detail)!) || (details.indexOf(a.detail) - details.indexOf(b.detail)))

  const valeursDuChemin = lignes.flatMap((ligne) => [ligne.min, ligne.max].filter((valeur): valeur is number => valeur !== null))
  const domaineValeurs = { min: valeursDuChemin.length ? Math.min(...valeursDuChemin) : null, max: valeursDuChemin.length ? Math.max(...valeursDuChemin) : null }

  const refSelectionne = etat.territoire ? refs.get(etat.territoire) : undefined
  const serieTerritoire = refSelectionne && dansScope(refSelectionne, etat.niveau, etat.departement, etat.epci)
    ? lignes.map((ligne) => {
        const row = facts.find((fact) => fact.theme === facet.theme && fact.key === facet.indicator && fact.detail === ligne.detail && (facet.sex === null || (fact.sex ?? null) === facet.sex) && (facet.dimension === null || (fact.dimension ?? null) === facet.dimension) && fact.territoire === refSelectionne.territoire)
        return { detail: ligne.detail, label: ligne.label, x: ligne.x, value: row ? row.value : null } satisfies PointTrajectoire
      })
    : null

  return { etapes: lignes, domaineValeurs, serieTerritoire }
}

/**
 * Le modèle Repères des relations (#441) — le nuage croisé déclaré par la
 * page (deux rôles étiquetés x × y) à côté de la comparaison inter-
 * territoires que la facette scalaire pilote seule (médiane, extrêmes,
 * tableau, carte — la matière modeleExploration existante). Les points du
 * nuage SONT les lignes du tableau : même population facet-comparable, même
 * rang directionnel ex-aequo (#437), même surlignage, même passarelle fiche —
 * par construction, jamais deux listes qui divergent.
 */
export interface PointRelation { territoire: Territoire; valeur: number | null; rang: number | null; rangTaille: number; fiche: string; highlighted: boolean; /** Les coordonnées publiées du nuage — null quand un axe manque. */ x: number | null; y: number | null }
export interface AxeRelation { label: string; unit: string; /** Le domaine RÉEL des valeurs tracées — jamais une plage fixe. */ min: number | null; max: number | null }
export interface ModeleRelation {
  // Les quatre états honnêtes — le contrat commun des modèles Repères,
  // résolu par le squelette partagé selectionTerritoire (#441).
  etat: 'complet' | 'incomplet' | 'absent' | null
  nom: string | null
  message: string | null
  points: readonly PointRelation[]
  /** Les points sans coordonnée complète — dits honnêtement, JAMAIS empilés à coordonnées fixes (le défaut du PR supplanté). */
  incomplets: readonly PointRelation[]
  axeX: AxeRelation
  axeY: AxeRelation
}

export function modeleRelation(
  rows: readonly LigneExploration[],
  faits: readonly Indicateur[],
  facet: ComparisonFacet,
  page: IndicatorPageMetadata,
  territoires: readonly Territoire[],
  etat: { niveau: NiveauIndicateur; departement?: string; epci?: string; territoire?: string },
): ModeleRelation {
  const roles = page.family === 'relationship' ? page.relationship.roles : null
  // La coordonnée d'un rôle : THÈME × CLÉ × DÉTAIL du rôle (la leçon de
  // parité #438), le sexe/dimension suivant la facette, au niveau demandé.
  const coordonneesDe = (role: { indicator: string; detail: string | null }): Map<string, number> => {
    const valeurs = new Map<string, number>()
    if (!roles) return valeurs
    for (const fact of faits) {
      if (fact.theme !== facet.theme || fact.key !== role.indicator || (fact.detail ?? null) !== role.detail) continue
      if ((facet.sex === null || (fact.sex ?? null) === facet.sex) && (facet.dimension === null || (fact.dimension ?? null) === facet.dimension) && fact.type === etat.niveau && fact.value !== null) valeurs.set(fact.territoire, fact.value)
    }
    return valeurs
  }
  const axeXValeurs = roles ? coordonneesDe(roles.x) : new Map<string, number>()
  const axeYValeurs = roles ? coordonneesDe(roles.y) : new Map<string, number>()
  const points: readonly PointRelation[] = rows.map((row) => ({ territoire: row.territoire, valeur: row.value, rang: row.rang, rangTaille: row.rangTaille, fiche: row.fiche, highlighted: row.highlighted, x: axeXValeurs.get(row.territoire.territoire) ?? null, y: axeYValeurs.get(row.territoire.territoire) ?? null }))
  const incomplets = points.filter((point) => point.x === null || point.y === null)
  // Les domaines se dérivent des valeurs TRACÉES seulement (paires complètes)
  // — une valeur manquante n'écrase jamais l'échelle, un bornage fixe jamais.
  const traces = points.filter((point) => point.x !== null && point.y !== null)
  const domaineDe = (axe: 'x' | 'y'): { min: number | null; max: number | null } => {
    const valeurs = traces.map((point) => (axe === 'x' ? point.x : point.y) as number)
    return valeurs.length ? { min: Math.min(...valeurs), max: Math.max(...valeurs) } : { min: null, max: null }
  }
  const axeX: AxeRelation = { label: roles?.x.label ?? '', unit: roles?.x.unit ?? '', ...domaineDe('x') }
  const axeY: AxeRelation = { label: roles?.y.label ?? '', unit: roles?.y.unit ?? '', ...domaineDe('y') }

  // L'état du territoire sélectionné lit la trame partagée (#441) ; le
  // complet/incomplet décide sur SA matière : la paire de coordonnées.
  const selection = selectionTerritoire(territoires, etat)
  if (selection.kind === 'silence') return { etat: null, nom: null, message: null, points, incomplets, axeX, axeY }
  if (selection.kind === 'horsScope') return { etat: 'absent', nom: selection.nom, message: selection.message, points, incomplets, axeX, axeY }
  const ref = selection.ref
  const xSelection = axeXValeurs.get(ref.territoire) ?? null
  const ySelection = axeYValeurs.get(ref.territoire) ?? null
  return xSelection === null || ySelection === null
    ? { etat: 'incomplet', nom: ref.nom, message: `${ref.nom} : relation incomplète à ce niveau.`, points, incomplets, axeX, axeY }
    : { etat: 'complet', nom: ref.nom, message: null, points, incomplets, axeX, axeY }
}

/**
 * Le squelette partagé des modèles multi-états Repères (#441) — la leçon de
 * la revue #453 : la trame null/absent vivait en DEUX exemplaires identiques
 * (modeleSignature #440, modeleProfil #439) ; la relation (#441) en aurait
 * fait un troisième. La résolution de la sélection est UNE — silence (aucun
 * territoire demandé), hors périmètre (« absent à ce niveau », JAMAIS habillé
 * en suppression), territoire actif — et chaque famille décide ensuite seule
 * de son complet/incomplet sur sa propre matière.
 */
export type SelectionTerritoire =
  | { kind: 'silence' }
  | { kind: 'horsScope'; nom: string | null; message: string }
  | { kind: 'active'; ref: Territoire }

export function selectionTerritoire(
  territoires: readonly Territoire[],
  etat: { niveau: NiveauIndicateur; departement?: string; epci?: string; territoire?: string },
): SelectionTerritoire {
  if (!etat.territoire) return { kind: 'silence' }
  const ref = territoires.find((territoire) => territoire.territoire === etat.territoire)
  if (!ref || !dansScope(ref, etat.niveau, etat.departement, etat.epci)) {
    return ref
      ? { kind: 'horsScope', nom: ref.nom, message: `${ref.nom} : territoire absent à ce niveau de comparaison.` }
      : { kind: 'horsScope', nom: null, message: 'Territoire sélectionné absent à ce niveau de comparaison.' }
  }
  return { kind: 'active', ref }
}

/**
 * Le modèle de la signature intra-territoire des distributions (#440) — les
 * détails déclarés (la signature fermée) du territoire sélectionné, à côté de
 * la comparaison inter-territoires que la facette résumée pilote seule.
 *
 * Quatre états HONNÊTES, verrouillés par test — jamais un résumé inventé :
 *  - null : aucun territoire sélectionné — rien n'est affirmé ;
 *  - 'absent' : le territoire sélectionné n'existe pas à ce niveau (une
 *    commune dans une comparaison d'EPCIs…) — JAMAIS confondu avec une
 *    suppression (le défaut du PR supplanté, qui inventait un motif) ;
 *  - 'incomplet' : le territoire EST dans le périmètre mais sa distribution
 *    est incomplète ou supprimée (complétude all-or-nothing déclarée) ;
 *  - 'complet' : les barres portent les valeurs publiées du territoire.
 */
export interface BarreSignature { detail: string; label: string; valeur: number | null }
export interface ModeleSignature {
  etat: 'complet' | 'incomplet' | 'absent' | null
  nom: string | null
  message: string | null
  /** L'unité déclarée des faits de la signature — la facette ne pilote PAS ce bloc. */
  unite: string | null
  barres: readonly BarreSignature[]
}

export function modeleSignature(
  faits: readonly Indicateur[],
  facet: ComparisonFacet,
  page: IndicatorPageMetadata,
  territoires: readonly Territoire[],
  labels: Record<string, string>,
  etat: { niveau: NiveauIndicateur; departement?: string; epci?: string; territoire?: string },
): ModeleSignature {
  const details = page.family === 'distribution' ? [...page.distribution.signature] : []
  const barresDe = (valeurs: ReadonlyMap<string, number>): BarreSignature[] => details.map((detail) => ({ detail, label: labels[detail] ?? detail, valeur: valeurs.get(detail) ?? null }))
  // La trame null/absent du squelette partagé (#441) — un seul exemplaire.
  const selection = selectionTerritoire(territoires, etat)
  if (selection.kind === 'silence') return { etat: null, nom: null, message: null, unite: null, barres: barresDe(new Map()) }
  if (selection.kind === 'horsScope') return { etat: 'absent', nom: selection.nom, message: selection.message, unite: null, barres: barresDe(new Map()) }
  const ref = selection.ref
  // Le filtre des faits est THÈME × CLÉ (la leçon de parité #438) — les clés
  // ne sont pas uniques entre thèmes ; le sexe/dimension suivent la facette.
  const lignes = faits.filter((fact) => fact.theme === facet.theme && fact.key === page.indicator && fact.type === etat.niveau && fact.territoire === ref.territoire && fact.detail !== null && details.includes(fact.detail) && (facet.sex === null || (fact.sex ?? null) === facet.sex) && (facet.dimension === null || (fact.dimension ?? null) === facet.dimension))
  const valeurs = new Map<string, number>()
  let unite: string | null = null
  for (const ligne of lignes) {
    if (ligne.value !== null) {
      valeurs.set(ligne.detail as string, ligne.value)
      unite ??= ligne.unit ?? null
    }
  }
  return details.every((detail) => valeurs.has(detail))
    ? { etat: 'complet', nom: ref.nom, message: null, unite, barres: barresDe(valeurs) }
    : { etat: 'incomplet', nom: ref.nom, message: `${ref.nom} : distribution incomplète ou supprimée à ce niveau.`, unite, barres: barresDe(valeurs) }
}

/**
 * Le modèle du profil complet des listes (#439) — les catégories déclarées
 * (la liste fermée de la page) du territoire sélectionné, à côté de la
 * comparaison inter-territoires que la catégorie comparée pilote seule (la
 * matière modeleExploration : médiane, extrêmes, tableau, carte).
 *
 * Quatre états HONNÊTES, verrouillés par test — le même contrat que la
 * signature des distributions (#440), JAMAIS un résumé inventé ni une
 * réécriture silencieuse d'une catégorie demandée invalide (le défaut du PR
 * supplanté, qui repliait sur la première catégorie) :
 *  - null : aucun territoire sélectionné — rien n'est affirmé ;
 *  - 'absent' : le territoire sélectionné n'existe pas à ce niveau — JAMAIS
 *    confondu avec un profil incomplet ;
 *  - 'incomplet' : le territoire EST dans le périmètre mais son profil ne
 *    porte pas toutes les catégories déclarées ;
 *  - 'complet' : les lignes portent les valeurs publiées du territoire,
 *    dans l'ordre DÉCLARÉ des catégories — les métadonnées possèdent l'ordre.
 */
export interface LigneProfil { detail: string; label: string; valeur: number | null; /** L'unité PUBLIÉE de la catégorie — les listes portent des unités hétérogènes. */ unite: string | null }
export interface ModeleProfil {
  etat: 'complet' | 'incomplet' | 'absent' | null
  nom: string | null
  message: string | null
  lignes: readonly LigneProfil[]
}

export function modeleProfil(
  faits: readonly Indicateur[],
  facet: ComparisonFacet,
  page: IndicatorPageMetadata,
  territoires: readonly Territoire[],
  labels: Record<string, string>,
  etat: { niveau: NiveauIndicateur; departement?: string; epci?: string; territoire?: string },
): ModeleProfil {
  // La liste fermée déclarée par la page — l'app rend ce que le payload
  // déclare (ADR-0023), jamais un vocabulaire dérivé des faits.
  const categories = page.family === 'list' ? [...page.list.categories] : []
  const lignesDe = (valeurs: ReadonlyMap<string, number>, unites: ReadonlyMap<string, string>): LigneProfil[] =>
    categories.map((detail) => ({ detail, label: labels[detail] ?? detail, valeur: valeurs.get(detail) ?? null, unite: unites.get(detail) ?? null }))
  // La trame null/absent du squelette partagé (#441) — un seul exemplaire.
  const selection = selectionTerritoire(territoires, etat)
  if (selection.kind === 'silence') return { etat: null, nom: null, message: null, lignes: lignesDe(new Map(), new Map()) }
  if (selection.kind === 'horsScope') return { etat: 'absent', nom: selection.nom, message: selection.message, lignes: lignesDe(new Map(), new Map()) }
  const ref = selection.ref
  // Le filtre des faits est THÈME × CLÉ (la leçon de parité #438) — le profil
  // lit la clé PROPRE de la page ; le sexe/dimension suivent la facette.
  const lignes = faits.filter((fact) => fact.theme === facet.theme && fact.key === page.indicator && fact.type === etat.niveau && fact.territoire === ref.territoire && fact.detail !== null && categories.includes(fact.detail) && (facet.sex === null || (fact.sex ?? null) === facet.sex) && (facet.dimension === null || (fact.dimension ?? null) === facet.dimension))
  const valeurs = new Map<string, number>()
  const unites = new Map<string, string>()
  for (const ligne of lignes) {
    if (!categories.includes(ligne.detail as string)) continue
    unites.set(ligne.detail as string, ligne.unit)
    if (ligne.value !== null) valeurs.set(ligne.detail as string, ligne.value)
  }
  return categories.every((detail) => valeurs.has(detail))
    ? { etat: 'complet', nom: ref.nom, message: null, lignes: lignesDe(valeurs, unites) }
    : { etat: 'incomplet', nom: ref.nom, message: `${ref.nom} : profil incomplet à ce niveau.`, lignes: lignesDe(valeurs, unites) }
}
