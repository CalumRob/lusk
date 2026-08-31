/**
 * Transitional input adapter for the prototype's accessibility snapshot.
 *
 * Variant D never imports this source. It is injected into TerritoryFacts at
 * the shell boundary, where it can be replaced by the published source when
 * that seam is promoted. Published share facts still win in territoryFactsFor.
 */
import { donneesMobiliteCahierPour } from '@/fiche/prototype/donneesMobiliteCahier'

import type {
  FactProvenance,
  MobiliteAccessReader,
} from './territoryFacts'

const provenance: FactProvenance = {
  sourceId: 'mobilite_snapshot',
  source: 'Snapshot Mobilité',
  version: '2026-02',
  referenceDate: '2026-02-28',
  publicationDate: '2026-08-06',
}

/** Read the legacy snapshot through the narrow #529 input contract only. */
export const lireAccesMobiliteTransitoire: MobiliteAccessReader = (territoire) => {
  const data = donneesMobiliteCahierPour(territoire)
  if (!data) return null

  return {
    totalBatimentsBretons: data.totalBatimentsBretons,
    batimentsTerritoire: data.batimentsTerritoire,
    provenance,
    parts: Object.fromEntries(
      Object.entries(data.parts).map(([service, modes]) => [
        service,
        { c: modes.c, b: modes.b, t: modes.t },
      ]),
    ),
  }
}
