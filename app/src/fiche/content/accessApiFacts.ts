import type {
  ComparisonScopeKind,
  FactAvailability,
  FactProvenance,
  MobiliteAccessGaps,
  MobiliteAccessModes,
  MobiliteAccessMode,
  MobiliteService,
  NumericFact,
  TerritoryFacts,
} from './territoryFacts'
import { ACCESS_INDICATOR_KEYS } from './territoryFacts'

// The semantic facts already declare the served service/mode grammar; do not
// independently select indicators or service groups in the API adapter.
const apiMode: Record<MobiliteAccessMode, string> = {
  car: 'car', bike: 'bike', walkTransit: 'walk_transit',
}
const scopeKinds = new Set<ComparisonScopeKind>([
  'communes-densite', 'communes-epci', 'communes-bretagne', 'epcis-bretagne', 'departements-bretagne',
])
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
function invalid(): never { throw new Error('Publication API accès invalide') }

/** Replace only service access observations with a fully validated API publication. */
export function applyAccessApiFacts(
  facts: TerritoryFacts,
  response: unknown,
  expectedScope: ComparisonScopeKind | null,
  expectedLabel: string | null,
): TerritoryFacts {
  if (!record(response) || typeof response.publication_id !== 'string' || !response.publication_id ||
      !record(response.territory) || !Array.isArray(response.services)) invalid()
  if (response.territory.id !== facts.territory.code || response.territory.type !== facts.territory.type) invalid()
  const kind = record(response.scope) ? response.scope.kind : null
  const region = facts.territory.type === 'region'
  if ((!region && (typeof kind !== 'string' || !scopeKinds.has(kind as ComparisonScopeKind))) ||
      (region && response.scope !== null)) invalid()
  if (!region && (kind !== expectedScope || !expectedLabel ||
      !record(response.scope) ||
      !Number.isInteger(response.scope.member_count) || (response.scope.member_count as number) < 1)) invalid()
  const services = Object.keys(facts.mobility.access.byService) as MobiliteService[]
  const byId = new Map<unknown, Record<string, unknown>>()
  for (const item of response.services) {
    if (!record(item) || typeof item.id !== 'string' || !record(item.modes)) invalid()
    if (byId.has(item.id)) invalid()
    byId.set(item.id, item)
  }
  if (byId.size !== services.length) invalid()
  const parsed: Record<string, MobiliteAccessModes> = {}
  const gaps: Record<string, MobiliteAccessGaps> = {}
  for (const service of services) {
    // The publication uses the service token in the canonical share_* key;
    // the semantic facts own the mapping to the page's service identity.
    const publishedKey = ACCESS_INDICATOR_KEYS[service].c
    const publishedId = /^share_(.+)_c$/.exec(publishedKey)?.[1]
    if (!publishedId) invalid()
    const item = byId.get(publishedId)
    if (!item) invalid()
    const modes = Object.keys(facts.mobility.access.byService[service]) as MobiliteAccessMode[]
    if (region && (item.peer_median_car_gap !== null || item.peer_median_bike_gain !== null)) invalid()
    if (modes.some((mode) => !record(item.modes) || !(apiMode[mode] in item.modes))) invalid()
    const built = {} as MobiliteAccessModes
    for (const mode of modes) {
      const raw = (item.modes as Record<string, unknown>)[apiMode[mode]]
      if (!record(raw) || !(raw.value === null || (finite(raw.value) && raw.value >= 0 && raw.value <= 1)) ||
          !(raw.median === null || (finite(raw.median) && raw.median >= 0 && raw.median <= 1)) ||
          !(raw.rank === null || (record(raw.rank) && Number.isInteger(raw.rank.position) && Number.isInteger(raw.rank.size) && (raw.rank.position as number) > 0 && (raw.rank.size as number) >= (raw.rank.position as number))) ||
           raw.direction !== 'high' || typeof raw.source_id !== 'string' || !raw.source_id ||
           typeof raw.source_name !== 'string' || !raw.source_name || typeof raw.source_version !== 'string' || !raw.source_version ||
          !(raw.reference_date === null || typeof raw.reference_date === 'string') ||
          !(raw.source_publication_date === null || typeof raw.source_publication_date === 'string') ||
           typeof raw.indicator_label !== 'string') invalid()
      if (region && (raw.median !== null || raw.rank !== null)) invalid()
      const provenance: FactProvenance = {
        sourceId: raw.source_id, source: raw.source_name, version: raw.source_version,
        referenceDate: raw.reference_date, publicationDate: raw.source_publication_date,
      }
      const availability: FactAvailability = raw.value === null ? 'incomplete' : 'complete'
      const comparison = region ? null : {
        direction: 'plus-est-mieux' as const,
        scope: { kind: kind as ComparisonScopeKind, label: expectedLabel! },
        rank: raw.rank && (raw.rank as { size: number }).size >= 2 ? raw.rank as { position: number; size: number } : null,
        reference: raw.median === null ? null : { kind: 'median' as const, value: raw.median },
      }
      built[mode] = {
        key: `access.${service}`, detail: mode, label: raw.indicator_label,
        value: raw.value as number | null, unit: '%', availability, provenance, comparison,
        comparisonBasis: 'territory-median', reason: null,
      }
    }
    parsed[service] = built
    const gap = (name: 'carGap' | 'bikeGain', first: 'car' | 'bike', peerKey: string): NumericFact | null => {
      const peer = item[peerKey]
      if (!(peer === null || (finite(peer) && peer >= -1 && peer <= 1))) return null
      const a = built[first], b = built.walkTransit
      return {
        key: `access.${service}.${name}`, detail: null,
        value: a.value === null || b.value === null ? null : a.value - b.value,
        unit: '%', availability: a.value === null || b.value === null ? 'incomplete' : 'complete',
        provenance: a.provenance, comparison: region ? null : {
          direction: name === 'carGap' ? 'moins-est-mieux' : 'plus-est-mieux',
           scope: { kind: kind as ComparisonScopeKind, label: expectedLabel! },
          rank: null, reference: peer === null ? null : { kind: 'median', value: peer },
        }, comparisonBasis: 'territory-median', reason: null,
      }
    }
    const carGap = gap('carGap', 'car', 'peer_median_car_gap')
    const bikeGain = gap('bikeGain', 'bike', 'peer_median_bike_gain')
    if (!carGap || !bikeGain) invalid()
    gaps[service] = { carGap, bikeGain }
  }
  return { ...facts, mobility: { ...facts.mobility, access: { ...facts.mobility.access,
    byService: parsed as Record<MobiliteService, MobiliteAccessModes>,
    gapsByService: gaps as Record<MobiliteService, MobiliteAccessGaps>,
  } } }
}
