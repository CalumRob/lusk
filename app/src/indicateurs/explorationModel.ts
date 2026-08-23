import type { Indicateur, Payload, Territoire, TerritoireType } from '@/payload/types'
import type { ComparisonFacet } from './familySeam'

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

export function payloadPourCarte(payload: Payload, facet: ComparisonFacet, etat: { niveau: NiveauIndicateur; departement?: string; epci?: string }): Payload {
  const { niveau, departement, epci } = etat
  const ids = new Set(payload.territoires.filter((territory) => territory.type === niveau && (niveau !== 'commune' || ((!departement || territory.departement === departement) && (!epci || territory.epci === epci)))).map((territory) => territory.territoire))
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
  const dansScope = (territoire: Territoire) => territoire.type === niveau && (niveau !== 'commune' || ((!requested.departement || territoire.departement === requested.departement) && (!requested.epci || territoire.epci === requested.epci)))
  const refs = new Map(territoires.map((territoire) => [territoire.territoire, territoire] as const))
  const all = facts.filter((fact) => fact.theme === facet.theme && fact.key === facet.indicator && fact.detail === facet.detail && (facet.sex === null || (fact.sex ?? null) === facet.sex) && (facet.dimension === null || (fact.dimension ?? null) === facet.dimension) && fact.type === niveau && fact.value !== null).map((fact) => ({ territoire: refs.get(fact.territoire), value: fact.value as number })).filter((row): row is { territoire: Territoire; value: number } => Boolean(row.territoire && dansScope(row.territoire)))
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
  const dansScope = (territoire: Territoire) => territoire.type === etat.niveau && (etat.niveau !== 'commune' || ((!etat.departement || territoire.departement === etat.departement) && (!etat.epci || territoire.epci === etat.epci)))

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
    const rows = facts.filter((fact) => fact.theme === facet.theme && fact.key === facet.indicator && fact.detail === detail && (facet.sex === null || (fact.sex ?? null) === facet.sex) && (facet.dimension === null || (fact.dimension ?? null) === facet.dimension) && fact.type === etat.niveau).map((fact) => ({ territoire: refs.get(fact.territoire), value: fact.value })).filter((row): row is { territoire: Territoire; value: number | null } => Boolean(row.territoire && dansScope(row.territoire)))
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
  const serieTerritoire = refSelectionne && dansScope(refSelectionne)
    ? lignes.map((ligne) => {
        const row = facts.find((fact) => fact.theme === facet.theme && fact.key === facet.indicator && fact.detail === ligne.detail && (facet.sex === null || (fact.sex ?? null) === facet.sex) && (facet.dimension === null || (fact.dimension ?? null) === facet.dimension) && fact.territoire === refSelectionne.territoire)
        return { detail: ligne.detail, label: ligne.label, x: ligne.x, value: row ? row.value : null } satisfies PointTrajectoire
      })
    : null

  return { etapes: lignes, domaineValeurs, serieTerritoire }
}
