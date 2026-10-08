/**
 * [PROTOTYPE #710 — AEDAR] Semantic assembly of the prototype's first
 * "Accès aux services" section. ThemeContent owns the wording: the renderer
 * only lays this section out through the shared Cahier primitives.
 */
import type { AedarFetchResult } from './aedarApiClient'
import { aedarTimeRampEvidence } from './aedarTimeRampFacts'
import { MOBILITE_MODE_LABELS } from './territoryFacts'
import type { TerritoryIdentity } from './territoryFacts'
import { text } from './themeContent'
import type { AedarAccessSection, TextBlock } from './themeContent'

/** Blank map slots and the highlighted ramp horizon share the provisional AEDAR15 horizon. */
export const AEDAR_PROTOTYPE_HORIZON_MINUTES = 15

function lectureProse(horizonMinutes: number): readonly TextBlock[] {
  return [
    [text('Cette section est un prototype : elle remplace les lectures habituelles du sous-groupe « Accès aux services » par une lecture des agrégats AEDAR, calculés depuis les adresses résidentielles du territoire.')],
    [text(`Trois emplacements accueilleront les cartes d’accès à ${horizonMinutes} minutes — horizon provisoire — en voiture, à vélo (LTS2) et en transports en commun. Les cartes ne sont pas encore produites : aucun territoire n’est représenté pour l’instant.`)],
    [text('Les deux courbes lisent les mêmes agrégats, de 5 à 20 minutes : la diversité des types d’équipements accessibles, puis le nombre moyen d’équipements accessibles par type.')],
  ]
}

function mapLecture(horizonMinutes: number): readonly TextBlock[] {
  return [
    [text(`Les cartes définitives seront produites depuis les adresses du territoire, à l’horizon provisoire de ${horizonMinutes} minutes. Les emplacements restent volontairement vides : aucune carte n’est affichée pour l’instant.`)],
  ]
}

/**
 * Build the AEDAR prototype section from a validated, complete AEDAR fetch.
 * Fails closed: an error result never reaches this seam (the wrapper keeps the
 * production content and shows the honest unavailable state instead).
 */
export function aedarAccessSection(
  data: Extract<AedarFetchResult, { status: 'ready' }>,
  territory: TerritoryIdentity,
): AedarAccessSection {
  const ramps = aedarTimeRampEvidence({
    territory: { territory_type: territory.type, territory_id: territory.code },
    content_version: data.contentVersion,
    reference_content_version: data.contentVersion,
    limit: data.facts.length + 1,
    offset: 0,
    facts: data.facts,
  }, {
    territory: { type: territory.type, id: territory.code },
    mode: 'car',
    modeLabel: MOBILITE_MODE_LABELS.car,
  })
  const provenance = data.provenance.sources.map((source) => source.source_id)
  const availability = ramps.every((ramp) => ramp.availability === 'complete') ? 'complete' as const : 'incomplete' as const
  return {
    key: 'aedar-access',
    label: 'Accès aux services',
    availability,
    indicators: [],
    evidence: {
      kind: 'aedar-access',
      territory: { code: territory.code, name: territory.name },
      horizonMinutes: AEDAR_PROTOTYPE_HORIZON_MINUTES,
      mapFigureTitle: 'Cartes d’accès aux services, par mode',
      mapLecture: mapLecture(AEDAR_PROTOTYPE_HORIZON_MINUTES),
      ramps,
      availability,
      provenance,
      figureLecture: [],
    },
    provenance: [...provenance],
    lecture: {
      marelle: 'Prototype AEDAR : l’accès depuis les adresses résidentielles',
      prose: lectureProse(AEDAR_PROTOTYPE_HORIZON_MINUTES),
    },
    explorationTargets: [],
  }
}
