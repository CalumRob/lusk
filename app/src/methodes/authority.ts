/**
 * Published source authority.  The registry owns editorial facts; vintages
 * own freshness facts.  This small adapter is the only join used by the new
 * Sources surface, so cards and the legacy Méthodes table cannot drift apart.
 */
import { indicateursParDataset, THEMES_METHODES } from '@/methodes/indicateurs'
import { SOURCES_METHODES } from '@/methodes/sources'
import { formaterDateFrancaise, formaterLicence } from '@/payload/selectors'
import type { Payload, Theme } from '@/payload/types'

export interface SourceConsumer {
  key: string
  label: string
  theme: Theme
  caveat: string | null
}

export interface SourceVintage {
  id: string
  label: string
  version: string | null
  licence: string | null
  dateReference: string | null
  datePublication: string | null
}

export interface PublishedSourceRecord {
  id: string
  name: string
  publisher: string
  url: string | null
  themes: Theme[]
  caveat: string | null
  updateClocks: string[]
  vintages: SourceVintage[]
  consumers: SourceConsumer[]
}

function clocks(themes: readonly Theme[]): string[] {
  const result: string[] = []
  for (const theme of themes) {
    const doc = THEMES_METHODES[theme as keyof typeof THEMES_METHODES]
    if (doc?.horlogeLente) result.push(`${doc.horlogeLente.consommation} ${doc.horlogeLente.declencheur}`)
    if (doc?.deuxHorloges) result.push(`${doc.deuxHorloges.consommation} ${doc.deuxHorloges.declencheur}`)
  }
  return [...new Set(result)]
}

/** The complete, published dataset-centric view model. */
export function publishedSources(payload: Payload): PublishedSourceRecord[] {
  const vintages = new Map((payload.vintages ?? []).map((v) => [v.id, v]))
  const consumers = indicateursParDataset()
  const result: PublishedSourceRecord[] = []

  for (const [id, source] of Object.entries(SOURCES_METHODES)) {
    const dataset = source.dataset ?? id
    let record = result.find((candidate) => candidate.id === dataset)
    if (!record) {
      record = {
        id: dataset,
        name: source.nom,
        publisher: source.editeur,
        url: source.url,
        themes: [...source.themes],
        caveat: source.caveat ?? null,
        updateClocks: clocks(source.themes),
        vintages: [],
        consumers: [],
      }
      result.push(record)
    }
    const vintage = vintages.get(id)
    record.vintages.push({
      id,
      label: source.libelle,
      version: vintage?.version ?? null,
      licence: vintage ? formaterLicence(vintage.licence) : null,
      dateReference: vintage?.date_reference ? formaterDateFrancaise(vintage.date_reference) : null,
      datePublication: vintage?.date_publication ? formaterDateFrancaise(vintage.date_publication) : null,
    })
  }

  for (const record of result) {
    record.consumers = (consumers.get(record.id) ?? []).map((consumer) => ({
      key: consumer.clef,
      label: consumer.label,
      theme: consumer.theme,
      caveat: THEMES_METHODES[consumer.theme as keyof typeof THEMES_METHODES].indicateurs[consumer.clef]?.caveat ?? null,
    }))
  }
  return result
}
