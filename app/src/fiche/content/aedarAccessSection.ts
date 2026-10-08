/**
 * [PROTOTYPE #710 — AEDAR] Semantic assembly of the prototype's first
 * "Accès aux services" section. ThemeContent owns the wording: the renderer
 * only lays this section out through the shared Cahier primitives.
 */
import type { AedarFetchResult } from './aedarApiClient'
import { aedarTimeRampEvidence } from './aedarTimeRampFacts'
import type { AedarTimeRampValues } from './aedarTimeRampFacts'
import type { TerritoryIdentity } from './territoryFacts'
import { emphasis, text, territoryLead, territoryTypeLabel } from './themeContent'
import type { AedarAccessSection, AedarRampMode, AedarTimeRampEvidence } from './themeContent'

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
    figureTitle: values.rampKey === 'diversity' ? 'Diversité de l’offre accessible (moyenne du territoire)' : 'Équipements accessibles par type',
    xAxis: values.xAxis,
    yAxis: values.yAxis,
    territory: values.territory,
    reference,
    referenceLabel,
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
  const diversity = ramps.find((ramp) => ramp.rampKey === 'diversity')
  const horizonIndex = diversity?.xAxis.values.indexOf(AEDAR_PROTOTYPE_HORIZON_MINUTES) ?? -1
  const carDiversity = horizonIndex >= 0 ? diversity?.territory.car[horizonIndex] : null
  const walkDiversity = horizonIndex >= 0 ? diversity?.territory.walk[horizonIndex] : null
  const diversityGapValue = carDiversity !== null && carDiversity !== undefined && walkDiversity !== null && walkDiversity !== undefined
    ? carDiversity - walkDiversity
    : null
  const diversityGapProse = diversityGapValue === null ? null : [
    text(`de types d’équipements de ${diversityGapValue >= 0 ? 'moins' : 'plus'} accessibles `),
    emphasis('à pied', 'foot'),
    text(' qu’en '),
    emphasis('voiture', 'car'),
    text(` dans ${territoryTypeLabel(territory)} en ${AEDAR_PROTOTYPE_HORIZON_MINUTES} min`),
  ]
  const availability = ramps.every((ramp) => ramp.availability === 'complete') ? 'complete' as const : 'incomplete' as const
  const provenance = data.provenance.sources.map((source) => source.source_id)
  return {
    key: 'aedar-access',
    label: 'Diversité de l’offre',
    availability,
    indicators: [],
    evidence: {
      kind: 'aedar-access',
      territory: { code: territory.code, name: territory.name },
      horizonMinutes: AEDAR_PROTOTYPE_HORIZON_MINUTES,
      mapFigureTitle: [
        text('Quelle diversité de l’offre est accessible en '),
        emphasis('15 minutes'),
        text(' depuis les adresses résidentielles ?'),
      ],
      ramps,
      sectionProse: [[
        text('Les '),
        emphasis('Transports en commun', 'foot'),
        text(' incluent aussi la '),
        emphasis('marche', 'foot'),
        text('. Les itinéraires '),
        emphasis('vélo', 'bike'),
        text(' '),
        emphasis('LTS2', 'bike'),
        text(' s’adressent aux personnes averses au risque routier, tandis que ceux de '),
        emphasis('LTS4', 'bike'),
        text(' s’adressent aux personnes tolérantes au risque routier.'),
      ], [
        text('La "diversité" est le nombre de catégories d’équipements accessibles depuis les adresses résidentielles. Cette analyse reprend les catégories de la BPE 2025, qui recense 235 types d\'équipements.'),
      ]],
      diversityGap: {
        horizonMinutes: AEDAR_PROTOTYPE_HORIZON_MINUTES,
        territoryLead: territoryLead(territory, false),
        value: diversityGapValue,
        prose: diversityGapProse,
      },
      source: data.provenance.sources[0] ? {
        label: data.provenance.sources[0].attribution.toUpperCase().includes('AEDAR') ? 'AEDAR' : data.provenance.sources[0].attribution || 'Source',
        version: data.provenance.sources[0].vintage_id,
        url: data.provenance.sources[0].source_url,
        credit: data.provenance.sources[0].attribution.match(/©\s*[^;—]+/u)?.[0]?.trim() ?? null,
      } : null,
      availability,
      provenance,
    },
    provenance: [...provenance],
    lecture: null,
    explorationTargets: [],
  }
}
