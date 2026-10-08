/**
 * [PROTOTYPE #710 — AEDAR] Semantic assembly of the prototype's first
 * "Accès aux services" section. ThemeContent owns the wording: the renderer
 * only lays this section out through the shared Cahier primitives.
 */
import type { AedarFetchResult } from './aedarApiClient'
import { aedarTimeRampEvidence } from './aedarTimeRampFacts'
import type { AedarTimeRampValues } from './aedarTimeRampFacts'
import type { TerritoryIdentity } from './territoryFacts'
import { text } from './themeContent'
import type { AedarAccessSection, AedarRampMode, AedarTimeRampEvidence, TextBlock } from './themeContent'

/** Blank map slots and the highlighted ramp horizon share the provisional AEDAR15 horizon. */
export const AEDAR_PROTOTYPE_HORIZON_MINUTES = 15

type AedarReady = Extract<AedarFetchResult, { status: 'ready' }>

/** Explicit single-territory reference evidence behind the comparison lines. */
export interface AedarReferenceEvidence {
  data: AedarReady
  territory: { type: string; id: string }
  label: string
}

export interface AedarAccessSectionOptions {
  reference?: AedarReferenceEvidence | null
  /** Why no reference line exists: the selected comparison is a cohort ('cohort') or the reference is unusable ('error'). */
  comparisonUnavailable?: 'cohort' | 'error' | null
}

function lectureProse(horizonMinutes: number): readonly TextBlock[] {
  return [
    [text('Cette section est un prototype : elle remplace les lectures habituelles du sous-groupe « Accès aux services » par une lecture des agrégats AEDAR, calculés depuis les adresses résidentielles du territoire.')],
    [text(`Trois emplacements accueilleront les cartes d’accès à ${horizonMinutes} minutes — horizon provisoire — en voiture, à vélo (LTS2) et en transports en commun. Les cartes ne sont pas encore produites : aucun territoire n’est représenté pour l’instant.`)],
    [text('Les deux courbes lisent les mêmes agrégats, pour chaque mode de déplacement et de 5 à 20 minutes : la diversité des types d’équipements accessibles, puis le nombre moyen d’équipements accessibles par type.')],
  ]
}

function mapLecture(horizonMinutes: number): readonly TextBlock[] {
  return [
    [text(`Les cartes définitives seront produites depuis les adresses du territoire, à l’horizon provisoire de ${horizonMinutes} minutes. Les emplacements restent volontairement vides : aucune carte n’est affichée pour l’instant.`)],
  ]
}

function rampFigureLecture(
  referenceLabel: string | null,
  comparisonUnavailable: 'cohort' | 'error' | null | undefined,
): readonly TextBlock[] {
  const howToRead: TextBlock = [text('Chaque courbe suit un mode de déplacement, de 5 à 20 minutes. La rampe de diversité somme les parts d’adresses desservies par type d’équipement ; la rampe de nombre moyen d’équipements par type fait la moyenne des moyennes par type, sur l’ensemble des adresses résidentielles.')]
  if (referenceLabel) {
    return [howToRead, [text(`La courbe pointillée de chaque mode lit les mêmes agrégats pour ${referenceLabel} : il s’agit des agrégats du territoire de référence, publiés par AEDAR — les agrégats ne déclarent aucune cohorte de communes.`)]]
  }
  if (comparisonUnavailable === 'cohort') {
    return [howToRead, [text('Le contexte de comparaison sélectionné est une cohorte de communes : les agrégats AEDAR ne la déclarent pas, aucune courbe de comparaison n’est affichée.')]]
  }
  if (comparisonUnavailable === 'error') {
    return [howToRead, [text('Les agrégats du territoire de référence ne sont pas disponibles dans la même version : aucune courbe de comparaison n’est affichée pour l’instant.')]]
  }
  return [howToRead]
}

function virtualResponse(data: AedarReady, territory: { type: string; id: string }) {
  return {
    territory: { territory_type: territory.type, territory_id: territory.id },
    content_version: data.contentVersion,
    reference_content_version: data.contentVersion,
    limit: data.facts.length + 1,
    offset: 0,
    facts: data.facts,
  }
}

function rampEvidence(
  values: AedarTimeRampValues,
  referenceValues: readonly AedarTimeRampValues[] | null,
  referenceLabel: string | null,
): AedarTimeRampEvidence {
  const referenceRamp = referenceValues?.find((candidate) => candidate.rampKey === values.rampKey) ?? null
  const reference: Readonly<Record<AedarRampMode, readonly (number | null)[]>> | null = referenceRamp
    ? {
        car: referenceRamp.territory.car,
        bike_lts4: referenceRamp.territory.bike_lts4,
        bike_lts2: referenceRamp.territory.bike_lts2,
        transit: referenceRamp.territory.transit,
        walk: referenceRamp.territory.walk,
      }
    : null
  return {
    kind: 'aedar-time-ramp',
    rampKey: values.rampKey,
    figureTitle: values.rampKey === 'diversity' ? 'Diversité des types d’équipements' : 'Équipements accessibles par type',
    xAxis: values.xAxis,
    yAxis: values.yAxis,
    territory: values.territory,
    reference,
    referenceLabel,
    highlightedHorizon: AEDAR_PROTOTYPE_HORIZON_MINUTES,
    availability: values.availability,
    provenance: values.provenance,
    sourceCoverage: 'complete',
  }
}

/**
 * Build the AEDAR prototype section from validated, complete AEDAR fetches.
 * Fails closed: an error result never reaches this seam (the wrapper keeps the
 * production content and shows the honest unavailable state instead).
 */
export function aedarAccessSection(
  data: AedarReady,
  territory: TerritoryIdentity,
  options: AedarAccessSectionOptions = {},
): AedarAccessSection {
  const values = aedarTimeRampEvidence(virtualResponse(data, { type: territory.type, id: territory.code }), {
    territory: { type: territory.type, id: territory.code },
  })
  const referenceValues = options.reference
    ? aedarTimeRampEvidence(virtualResponse(options.reference.data, options.reference.territory), {
        territory: options.reference.territory,
      })
    : null
  const referenceLabel = options.reference?.label ?? null
  const ramps = values.map((ramp) => rampEvidence(ramp, referenceValues, referenceLabel))
  const availability = ramps.every((ramp) => ramp.availability === 'complete') ? 'complete' as const : 'incomplete' as const
  const provenance = data.provenance.sources.map((source) => source.source_id)
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
      figureLecture: rampFigureLecture(referenceLabel, options.comparisonUnavailable ?? null),
    },
    provenance: [...provenance],
    lecture: {
      marelle: 'Prototype AEDAR : l’accès depuis les adresses résidentielles',
      prose: lectureProse(AEDAR_PROTOTYPE_HORIZON_MINUTES),
    },
    explorationTargets: [],
  }
}
