import { AEDAR_CAR_MAP_HORIZON_MINUTES, aedarDiversityLossMapMetadataUrl } from '@/fiche/mapAssetUrl'
import type { AedarDiversityLossMapMode, AedarDiversityLossSection } from './themeContent'
import type { TerritoryIdentity } from './territoryFacts'
import { text } from './themeContent'

export const AEDAR_DIVERSITY_LOSS_MAP_MODES = ['walk', 'transit', 'bike_lts2', 'bike_lts4'] as const
export type AedarDiversityLossMetadataState = 'loading' | 'ready' | 'unavailable'

const mapLabels: Readonly<Record<AedarDiversityLossMapMode, string>> = {
  walk: 'À pied',
  transit: 'Transports',
  bike_lts2: 'Vélo LTS2',
  bike_lts4: 'Vélo LTS4',
}

const expectedPaletteStops = 5
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export interface AedarDiversityLossMapMetadata {
  status: AedarDiversityLossMetadataState
  legend: AedarInlineLegend | null
}

export interface AedarInlineLegend {
  colors: readonly string[]
  tickLabels: readonly string[]
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f\d]{64}$/i.test(value)
}

/** Validate an image-bound production sidecar and preserve its display strings verbatim. */
export function parseAedarInlineLegend(
  raw: unknown,
  territory: TerritoryIdentity,
  mode: AedarDiversityLossMapMode,
): AedarInlineLegend {
  if (!isRecord(raw) || raw.schema !== 'lusk.aedar.inline-legend.v1' || !isRecord(raw.territory) ||
      raw.territory.kind !== territory.type || raw.territory.code !== territory.code || raw.mode !== mode ||
      raw.measure !== 'equipment_loss' || raw.horizon_minutes !== AEDAR_CAR_MAP_HORIZON_MINUTES ||
      !isRecord(raw.image) || raw.image.key !== `maps/aedar/v1/${territory.code}-${mode}-inline.webp` ||
      !isSha256(raw.image.sha256) || !Number.isInteger(raw.image.bytes) || (raw.image.bytes as number) <= 0 ||
      !isRecord(raw.scale) || raw.scale.type !== 'equal-width' ||
      !Array.isArray(raw.scale.colours) || raw.scale.colours.length !== expectedPaletteStops ||
      !raw.scale.colours.every((color) => typeof color === 'string' && /^#[\da-f]{6}$/i.test(color)) ||
      !Array.isArray(raw.scale.display_ticks) || raw.scale.display_ticks.length !== expectedPaletteStops + 1 ||
      !raw.scale.display_ticks.every((label) => isText(label))) {
    throw new Error('Métadonnées de légende inline AEDAR invalides')
  }

  return {
    colors: raw.scale.colours as string[],
    tickLabels: raw.scale.display_ticks as string[],
  }
}

/** Fetch all four image-bound sidecars and require the shared loss scale to agree. */
export async function fetchAedarDiversityLossMapLegend(
  territory: TerritoryIdentity,
  request: typeof fetch = fetch,
): Promise<AedarInlineLegend> {
  const legends = await Promise.all(AEDAR_DIVERSITY_LOSS_MAP_MODES.map(async (mode) => {
    const url = aedarDiversityLossMapMetadataUrl(territory.code, mode)
    if (!url) throw new Error('Code territoire AEDAR invalide')
    const response = await request(url)
    if (!response.ok) throw new Error('Métadonnées de légende AEDAR indisponibles')
    return parseAedarInlineLegend(await response.json(), territory, mode)
  }))
  const first = legends[0]!
  if (legends.some((legend) => legend.tickLabels.join('\0') !== first.tickLabels.join('\0') ||
      legend.colors.join('\0') !== first.colors.join('\0'))) {
    throw new Error('Les échelles des cartes de perte AEDAR divergent')
  }
  return first
}

/** Build the production loss-map section while keeping scale copy and structure in Cahier. */
export function aedarDiversityLossSection(
  metadata: AedarDiversityLossMapMetadata,
  territory: TerritoryIdentity,
): AedarDiversityLossSection {
  const maps = AEDAR_DIVERSITY_LOSS_MAP_MODES.map((mode) => ({
    mode,
    label: mapLabels[mode],
    inlineAvailable: true,
    inspectionAvailable: true,
  }))
  const legend = metadata.status === 'ready' && metadata.legend
      ? {
        title: 'Types d’équipements perdus par rapport à la voiture',
        colors: metadata.legend.colors,
        tickLabels: metadata.legend.tickLabels,
        note: 'Échelle locale',
        ariaLabel: `Perte de diversité d’équipements par rapport à la voiture à ${territory.name}. Échelle locale, couleurs non comparables entre territoires.`,
      }
    : null

  return {
    key: 'aedar-diversity-loss',
    label: 'Perte de diversité',
    availability: metadata.status === 'ready' ? 'complete' : 'incomplete',
    indicators: [],
    evidence: {
      kind: 'aedar-diversity-loss',
      territory: { code: territory.code, name: territory.name },
      horizonMinutes: AEDAR_CAR_MAP_HORIZON_MINUTES,
      mapModes: AEDAR_DIVERSITY_LOSS_MAP_MODES,
      mapFigureTitle: [text(`Perte de diversité des équipements accessibles en ${AEDAR_CAR_MAP_HORIZON_MINUTES} minutes par rapport à la voiture`)],
      maps,
      comparisonGroups: [
        {
          key: 'walk-transit',
          label: 'À pied / Transports',
          mapModes: ['walk', 'transit'],
          prompt: 'Les transports en commun incluent la marche : la comparaison montre si le réseau ajoute des types d’équipements par rapport à la marche seule.',
        },
        {
          key: 'bike-lts2-lts4',
          label: 'Vélo LTS2 / Vélo LTS4',
          mapModes: ['bike_lts2', 'bike_lts4'],
          prompt: 'LTS2 s’adresse aux personnes averses au risque routier, LTS4 aux personnes tolérantes : comparez la perte entre ces deux réseaux.',
        },
      ],
      legend,
      metadataState: metadata.status,
      metadataNote: metadata.status === 'loading'
        ? 'Chargement des métadonnées de légende AEDAR…'
        : metadata.status === 'unavailable'
          ? 'Les métadonnées de légende des cartes AEDAR ne sont pas disponibles.'
          : null,
    },
    provenance: [],
    lecture: null,
    explorationTargets: [],
  }
}
