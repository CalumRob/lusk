import type { TerritoryFacts, MobiliteAccessMode } from './territoryFacts'

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const modes = { c: 'car', b: 'bike', t: 'walkTransit' } as const satisfies Record<string, MobiliteAccessMode>
function invalid(): never { throw new Error('Publication API bâtiments invalide') }

/** Strictly replace the numeric building figures; the existing model supplies only presentation grammar. */
export function applyInitialBuildingApiFacts(facts: TerritoryFacts, response: unknown, mode: string | null, kind: string | null, label: string | null): TerritoryFacts {
  const hasScope = kind !== null && label !== null
  const hasPeer = isRecord(response) && response.peer_ramp !== null && response.peer_distribution !== null
  const expectedMode = mode ?? (hasScope ? 'bretagne' : null)
  if (!isRecord(response) || typeof response.publication_id !== 'string' || !response.publication_id ||
      !isRecord(response.territory) || response.territory.id !== facts.territory.code ||
      response.territory.type !== facts.territory.type ||
      (hasScope ? !isRecord(response.scope) || response.scope.comparison_mode !== expectedMode ||
        response.scope.kind !== kind
        : response.scope !== null) ||
      !Array.isArray(response.ramp) || !Array.isArray(response.distribution) ||
      (hasPeer ? !hasScope || !isRecord(response.peer_ramp) || response.peer_ramp.statistic !== 'mean' ||
        !Array.isArray(response.peer_ramp.points) || response.peer_ramp.points.length !== 33 ||
        !isRecord(response.peer_distribution) || response.peer_distribution.statistic !== 'mean' ||
        !Array.isArray(response.peer_distribution.cells) || response.peer_distribution.cells.length !== 30
        : response.peer_ramp !== null || response.peer_distribution !== null) ||
      response.ramp.length !== 33 || response.distribution.length !== 30) invalid()
  const currentRamp = facts.mobility.accessRamp
  const currentGrid = facts.mobility.buildingDistribution
  if (!currentRamp || !currentGrid || currentRamp.availability !== 'complete' || currentGrid.availability !== 'complete') invalid()
  const peerDistribution = response.peer_distribution as Record<string, unknown> | null
  const peerRampSummary = response.peer_ramp as Record<string, unknown> | null

  function points(rows: unknown[]): Map<string, Record<string, unknown>> {
    const result = new Map<string, Record<string, unknown>>()
    for (const row of rows) {
      if (!isRecord(row) || !(row.mode === 'c' || row.mode === 'b' || row.mode === 't') ||
          !Number.isInteger(row.quantile_index) || (row.quantile_index as number) < 0 || (row.quantile_index as number) > 10 ||
          !finite(row.quantile) || Math.abs(row.quantile - (row.quantile_index as number) / 10) > 1e-9 ||
          !finite(row.accessible_types) || row.accessible_types < 0 ||
          !Number.isInteger(row.total_buildings) || (row.total_buildings as number) <= 0) invalid()
      const key = `${row.mode}:${row.quantile_index}`
      if (result.has(key)) invalid()
      result.set(key, row)
    }
    return result
  }
  function cells(rows: unknown[]): Map<string, Record<string, unknown>> {
    const result = new Map<string, Record<string, unknown>>()
    for (const row of rows) {
      if (!isRecord(row) || typeof row.breadth_bucket !== 'string' || typeof row.depth_bucket !== 'string' ||
          !Number.isInteger(row.building_count) || (row.building_count as number) < 0 ||
          !Number.isInteger(row.total_buildings) || (row.total_buildings as number) <= 0 ||
          (row.building_count as number) > (row.total_buildings as number)) invalid()
      const key = `${row.breadth_bucket}\0${row.depth_bucket}`
      if (result.has(key)) invalid()
      result.set(key, row)
    }
    return result
  }
  const peerTotal = hasPeer ? peerRampSummary!.total_buildings as number : null
  const peerGridTotal = hasPeer ? peerDistribution!.total_buildings as number : null
  const focalRamp = points(response.ramp)
  const peerRamp = hasPeer ? points((peerRampSummary!.points as unknown[]).map((point: unknown) =>
    isRecord(point) ? { ...point, quantile_index: Math.round((point.quantile as number) * 10),
      total_buildings: peerTotal } : point)) : null
  const focalGrid = cells(response.distribution)
  const peerGrid = hasPeer ? cells((peerDistribution!.cells as unknown[]).map((cell: unknown) =>
    isRecord(cell) ? { ...cell, total_buildings: peerGridTotal } : cell)) : null
  const total = response.ramp[0].total_buildings as number
  const gridTotal = response.distribution[0].total_buildings as number
  if (total !== gridTotal || (hasPeer && peerTotal !== peerGridTotal) ||
      [...focalRamp.values()].some((row) => row.total_buildings !== total) ||
      (hasPeer && (!Number.isInteger(peerTotal) || peerTotal! <= 0 ||
        !Number.isInteger(peerGridTotal) || peerGridTotal! <= 0)) ||
      [...focalGrid.values()].some((row) => row.total_buildings !== gridTotal) ||
      (hasPeer && ([...peerGrid!.values()].some((row) => row.total_buildings !== peerGridTotal) ||
        [...peerGrid!.values()].some((row) => !finite(row.share) || row.share < 0 || row.share > 1 ||
          Math.abs(row.share - (row.building_count as number) / peerGridTotal!) > 1e-8)))) invalid()

  const curves = {} as Record<MobiliteAccessMode, typeof currentRamp.curves.car>
  for (const [apiMode, displayMode] of Object.entries(modes) as Array<[keyof typeof modes, MobiliteAccessMode]>) {
    const curve = currentRamp.curves[displayMode]
    if (curve.points.length !== 11) invalid()
    curves[displayMode] = { ...curve, points: curve.points.map((point, index) => {
      const focal = focalRamp.get(`${apiMode}:${index}`)
      const peer = peerRamp?.get(`${apiMode}:${index}`)
      if (!focal || (hasPeer && !peer)) invalid()
      return { ...point, quantile: focal.quantile as number, accessibleTypes: focal.accessible_types as number,
        comparisonAccessibleTypes: peer ? peer.accessible_types as number : null }
    }) }
  }
  if (currentGrid.cells.length !== 30 ||
      [...focalGrid.values()].reduce((sum, cell) => sum + (cell.building_count as number), 0) !== gridTotal ||
      (hasPeer && [...peerGrid!.values()].reduce((sum, cell) => sum + (cell.building_count as number), 0) !== peerGridTotal)) invalid()
  const gridCells = currentGrid.cells.map((cell) => {
    const key = `${cell.breadthBucket}\0${cell.depthBucket}`
    const focal = focalGrid.get(key)
    const peer = peerGrid?.get(key)
    if (!focal || (hasPeer && !peer)) invalid()
    return { ...cell, buildingCount: focal.building_count as number,
      share: (focal.building_count as number) / gridTotal,
      comparisonBuildingCount: peer ? peer.building_count as number : null,
      comparisonShare: peer ? peer.share as number : null }
  })
  return { ...facts, mobility: { ...facts.mobility,
    accessRamp: { ...currentRamp, curves, totalBuildings: total, comparisonTotalBuildings: peerTotal,
      comparisonLabel: label, comparisonStatistic: hasScope ? 'mean' : null },
    buildingDistribution: { ...currentGrid, cells: gridCells, totalBuildings: gridTotal,
      comparisonTotalBuildings: peerGridTotal, comparisonLabel: label,
      comparisonStatistic: hasScope ? 'mean' : null },
  } }
}
