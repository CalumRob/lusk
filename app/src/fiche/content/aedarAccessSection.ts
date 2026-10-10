/**
 * [PROTOTYPE #710 — AEDAR] Semantic assembly of the prototype's first
 * "Accès aux services" section. ThemeContent owns the wording: the renderer
 * only lays this section out through the shared Cahier primitives.
 */
import type { AedarFetchResult } from './aedarApiClient'
import { aedarTimeRampEvidence } from './aedarTimeRampFacts'
import { AEDAR_EQUIPMENT_BUCKET_THRESHOLD, classifyAedarEquipmentTypes } from './aedarEquipmentBuckets'
import { AEDAR_TYPEQU_REGISTRY } from './aedarTypequRegistry'
import type { AedarTimeRampValues } from './aedarTimeRampFacts'
import type { TerritoryIdentity } from './territoryFacts'
import { emphasis, text, territoryLead, territoryTypeLabel } from './themeContent'
import type { AedarAccessSection, AedarCarAccessOverviewSection, AedarEquipmentProfileSection, AedarEvidenceSource, AedarRampMode, AedarTimeRampEvidence } from './themeContent'

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
      source: aedarEvidenceSource(data),
      availability,
      provenance,
    },
    provenance: [...provenance],
    lecture: null,
    explorationTargets: [],
  }
}

function aedarEvidenceSource(data: AedarReady): AedarEvidenceSource | null {
  const source = data.provenance.sources[0]
  if (!source) return null
  return {
    label: source.attribution.toUpperCase().includes('AEDAR') ? 'AEDAR' : source.attribution || 'Source',
    version: source.vintage_id,
    url: source.source_url,
    credit: source.attribution.match(/©\s*[^;—]+/u)?.[0]?.trim() ?? null,
  }
}

/** The same address-mean contract applies independently to focal and reference territories. */
function carAccessMeans(data: AedarReady, territory: { type: string; id: string }) {
  const horizonMinutes = AEDAR_PROTOTYPE_HORIZON_MINUTES
  const types = new Set(data.facts.map((fact) => fact.typequ))
  const completeUniverse = data.facts.length === AEDAR_TYPEQU_REGISTRY.length
    && types.size === AEDAR_TYPEQU_REGISTRY.length
    && AEDAR_TYPEQU_REGISTRY.every(({ code }) => types.has(code))
  const first = data.facts[0]
  const source = data.provenance.sources[0]
  const commonSource = first !== undefined && source !== undefined && data.provenance.sources.length === 1
    && (['source_id', 'vintage_id', 'source_url', 'licence', 'attribution', 'reference_date', 'publication_date'] as const)
      .every((key) => source[key] === first[key] && data.facts.every((fact) => fact[key] === first[key]))
  const compatiblePopulation = completeUniverse && commonSource && first !== undefined
    && Number.isInteger(first.n_addresses) && first.n_addresses > 0
    && data.contentVersion === data.provenance.contentVersion
    && data.facts.every((fact) => fact.territory_id === territory.id && fact.territory_type === territory.type
      && fact.n_addresses === first.n_addresses && fact.coverage_status === 'covered'
      && Number.isInteger(fact.n_observed) && fact.n_observed >= 0 && fact.n_observed <= fact.n_addresses)
  const totalFor = (statistic: 'share' | 'mean'): number | null => {
    if (!compatiblePopulation) return null
    const values = data.facts.map((fact) => fact.measures[`count_${horizonMinutes}_car_${statistic}`])
    if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value < 0
      || (statistic === 'share' && value > 1))) return null
    const sum = (values as number[]).reduce((total, value) => total + value, 0)
    return Number.isFinite(sum) ? sum : null
  }
  const meanDiversity = totalFor('share')
  const meanVolume = totalFor('mean')
  return {
    meanDiversity, meanVolume,
    nAddresses: compatiblePopulation ? first.n_addresses : null,
    source: commonSource ? aedarEvidenceSource(data) : null,
  }
}

