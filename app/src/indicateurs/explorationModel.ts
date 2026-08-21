import type { Indicateur, Territoire, TerritoireType, ThemeMetadata } from '@/payload/types'

export type NiveauIndicateur = Extract<TerritoireType, 'commune' | 'epci' | 'departement'>
export type DirectionIndicateur = 'high' | 'low'
export interface EtatExploration { niveau?: NiveauIndicateur; departement?: string; epci?: string; territoire?: string; recherche?: string }
export interface DensitePoint { x: number; density: number; y: number }
export interface LigneExploration { territoire: Territoire; value: number; rang: number; fiche: string; highlighted: boolean }
export interface Extreme { count: number; rows: LigneExploration[] }
export interface ModeleExploration { state: Required<Pick<EtatExploration, 'niveau'>> & EtatExploration; rows: LigneExploration[]; median: number | null; distribution: number[]; density: DensitePoint[]; high: Extreme; low: Extreme; scopeLabel: string; direction: DirectionIndicateur; markerX: number | null; markerY: number | null }

const niveaux: NiveauIndicateur[] = ['commune', 'epci', 'departement']
export const niveauLePlusFin = (supported: readonly TerritoireType[]): NiveauIndicateur => niveaux.find((n) => supported.includes(n)) ?? 'commune'

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

export function modeleExploration(facts: readonly Indicateur[], metadata: ThemeMetadata, territoires: readonly Territoire[], requested: EtatExploration = {}, remembered?: string, indicator?: string): ModeleExploration {
  const page = metadata.indicator_pages?.[indicator ?? facts[0]?.key ?? '']
  if (!page) throw new Error(`Indicateur non publié pour le thème « ${metadata.theme} »`)
  const supported = page.levels.filter((level): level is NiveauIndicateur => niveaux.includes(level as NiveauIndicateur))
  const niveau = requested.niveau && supported.includes(requested.niveau) ? requested.niveau : remembered && supported.includes(remembered as NiveauIndicateur) ? remembered as NiveauIndicateur : niveauLePlusFin(supported)
  const dansScope = (territoire: Territoire) => territoire.type === niveau && (niveau !== 'commune' || ((!requested.departement || territoire.departement === requested.departement) && (!requested.epci || territoire.epci === requested.epci)))
  const refs = new Map(territoires.map((territoire) => [territoire.territoire, territoire] as const))
  const all = facts.filter((fact) => fact.key === page.indicator && fact.detail === (page.detail ?? null) && fact.type === niveau && fact.value !== null).map((fact) => ({ territoire: refs.get(fact.territoire), value: fact.value as number })).filter((row): row is { territoire: Territoire; value: number } => Boolean(row.territoire && dansScope(row.territoire)))
  const values = all.map((row) => row.value).sort((a, b) => a - b)
  const median = values.length % 2 ? values[(values.length - 1) / 2] : values.length ? (values[values.length / 2 - 1] + values[values.length / 2]) / 2 : null
  const ranked = [...all].sort((a, b) => page.direction === 'low' ? a.value - b.value : b.value - a.value)
  const ranks = new Map<string, number>()
  ranked.forEach((row, index) => ranks.set(row.territoire.territoire, index && row.value === ranked[index - 1].value ? ranks.get(ranked[index - 1].territoire.territoire)! : index + 1))
  const project = (row: { territoire: Territoire; value: number }): LigneExploration => ({ territoire: row.territoire, value: row.value, rang: ranks.get(row.territoire.territoire)!, fiche: `/territoire/${row.territoire.type}/${row.territoire.territoire}?theme=${metadata.theme}`, highlighted: row.territoire.territoire === requested.territoire })
  const rows = [...all].sort((a, b) => b.value - a.value).filter((row) => !requested.recherche || row.territoire.nom.toLocaleLowerCase('fr').includes(requested.recherche.toLocaleLowerCase('fr'))).map(project)
  const highRows = all.filter((row) => row.value === Math.max(...all.map((item) => item.value))).map(project)
  const lowRows = all.filter((row) => row.value === Math.min(...all.map((item) => item.value))).map(project)
  const density = estimerDensite(values)
  const selected = all.find((row) => row.territoire.territoire === requested.territoire)?.value ?? null
  return { state: { niveau, departement: niveau === 'commune' ? requested.departement : undefined, epci: niveau === 'commune' ? requested.epci : undefined, territoire: requested.territoire, recherche: requested.recherche }, rows, median, distribution: values, density, high: { count: highRows.length, rows: highRows.length === 1 ? highRows : [] }, low: { count: lowRows.length, rows: lowRows.length === 1 ? lowRows : [] }, scopeLabel: requested.departement ? `Département ${requested.departement}` : requested.epci ? `EPCI ${requested.epci}` : 'Bretagne', direction: page.direction, markerX: positionDensite(density, selected), markerY: hauteurDensite(density, selected) }
}
