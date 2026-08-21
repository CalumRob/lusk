import type { Indicateur, Territoire, TerritoireType, ThemeMetadata } from '@/payload/types'

export type NiveauIndicateur = Extract<TerritoireType, 'commune' | 'epci' | 'departement'>
export interface EtatExploration { niveau?: NiveauIndicateur; departement?: string; epci?: string; territoire?: string; recherche?: string }
export interface LigneExploration { territoire: Territoire; value: number; rang: number; fiche: string; highlighted: boolean }
export interface ModeleExploration { state: Required<Pick<EtatExploration, 'niveau'>> & EtatExploration; rows: LigneExploration[]; median: number | null; distribution: number[]; high: LigneExploration[]; low: LigneExploration[]; scopeLabel: string; direction: 'high' | 'low' }

const niveaux: NiveauIndicateur[] = ['commune', 'epci', 'departement']
export const niveauLePlusFin = (supported: readonly TerritoireType[]): NiveauIndicateur =>
  niveaux.find((n) => supported.includes(n)) ?? 'commune'

export function modeleExploration(
  facts: readonly Indicateur[], metadata: ThemeMetadata, territoires: readonly Territoire[], requested: EtatExploration = {}, remembered?: string, indicator?: string,
): ModeleExploration {
  const page = metadata.indicator_pages?.[indicator ?? facts[0]?.key ?? '']
  if (!page) throw new Error(`Indicateur scalaire non publié pour le thème « ${metadata.theme} »`)
  const supported = page.levels.filter((n): n is NiveauIndicateur => niveaux.includes(n as NiveauIndicateur))
  const niveau = (requested.niveau && supported.includes(requested.niveau) ? requested.niveau : remembered && supported.includes(remembered as NiveauIndicateur) ? remembered as NiveauIndicateur : niveauLePlusFin(supported))
  const scope = (t: Territoire) => t.type === niveau && niveau === 'commune' && (!requested.departement || t.departement === requested.departement) && (!requested.epci || t.epci === requested.epci)
  const byId = new Map(territoires.map((t) => [t.territoire, t]))
  const factsByTerritory = new Map(facts.filter((f) => f.key === page.indicator && f.detail === (page.detail ?? null) && f.type === niveau && f.value !== null).map((f) => [f.territoire, f.value as number]))
  const query = (requested.recherche ?? '').trim().toLocaleLowerCase('fr')
  const all = [...factsByTerritory].map(([id, value]) => ({ territoire: byId.get(id)!, value })).filter((r) => r.territoire && scope(r.territoire)).sort((a, b) => b.value - a.value)
  const values = all.map((r) => r.value).sort((a, b) => a - b)
  const median = values.length ? values.length % 2 ? values[(values.length - 1) / 2] : (values[values.length / 2 - 1] + values[values.length / 2]) / 2 : null
  const direction = page.direction.toLowerCase().includes('moins') || page.direction.toLowerCase().includes('low') ? 'low' : 'high'
  const ranked = [...all].sort((a, b) => direction === 'low' ? a.value - b.value : b.value - a.value)
  const rank = new Map<string, number>(); ranked.forEach((row, index) => { if (index === 0 || row.value !== ranked[index - 1].value) rank.set(row.territoire.territoire, index + 1); else rank.set(row.territoire.territoire, rank.get(ranked[index - 1].territoire.territoire)!) })
  const rows = all.filter((r) => !query || r.territoire.nom.toLocaleLowerCase('fr').includes(query)).map((r) => ({ territoire: r.territoire, value: r.value, rang: rank.get(r.territoire.territoire)!, fiche: `/territoire/${r.territoire.type}/${r.territoire.territoire}?theme=${metadata.theme}`, highlighted: r.territoire.territoire === requested.territoire }))
  const extremes = (items: typeof all) => items.length ? items.filter((x) => x.value === items[0].value) : []
  const projection = (r: typeof all[number]): LigneExploration => ({ territoire: r.territoire, value: r.value, rang: rank.get(r.territoire.territoire)!, fiche: `/territoire/${r.territoire.type}/${r.territoire.territoire}?theme=${metadata.theme}`, highlighted: r.territoire.territoire === requested.territoire })
  return { state: { ...requested, niveau }, rows, median, distribution: values, high: extremes([...all].sort((a, b) => b.value - a.value)).map(projection), low: extremes([...all].sort((a, b) => a.value - b.value)).map(projection), scopeLabel: requested.departement ? `Département ${requested.departement}` : requested.epci ? `EPCI ${requested.epci}` : 'Bretagne', direction }
}

export function comparaison(median: number | null, value: number, unit: string): string {
  if (median === null) return 'Aucune comparaison disponible.'
  if (unit === '%' || unit.toLowerCase().includes('‰')) return `${value - median >= 0 ? '+' : ''}${(value - median).toLocaleString('fr-FR')} ${unit} par rapport à la médiane.`
  if (median === 0) return `${value.toLocaleString('fr-FR')} ${unit} — médiane nulle.`
  return `${(value / median).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}× la médiane.`
}
