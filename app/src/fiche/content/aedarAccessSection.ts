/**
 * Semantic assembly of AEDAR evidence for Mobilité. ThemeContent owns the
 * wording; the renderer lays sections out through the shared Cahier primitives.
 */
import type { AedarFetchResult } from './aedarApiClient'
import { aedarTimeRampEvidence, AEDAR_EQUIPMENT_QUANTILE_STATISTICS } from './aedarTimeRampFacts'
import { AEDAR_EQUIPMENT_BUCKET_THRESHOLD, classifyAedarEquipmentTypes } from './aedarEquipmentBuckets'
import { AEDAR_TYPEQU_BPE_YEAR, AEDAR_TYPEQU_REGISTRY } from './aedarTypequRegistry'
import { aedarDiversityLossSection } from './aedarDiversityLossMaps'
import type { AedarDiversityLossMapMetadata } from './aedarDiversityLossMaps'
import type { AedarTimeRampValues } from './aedarTimeRampFacts'
import type { TerritoryIdentity } from './territoryFacts'
import { emphasis, link, modeEmphasis, text, territoryLead, territoryTypeLabel } from './themeContent'
import type { AedarAccessSection, AedarCarAccessOverviewSection, AedarDiversityLossSection, AedarEquipmentExplorerSection, AedarEquipmentProfileSection, AedarEvidenceSource, AedarRampMode, AedarTimeRampEvidence, TextBlock } from './themeContent'

/** Blank map slots and the highlighted ramp horizon share the provisional AEDAR15 horizon. */
export const AEDAR_PROTOTYPE_HORIZON_MINUTES = 15
export const AEDAR_EQUIPMENT_EXPLORER_INITIAL_TYPEQU = 'B207'

/** Section labels are stable editorial content, shared by the ready and pending skeletons (#769). */
export const AEDAR_CAR_OVERVIEW_SECTION_LABEL = 'L’offre accessible en voiture'
export const AEDAR_ACCESS_SECTION_LABEL = 'La ville du 1/12, du 1/6, du 1/4 et du 1/3 d’heure'
export const AEDAR_EQUIPMENT_PROFILE_SECTION_LABEL = 'Au moins un quart des adresses'
export const AEDAR_EQUIPMENT_EXPLORER_SECTION_LABEL = 'Bac à sable'

/**
 * App-owned presentation descriptors (key/label/unit) of the two car-overview
 * readings. The AEDAR producer/API contract declares only measure column names
 * (`count_<horizon>_<mode>_<statistic>`) — no display units — so these
 * descriptors live in this semantic content module, single-sourced and consumed
 * by BOTH the hydrated and the pending builders so pending facts cannot drift
 * (#889 Standards review).
 */
export const AEDAR_CAR_OVERVIEW_SCALAR_READINGS = [
  { key: 'meanDiversity', label: 'Types d’équipements', unit: 'types / adresse' },
  { key: 'meanVolume', label: 'Établissements', unit: 'établissements / adresse' },
] as const

type AedarReady = Extract<AedarFetchResult, { status: 'ready' }>

function sameAedarPublication(left: AedarReady, right: AedarReady): boolean {
  return left.contentVersion === right.contentVersion
    && left.referenceContentVersion === right.referenceContentVersion
}

/** Explicit single-territory reference evidence behind the comparison lines. */
export interface AedarReferenceEvidence {
  data: AedarReady
  territory: { type: string; id: string }
  label: string
}

export interface AedarAccessSectionOptions {
  reference?: AedarReferenceEvidence | null
  /** Supplied by the production Mobility cahier when it displays published loss maps. */
  lossMapMetadata?: AedarDiversityLossMapMetadata
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
  const referenceRamp = referenceValues?.find((candidate) => candidate.rampKey === values.rampKey
    && Object.values(candidate.territory).some((series) => series.some((value) => value !== null))) ?? null
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
    figureTitle: values.rampKey === 'diversity' ? 'Diversité de l’offre accessible (moyenne par adresse)' : 'Établissements accessibles (moyenne par adresse)',
    xAxis: values.xAxis,
    yAxis: values.yAxis,
    territory: values.territory,
    reference,
    referenceLabel: reference ? referenceLabel : null,
    availability: values.availability,
    provenance: values.provenance,
    sourceCoverage: 'complete',
  }
}