/** Address means are additive across TYPEQU; no address-file reread is needed. */
export function aedarCarAccessOverviewSection(
  data: AedarReady,
  territory: TerritoryIdentity,
  options: AedarAccessSectionOptions = {},
): AedarCarAccessOverviewSection {
  const horizonMinutes = AEDAR_PROTOTYPE_HORIZON_MINUTES
  const means = carAccessMeans(data, { type: territory.type, id: territory.code })
  const { meanDiversity, meanVolume, nAddresses } = means
  const reference = options.reference
  const source = data.provenance.sources[0]
  const referenceSource = reference?.data.provenance.sources[0]
  const sameSourceClock = source && referenceSource
    && (['source_id', 'vintage_id', 'reference_date', 'publication_date'] as const)
      .every((key) => source[key] === referenceSource[key])
  const referenceMeans = reference && sameSourceClock && reference.data.contentVersion === data.contentVersion
    ? carAccessMeans(reference.data, reference.territory)
    : null
  const scalars = ([
    { key: 'meanDiversity', label: 'Types d’équipements', unit: 'types / adresse' },
    { key: 'meanVolume', label: 'Établissements', unit: 'établissements / adresse' },
  ] as const).map((reading) => {
    const value = means[reading.key]
    const referenceValue = referenceMeans?.[reading.key] ?? null
    return {
      ...reading, value,
      reference: reference && value !== null && referenceValue !== null ? {
        kind: 'territory-mean' as const,
        territory: { ...reference.territory, name: reference.label },
        label: `Moyenne — ${reference.label}`, value: referenceValue, unit: reading.unit,
      } : null,
    }
  })
  const availability = meanDiversity !== null && meanVolume !== null ? 'complete' as const : 'incomplete' as const
  return {
    key: 'aedar-car-overview', label: 'L’offre accessible en voiture', availability,
    indicators: [], lecture: null, explorationTargets: [],
    provenance: data.provenance.sources.map((source) => source.source_id),
    evidence: {
      kind: 'aedar-car-overview', territory: { code: territory.code, name: territory.name },
      horizonMinutes, mapModes: ['car'],
      mapFigureTitle: [text(`Diversité de l’offre accessible en voiture en ${horizonMinutes} minutes`)],
      meanDiversity, meanVolume, nAddresses, scalars,
      scalarFigureTitle: `En voiture en ${horizonMinutes} minutes (moyenne par adresse)`,
      comparisonLabel: reference && scalars.some((scalar) => scalar.reference !== null)
        ? `moyenne des adresses résidentielles de ${reference.label}` : null,
      unitIntroduction: [[
        text(`Cette page compare l’accès aux services selon le mode de déplacement, depuis les adresses résidentielles. Les cartes décrivent l’offre accessible en ${horizonMinutes} minutes.`),
      ], ...(nAddresses !== null ? [[
        text(`${new Intl.NumberFormat('fr-FR').format(nAddresses)} adresses résidentielles ${territoryLead(territory, false)} sont prises en compte.`),
      ]] : [])],
      availability, source: means.source,
      prose: meanDiversity !== null && meanVolume !== null ? [[
        text('La diversité décrit les différents types de services accessibles. Le nombre d’établissements décrit le volume de l’offre, y compris plusieurs établissements d’un même type. Ces moyennes incluent les adresses sans accès.'),
      ]] : [[text(`Les moyennes d’accès en voiture à ${horizonMinutes} minutes ne sont pas disponibles pour ce territoire.`)]],
    },
  }
}

/** The ordered access profile is a distinct section, not another figure in the access/ramp section. */
export function aedarEquipmentProfileSection(data: AedarReady): AedarEquipmentProfileSection {
  const availability = classifyAedarEquipmentTypes(data.facts, {
    horizonMinutes: AEDAR_PROTOTYPE_HORIZON_MINUTES,
  }).status
  return {
    key: 'aedar-equipment-profile',
    label: 'Types d’équipements par premier mode d’accès',
    availability,
    indicators: [],
    evidence: {
      kind: 'aedar-equipment-profile',
      facts: data.facts,
      threshold: AEDAR_EQUIPMENT_BUCKET_THRESHOLD,
      initialHorizonMinutes: AEDAR_PROTOTYPE_HORIZON_MINUTES,
      figureTitle: 'Types d’équipements accessibles par premier mode',
      source: aedarEvidenceSource(data),
      prose: [[
        text('Chaque case représente un type BPE, classé une seule fois selon le premier mode dont la part atteint '),
        emphasis('25%', 'neutral'),
        text(' : à pied, transports en commun, vélo LTS2, vélo LTS4, puis voiture. Les parts sont mesurées parmi les adresses résidentielles atteignant au moins un équipement de ce type.'),
      ], [
        text('Les transports en commun incluent la marche : leur catégorie ne contient que les types qui restent sous le seuil à pied seul. « Inaccessible » signifie qu’aucun des cinq modes n’atteint le seuil.'),
      ]],
    },
    provenance: data.provenance.sources.map((source) => source.source_id),
    lecture: null,
    explorationTargets: [],
  }
}

export function aedarPrototypeSections(
  data: AedarReady,
  territory: TerritoryIdentity,
  options: AedarAccessSectionOptions = {},
): [AedarCarAccessOverviewSection, AedarAccessSection, AedarEquipmentProfileSection] {
  return [aedarCarAccessOverviewSection(data, territory, options), aedarAccessSection(data, territory, options), aedarEquipmentProfileSection(data)]
}
