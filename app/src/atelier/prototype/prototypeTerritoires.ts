/** PROTOTYPE — real values for the Population dropdowns, from the static reference /data/territoires.json. */
import type { PopulationKey } from './prototypeFigure'

interface Row {
  territoire: string
  type: 'commune' | 'epci' | 'departement' | 'region'
  nom: string
  departement: string | null
  epci: string | null
  classe_densite_code: string | null
  classe_densite_libelle_insee: string | null
}

export interface Option {
  value: string
  label: string
}

export interface Territoires {
  options: Record<PopulationKey, Option[]>
  communes: Row[]
}

let promise: Promise<Territoires> | null = null
export function loadTerritoires(): Promise<Territoires> {
  promise ??= fetch('/data/territoires.json')
    .then((r) => {
      if (!r.ok) throw new Error(`territoires.json → ${r.status}`)
      return r.json() as Promise<Row[]>
    })
    .then((rows) => {
      const density = new Map<string, string>()
      for (const r of rows) if (r.classe_densite_code && r.classe_densite_libelle_insee) density.set(r.classe_densite_code, r.classe_densite_libelle_insee)
      const byName = (a: Option, b: Option) => a.label.localeCompare(b.label, 'fr')
      return {
        communes: rows.filter((r) => r.type === 'commune'),
        options: {
          departement: rows.filter((r) => r.type === 'departement').map((r) => ({ value: r.territoire, label: r.nom })).sort(byName),
          epci: rows.filter((r) => r.type === 'epci').map((r) => ({ value: r.territoire, label: r.nom })).sort(byName),
          classe_densite: [...density].sort(([a], [b]) => Number(a) - Number(b)).map(([value, label]) => ({ value, label })),
          littoral: [
            { value: 'C', label: 'Littoral (C)' },
            { value: 'NC', label: 'Non littoral (NC)' },
          ],
        },
      }
    })
    .catch((error) => {
      promise = null
      throw error
    })
  return promise
}

/** Communes matching the filters. Littoral has no per-commune reference here, so it does not narrow the count. */
export function countCommunes(data: Territoires, population: Record<PopulationKey, string[]>): number {
  return data.communes.filter(
    (c) =>
      (!population.departement.length || population.departement.includes(c.departement ?? '')) &&
      (!population.epci.length || population.epci.includes(c.epci ?? '')) &&
      (!population.classe_densite.length || population.classe_densite.includes(c.classe_densite_code ?? '')),
  ).length
}