/**
 * Build the AEDAR section from validated, complete AEDAR fetches.
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
  const candidate = options.reference
  const source = data.facts[0]
  const referenceSource = candidate?.data.facts[0]
  const reference = candidate && source && referenceSource && sameAedarPublication(candidate.data, data)
    && (['source_id', 'vintage_id', 'reference_date', 'publication_date'] as const)
      .every((key) => source[key] === referenceSource[key])
    ? candidate : null
  const referenceValues = reference
    ? aedarTimeRampEvidence(virtualResponse(reference.data, reference.territory), {
        territory: reference.territory,
      })
    : null
  const referenceLabel = reference ? `Moyenne · ${reference.label}` : null
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
    label: AEDAR_ACCESS_SECTION_LABEL,
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
      comparisonLabel: referenceLabel && ramps.some((ramp) => ramp.reference !== null)
        ? referenceLabel : null,
      sectionProse: [[
        text(`La diversité décrit le nombre de différents types d'équipements (catégories BPE) accessibles sur un total de ${AEDAR_TYPEQU_REGISTRY.length} catégories recensées. Le nombre d’établissements ci-dessous décrit le volume de l’offre, y compris plusieurs établissements d’un même type. Les deux variables sont ici présentées pour chaque mode (sélectionnable via la légende) aux horizons de 5, 10, 15 et 20 minutes pour élucider l'importance que peuvent avoir les temps de trajet dans l'accessibilité des différents modes.`),
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

/**
 * Car-overview copy shared by the ready and the pending skeleton (#769): the
 * wording is static editorial content; only the address count and the source
 * link wait for the aggregate read (null keeps the prose grammatical and never
 * fabricates a number).
 */
function carOverviewUnitIntroduction(
  territory: TerritoryIdentity,
  nAddresses: number | null,
  sourceUrl: string | null,
): readonly TextBlock[] {
  return [
    [
      text(`Cette page présente l’accès aux équipements issus de la Base permanente des équipements (BPE ${AEDAR_TYPEQU_BPE_YEAR}, INSEE) selon le mode de déplacement depuis les adresses résidentielles de la Base de données nationale des bâtiments (BDNB${nAddresses !== null ? `, ${new Intl.NumberFormat('fr-FR').format(nAddresses)} adresses résidentielles ${territoryLead(territory, false)}` : ''}). Elle s’appuie sur les jeux de données `),
      ...(sourceUrl ? [link('AEDAR', sourceUrl)] : [text('AEDAR')]),
      text('.'),
    ],
    [
      text('Elle positionne le territoire en termes d’accès. Cet accès est différencié en fonction de sa répartition spatiale, des inégalités potentielles qu’il implique, du temps de trajet autorisé pour accéder aux équipements (5, 10, 15 ou 20 minutes), de la catégorie d’équipement BPE (dont la liste exhaustive accompagnée de descriptions est téléchargeable '),
      link('à ce lien', 'https://www.insee.fr/fr/metadonnees/source/serie/s1161'),
      text('), et du mode de transport.'),
    ],
    [
      text('Les modes de transport suivants y sont différenciés : '),
      modeEmphasis('Marche', 'walk'), text(', '),
      modeEmphasis('Transports en commun', 'transit'), text(', '),
      modeEmphasis('Vélo LTS 2', 'bike_lts2'), text(' (averse au risque), '),
      modeEmphasis('Vélo LTS 4', 'bike_lts4'), text(' (tolérant au risque), '),
      modeEmphasis('Voiture', 'car'), text('.'),
    ],
  ]
}

function carOverviewProse(horizonMinutes: number): readonly TextBlock[] {
  return [[
    text(`La diversité décrit le nombre de différents types d’équipements (catégories BPE) accessibles sur un total de ${AEDAR_TYPEQU_REGISTRY.length} catégories recensées. Ici, elle est définie sur la base de trajets de ${horizonMinutes} minutes. Les carreaux de la carte sont colorés en fonction de la diversité médiane des adresses qu’ils couvrent.`),
  ], [
    text('Le nombre d’établissements ci-dessous décrit le volume de l’offre, y compris plusieurs établissements d’un même type. Ces moyennes incluent les adresses sans accès.'),
  ]]
}

/** Shared overview presentation, consumed by the ready and pending builders alike (#889 review). */
function carOverviewMapFigureTitle(horizonMinutes: number): TextBlock {
  return [text(`Diversité de l’offre accessible en voiture en ${horizonMinutes} minutes`)]
}

