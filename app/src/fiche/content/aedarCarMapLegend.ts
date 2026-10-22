import { AEDAR_TYPEQU_REGISTRY } from './aedarTypequRegistry'
import { AEDAR_CAR_MAP_HORIZON_MINUTES, aedarCarMapMetadataUrl } from '@/fiche/mapAssetUrl'
import type { TerritoryIdentity } from './territoryFacts'

export interface AedarCarMapLegend {
  title: string
  minimum: number
  maximum: number
  colors: readonly string[]
  tickLabels: readonly string[]
  note: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** Image-bound car diversity metadata, not a loss-map scale or a browser-owned palette. */
export function parseAedarCarMapLegend(
  raw: unknown,
  territory: Pick<TerritoryIdentity, 'type' | 'code'>,
): AedarCarMapLegend {
  if (!isRecord(raw) || raw.schema !== 'lusk.aedar.inline-legend.v1' || !isRecord(raw.territory)
      || raw.territory.kind !== territory.type || raw.territory.code !== territory.code
      || raw.mode !== 'car' || raw.measure !== 'diversity'
      || raw.horizon_minutes !== AEDAR_CAR_MAP_HORIZON_MINUTES || !isText(raw.label)
      || (raw.helper !== null && !isText(raw.helper))
      || !isRecord(raw.image) || raw.image.key !== `maps/aedar/v1/${territory.code}-car-inline.webp`
      || typeof raw.image.sha256 !== 'string' || !/^[a-f\d]{64}$/i.test(raw.image.sha256)
      || !isNumber(raw.image.bytes) || !Number.isInteger(raw.image.bytes) || raw.image.bytes <= 0
      || !isRecord(raw.scale) || raw.scale.type !== 'equal-width'
      || raw.scale.semantics !== 'car-only-typequ' || raw.scale.scope !== 'absolute'
      || !isNumber(raw.scale.minimum) || !isNumber(raw.scale.maximum)
      || raw.scale.minimum < 0 || raw.scale.maximum <= raw.scale.minimum
      || !Array.isArray(raw.scale.colours) || raw.scale.colours.length !== 5
      || !raw.scale.colours.every((color) => typeof color === 'string' && /^#[\da-f]{6}$/i.test(color))
      || !Array.isArray(raw.scale.display_ticks) || raw.scale.display_ticks.length !== raw.scale.colours.length + 1
      || !raw.scale.display_ticks.every(isText)
      || !Array.isArray(raw.scale.boundaries) || raw.scale.boundaries.length !== raw.scale.display_ticks.length
      || !raw.scale.boundaries.every(isNumber)
      || raw.scale.boundaries[0] !== raw.scale.minimum || raw.scale.boundaries.at(-1) !== raw.scale.maximum
      || raw.scale.boundaries.some((value, index, boundaries) => index > 0 && value <= boundaries[index - 1])) {
    throw new Error('Métadonnées de légende inline AEDAR voiture invalides')
  }

  return {
    title: `${raw.label}*`,
    minimum: raw.scale.minimum,
    maximum: raw.scale.maximum,
    colors: raw.scale.colours as string[],
    tickLabels: raw.scale.display_ticks as string[],
    note: [raw.helper, `* Sur ${AEDAR_TYPEQU_REGISTRY.length} catégories d’équipements BPE`].filter(Boolean).join(' '),
  }
}

/** Read the same image-bound contract as loss maps, with car diversity semantics. */
export async function fetchAedarCarMapLegend(
  territory: Pick<TerritoryIdentity, 'type' | 'code'>,
  request: typeof fetch = fetch,
): Promise<AedarCarMapLegend> {
  const url = aedarCarMapMetadataUrl(territory.code)
  if (!url) throw new Error('Code territoire AEDAR invalide')
  const response = await request(url)
  if (!response.ok) throw new Error('Métadonnées de légende AEDAR voiture indisponibles')
  return parseAedarCarMapLegend(await response.json(), territory)
}
