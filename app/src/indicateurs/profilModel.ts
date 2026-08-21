import type { Indicateur, Territoire, TerritoireType, ThemeMetadata } from '@/payload/types'

export interface ProfilLigne { detail: string; label: string; value: number; rang: number; taille: number; territoire?: Territoire }
export interface ModeleProfil {
  details: string[]
  selected: string | null
  selectedLabel: string | null
  rows: ProfilLigne[]
  complete: boolean
  state: 'empty' | 'short' | 'complete' | 'unavailable'
  high: { count: number; rows: ProfilLigne[] }
  low: { count: number; rows: ProfilLigne[] }
  median: number | null
}

/** Contract shared by Repères, Carte and table for profile/list indicators.
 * Metadata owns order and vocabulary; facts only provide values. */
export function modeleProfil(
  facts: readonly Indicateur[], metadata: ThemeMetadata,
  territoires: readonly Territoire[], requestedDetail?: string, level?: TerritoireType, departement?: string, epci?: string,
): ModeleProfil {
  const labels = metadata.detail_labels[facts[0]?.key ?? ''] ?? {}
  const details = Object.keys(labels)
  const refs = new Map(territoires.map((t) => [t.territoire, t]))
  const available = facts.filter((f) => f.value !== null && refs.has(f.territoire) && f.detail !== null && (!level || f.type === level) && (!departement || refs.get(f.territoire)?.departement === departement) && (!epci || refs.get(f.territoire)?.epci === epci))
  if (!details.length) return { details: [], selected: null, selectedLabel: null, rows: [], complete: false, state: 'unavailable', high: { count: 0, rows: [] }, low: { count: 0, rows: [] }, median: null }
  const selected = requestedDetail && details.includes(requestedDetail) ? requestedDetail : details[0]
  const selectedFacts = available.filter((f) => f.detail === selected)
  const values = selectedFacts.map((f) => f.value as number)
  const ranked = [...selectedFacts].sort((a, b) => b.value! - a.value!)
  const rows = ranked.map((f, i) => ({ detail: selected!, label: labels[selected!], value: f.value!, rang: i && f.value === ranked[i - 1].value ? 1 : i + 1, taille: ranked.length, territoire: refs.get(f.territoire) }))
  const allPublished = details.every((detail) => available.some((f) => f.detail === detail))
  const high = values.length ? Math.max(...values) : null
  const low = values.length ? Math.min(...values) : null
  const highRows = rows.filter((r) => r.value === high); const lowRows = rows.filter((r) => r.value === low)
  const median = values.length ? [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)] : null
  return { details, selected, selectedLabel: labels[selected], rows, complete: allPublished, state: !selectedFacts.length ? 'empty' : allPublished ? 'complete' : 'short', high: { count: highRows.length, rows: highRows.length === 1 ? highRows : [] }, low: { count: lowRows.length, rows: lowRows.length === 1 ? lowRows : [] }, median }
}
