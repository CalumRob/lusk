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

export function payloadPourCarte(payload: Payload, facet: ComparisonFacet, niveau: NiveauIndicateur, departement?: string, epci?: string): Payload {
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
  const values = all.map((row) => row.value).sort((a, b) => a - b)
  const median = values.length % 2 ? values[(values.length - 1) / 2] : values.length ? (values[values.length / 2 - 1] + values[values.length / 2]) / 2 : null
  const ranked = [...all].sort((a, b) => facet.direction === 'low' ? a.value - b.value : b.value - a.value)
  const ranks = new Map<string, number>()
  ranked.forEach((row, index) => ranks.set(row.territoire.territoire, index && row.value === ranked[index - 1].value ? ranks.get(ranked[index - 1].territoire.territoire)! : index + 1))
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
  const density = estimerDensite(values)
  const selected = all.find((row) => row.territoire.territoire === requested.territoire)?.value ?? null
  return { state: { niveau, departement: niveau === 'commune' ? requested.departement : undefined, epci: niveau === 'commune' ? requested.epci : undefined, territoire: requested.territoire, recherche: requested.recherche, tri, ordre }, rows, median, distribution: values, density, high: { count: highRows.length, rows: highRows.length === 1 ? highRows : [] }, low: { count: lowRows.length, rows: lowRows.length === 1 ? lowRows : [] }, scopeLabel: requested.departement ? `Département ${requested.departement}` : requested.epci ? `EPCI ${requested.epci}` : 'Bretagne', direction: facet.direction, markerX: positionDensite(density, selected), markerY: hauteurDensite(density, selected) }
}