function carOverviewScalarFigureTitle(horizonMinutes: number): string {
  return `En voiture en ${horizonMinutes} minutes (moyenne par adresse)`
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
  const referenceMeans = reference && sameSourceClock && sameAedarPublication(reference.data, data)
    ? carAccessMeans(reference.data, reference.territory)
    : null
  const scalars = AEDAR_CAR_OVERVIEW_SCALAR_READINGS.map((reading) => {
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
    key: 'aedar-car-overview', label: AEDAR_CAR_OVERVIEW_SECTION_LABEL, availability,
    indicators: [], lecture: null, explorationTargets: [],
    provenance: data.provenance.sources.map((source) => source.source_id),
    evidence: {
      kind: 'aedar-car-overview', territory: { type: territory.type, code: territory.code, name: territory.name },
      horizonMinutes, mapModes: ['car'],
      mapFigureTitle: carOverviewMapFigureTitle(horizonMinutes),
      meanDiversity, meanVolume, nAddresses, scalars,
      scalarFigureTitle: carOverviewScalarFigureTitle(horizonMinutes),
      comparisonLabel: reference && scalars.some((scalar) => scalar.reference !== null)
        ? `Moyenne · ${reference.label}` : null,
      unitIntroduction: carOverviewUnitIntroduction(territory, nAddresses, source?.source_url ?? null),
      availability, source: means.source,
      prose: carOverviewProse(horizonMinutes),
    },
  }
}

/**
 * #769 pending counterpart of the car overview: same label, prose and blank
 * map slot (fixed geometry), but every numeric reading stays null and no source
 * line renders until the aggregate read resolves. Never a fabricated number.
 */
export function aedarPendingCarAccessOverviewSection(territory: TerritoryIdentity): AedarCarAccessOverviewSection {
  const horizonMinutes = AEDAR_PROTOTYPE_HORIZON_MINUTES
  return {
    key: 'aedar-car-overview', label: AEDAR_CAR_OVERVIEW_SECTION_LABEL, availability: 'incomplete',
    indicators: [], lecture: null, explorationTargets: [],
    provenance: [],
    evidence: {
      kind: 'aedar-car-overview', territory: { type: territory.type, code: territory.code, name: territory.name },
      horizonMinutes, mapModes: ['car'],
      mapFigureTitle: carOverviewMapFigureTitle(horizonMinutes),
      meanDiversity: null, meanVolume: null, nAddresses: null,
      scalars: AEDAR_CAR_OVERVIEW_SCALAR_READINGS.map((reading) => ({ ...reading, value: null, reference: null })),
      scalarFigureTitle: carOverviewScalarFigureTitle(horizonMinutes),
      comparisonLabel: null,
      unitIntroduction: carOverviewUnitIntroduction(territory, null, null),
      availability: 'incomplete', source: null,
      prose: carOverviewProse(horizonMinutes),
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
    label: AEDAR_EQUIPMENT_PROFILE_SECTION_LABEL,
    availability,
    indicators: [],
    evidence: {
      kind: 'aedar-equipment-profile',
      facts: data.facts,
      threshold: AEDAR_EQUIPMENT_BUCKET_THRESHOLD,
      initialHorizonMinutes: AEDAR_PROTOTYPE_HORIZON_MINUTES,
      figureTitle: `Types d’équipements par premier mode permettant l'accès à au moins ${Math.round(AEDAR_EQUIPMENT_BUCKET_THRESHOLD * 100)}% des adresses`,
      source: aedarEvidenceSource(data),
      prose: [[
        text('Chaque case représente un type BPE, classé une seule fois selon le mode le plus lent qui donne accès à au moins '),
        emphasis(`${Math.round(AEDAR_EQUIPMENT_BUCKET_THRESHOLD * 100)}%`, 'neutral'),
        text(' des adresses : à pied, '), modeEmphasis('transports en commun', 'transit'),
        text(', '), modeEmphasis('vélo LTS2', 'bike_lts2'), text(', '),
        modeEmphasis('vélo LTS4', 'bike_lts4'), text(', puis '),
        modeEmphasis('voiture', 'car'),
        text('. L’horizon de temps est sélectionnable. « Inaccessible » signifie qu’aucun des modes n’atteint le seuil de 25% des adresses.'),
      ], [
        text('Les '), modeEmphasis('transports en commun', 'transit'), text(' incluent la '), modeEmphasis('marche', 'walk'), text('.'),
      ], [
        text('Sélectionnez une case, un mode de transport ou le bouton « parcourir les équipements » pour voir les statistiques détaillées.'),
      ]],
    },
    provenance: data.provenance.sources.map((source) => source.source_id),
    lecture: null,
    explorationTargets: [],
  }
}

export function aedarEquipmentExplorerSection(data: AedarReady): AedarEquipmentExplorerSection {
  return {
    key: 'aedar-equipment-explorer',
    label: AEDAR_EQUIPMENT_EXPLORER_SECTION_LABEL,
    availability: 'complete',
    indicators: [],
    evidence: {
      kind: 'aedar-equipment-explorer',
      contentVersion: data.contentVersion,
      referenceContentVersion: data.referenceContentVersion,
      facts: data.facts,
      initialTypequ: AEDAR_EQUIPMENT_EXPLORER_INITIAL_TYPEQU,
      initialHorizonMinutes: AEDAR_PROTOTYPE_HORIZON_MINUTES,
      introduction: [[
        text('Vous pouvez ici explorer chaque catégorie BPE individuellement pour en visualiser, pour chaque mode de transport (sélectionnable), la distribution temporelle.'),
      ], [
        text('Vous pouvez aussi sélectionner un horizon temporel et visualiser les inégalités d’accès entre les adresses les mieux loties et les moins bien loties.'),
      ]],
      volumeFigureTitle: 'Établissements accessibles (moyenne par adresse)',
      volumeYAxisTitle: 'Volume de l’offre',
      distributionFigureTitle: 'Distribution des établissements accessibles par décile',
      distributionStatistics: AEDAR_EQUIPMENT_QUANTILE_STATISTICS,
      distributionAxisTitle: 'Décile',
      distributionYAxisTitle: 'Nombre d’établissements',
      distributionDescription: 'Les barres montrent les seuils publiés : minimum, déciles et maximum.',
      distributionUnavailableDescription: 'Distribution indisponible pour ce type d’équipement et cet horizon.',
      source: aedarEvidenceSource(data),
    },
    provenance: data.provenance.sources.map((source) => source.source_id),
    lecture: null,
    explorationTargets: [],
  }
}

type AedarPrototypeSectionsWithoutLoss = [AedarCarAccessOverviewSection, AedarAccessSection, AedarEquipmentProfileSection, AedarEquipmentExplorerSection]
type AedarPrototypeSectionsWithLoss = [AedarCarAccessOverviewSection, AedarDiversityLossSection, AedarAccessSection, AedarEquipmentProfileSection, AedarEquipmentExplorerSection]

export function aedarPrototypeSections(
  data: AedarReady,
  territory: TerritoryIdentity,
  options: AedarAccessSectionOptions & { lossMapMetadata: AedarDiversityLossMapMetadata },
): AedarPrototypeSectionsWithLoss
export function aedarPrototypeSections(
  data: AedarReady,
  territory: TerritoryIdentity,
  options?: Omit<AedarAccessSectionOptions, 'lossMapMetadata'>,
): AedarPrototypeSectionsWithoutLoss
export function aedarPrototypeSections(
  data: AedarReady,
  territory: TerritoryIdentity,
  options: AedarAccessSectionOptions = {},
): AedarPrototypeSectionsWithoutLoss | AedarPrototypeSectionsWithLoss {
  const carOverview = aedarCarAccessOverviewSection(data, territory, options)
  const access = aedarAccessSection(data, territory, options)
  const equipmentProfile = aedarEquipmentProfileSection(data)
  const equipmentExplorer = aedarEquipmentExplorerSection(data)
  if (options.lossMapMetadata) {
    return [carOverview, aedarDiversityLossSection(options.lossMapMetadata, territory, aedarEvidenceSource(data)), access, equipmentProfile, equipmentExplorer]
  }
  return [carOverview, access, equipmentProfile, equipmentExplorer]
}

/**
 * #769 — pending skeleton of the production AEDAR surface, in the EXACT order
 * of `aedarPrototypeSections`: the published loss maps stay mounted at their
 * final position and every numeric section keeps its label as an honest
 * placeholder (evidence null -> the renderer's « Chargement des données
 * AEDAR… » state), so resolving the aggregates replaces content in place
 * instead of inserting prose/sections above the reader's current position.
 */
export function aedarPendingPrototypeSections(
  territory: TerritoryIdentity,
  options: { lossMapMetadata: AedarDiversityLossMapMetadata },
): AedarPrototypeSectionsWithLoss {
  return [
    aedarPendingCarAccessOverviewSection(territory),
    aedarDiversityLossSection(options.lossMapMetadata, territory),
    {
      key: 'aedar-access', label: AEDAR_ACCESS_SECTION_LABEL, availability: 'incomplete',
      indicators: [], evidence: null, provenance: [], lecture: null, explorationTargets: [],
    },
    {
      key: 'aedar-equipment-profile', label: AEDAR_EQUIPMENT_PROFILE_SECTION_LABEL, availability: 'incomplete',
      indicators: [], evidence: null, provenance: [], lecture: null, explorationTargets: [],
    },
    {
      key: 'aedar-equipment-explorer', label: AEDAR_EQUIPMENT_EXPLORER_SECTION_LABEL, availability: 'incomplete',
      indicators: [], evidence: null, provenance: [], lecture: null, explorationTargets: [],
    },
  ]
}
