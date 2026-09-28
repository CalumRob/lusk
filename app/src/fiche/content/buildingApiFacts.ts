import type { TerritoryFacts, MobiliteAccessMode } from './territoryFacts'

const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const modes = { c: 'car', b: 'bike', t: 'walkTransit' } as const satisfies Record<string, MobiliteAccessMode>
function invalid(): never { throw new Error('Publication API bâtiments invalide') }
/** Compare the declared 0–100 % ramp positions, not their floating encodings. */
function position(quantile: number): number {
  const index = Math.round(quantile * 10)
  if (!finite(quantile) || index < 0 || index > 10 || Math.abs(quantile - index / 10) > 1e-9) invalid()
  return index
}

/** Apply validated custom-scope peers while leaving all focal publication facts intact. */
export function applyBuildingApiFacts(facts: TerritoryFacts, response: unknown, expectedPublicationId?: string): TerritoryFacts {
  if (!record(response) || typeof response.publication_id !== 'string' || !response.publication_id ||
      (expectedPublicationId !== undefined && response.publication_id !== expectedPublicationId) ||
      !record(response.territory) || response.territory.id !== facts.territory.code || response.territory.type !== facts.territory.type ||
      !record(response.scope) || response.scope.kind !== 'custom' || !['high', 'low'].includes(String(response.scope.direction)) ||
      response.scope.level !== 'commune' || !Array.isArray(response.scope.members) ||
      response.scope.members.some((id) => typeof id !== 'string' || !id)) invalid()
  const ramp = response.ramp
  const distribution = response.distribution
  const validSummary = (v: unknown): v is Record<string, unknown> => v === null || (record(v) && v.statistic === 'mean' &&
    Number.isInteger(v.member_count) && (v.member_count as number) >= 0 && finite(v.total_buildings) && v.total_buildings >= 0)
  if (!validSummary(ramp) || !validSummary(distribution) ||
      (ramp === null) !== (distribution === null) ||
      (ramp !== null && distribution !== null && (ramp.member_count !== distribution.member_count ||
        ramp.total_buildings !== distribution.total_buildings || (ramp.member_count as number) < 2))) invalid()

  let nextRamp = facts.mobility.accessRamp
  if (nextRamp && ramp !== null) {
    if (!Array.isArray(ramp.points) || ramp.points.length !== 33) invalid()
    const peers = new Map<string, number>()
    for (const p of ramp.points) {
      if (!record(p) || !(p.mode === 'c' || p.mode === 'b' || p.mode === 't') || !finite(p.quantile) ||
          !finite(p.accessible_types) || p.accessible_types < 0) invalid()
      const key = `${p.mode}:${position(p.quantile)}`
      if (peers.has(key)) invalid()
      peers.set(key, p.accessible_types as number)
    }
    if ((Object.keys(modes) as Array<keyof typeof modes>).some((mode) =>
      nextRamp!.curves[modes[mode]].points.some((point) => !peers.has(`${mode}:${position(point.quantile)}`)))) invalid()
    nextRamp = { ...nextRamp, comparisonStatistic: 'mean', comparisonTotalBuildings: ramp.total_buildings as number,
      curves: Object.fromEntries((Object.keys(modes) as Array<keyof typeof modes>).map((mode) => [modes[mode], {
        ...nextRamp!.curves[modes[mode]], points: nextRamp!.curves[modes[mode]].points.map((point) => ({ ...point,
          comparisonAccessibleTypes: peers.get(`${mode}:${position(point.quantile)}`) ?? null,
        })),
      }])) as unknown as typeof nextRamp.curves }
  } else if (nextRamp) nextRamp = { ...nextRamp, comparisonStatistic: 'mean', comparisonTotalBuildings: null,
    curves: Object.fromEntries(Object.entries(nextRamp.curves).map(([mode, curve]) => [mode, { ...curve, points: curve.points.map((p) => ({ ...p, comparisonAccessibleTypes: null })) }])) as unknown as typeof nextRamp.curves }

  let nextDistribution = facts.mobility.buildingDistribution
  if (nextDistribution && distribution !== null) {
    if (!Array.isArray(distribution.cells) || distribution.cells.length !== 30) invalid()
    const peers = new Map<string, { count: number; share: number }>()
    for (const c of distribution.cells) {
      if (!record(c) || typeof c.breadth_bucket !== 'string' || typeof c.depth_bucket !== 'string' ||
          !Number.isInteger(c.building_count) || (c.building_count as number) < 0 || !finite(c.share) || c.share < 0 || c.share > 1) invalid()
      const key = `${c.breadth_bucket}\0${c.depth_bucket}`
      if (peers.has(key)) invalid()
      peers.set(key, { count: c.building_count as number, share: c.share })
    }
    if (nextDistribution.cells.some((cell) => !peers.has(`${cell.breadthBucket}\0${cell.depthBucket}`))) invalid()
    nextDistribution = { ...nextDistribution, comparisonStatistic: 'mean', comparisonTotalBuildings: distribution.total_buildings as number,
      cells: nextDistribution.cells.map((cell) => { const peer = peers.get(`${cell.breadthBucket}\0${cell.depthBucket}`); return { ...cell,
        comparisonBuildingCount: peer?.count ?? null, comparisonShare: peer?.share ?? null } }) }
  } else if (nextDistribution) nextDistribution = { ...nextDistribution, comparisonStatistic: 'mean', comparisonTotalBuildings: null,
    cells: nextDistribution.cells.map((c) => ({ ...c, comparisonBuildingCount: null, comparisonShare: null })) }

  return { ...facts, mobility: { ...facts.mobility, accessRamp: nextRamp, buildingDistribution: nextDistribution } }
}

/** No static peer is shown while an explicit selection is loading or failed. */
export function clearBuildingApiPeers(facts: TerritoryFacts): TerritoryFacts {
  const ramp = facts.mobility.accessRamp
  const distribution = facts.mobility.buildingDistribution
  return { ...facts, mobility: { ...facts.mobility,
    accessRamp: ramp && { ...ramp, comparisonStatistic: 'mean', comparisonTotalBuildings: null,
      curves: Object.fromEntries(Object.entries(ramp.curves).map(([mode, curve]) => [mode, { ...curve,
        points: curve.points.map((point) => ({ ...point, comparisonAccessibleTypes: null })) }])) as unknown as typeof ramp.curves },
    buildingDistribution: distribution && { ...distribution, comparisonStatistic: 'mean', comparisonTotalBuildings: null,
      cells: distribution.cells.map((cell) => ({ ...cell, comparisonBuildingCount: null, comparisonShare: null })) },
  } }
}
