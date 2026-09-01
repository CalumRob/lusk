export type MasonryColumn = 0 | 1

export interface MasonryMeasurement {
  key: string
  height: number
}

export interface MasonryPlacement {
  key: string
  column: MasonryColumn
  top: number
}

export interface MasonryLayout {
  placements: readonly MasonryPlacement[]
  height: number
}

/**
 * Greedy two-column masonry: each item starts in the currently shorter
 * column. Equal heights resolve to the left column so the result is stable.
 * The function is deliberately DOM-free; measuring belongs to the renderer,
 * while placement remains a deterministic, testable layout rule.
 */
export function layoutMasonry(
  measurements: readonly MasonryMeasurement[],
  options: { columns?: 1 | 2; gap?: number } = {},
): MasonryLayout {
  const columns = options.columns ?? 2
  const gap = Math.max(0, options.gap ?? 0)
  const heights = Array.from({ length: columns }, () => 0)
  const placements: MasonryPlacement[] = []

  for (const measurement of measurements) {
    let column = 0
    for (let candidate = 1; candidate < columns; candidate += 1) {
      if (heights[candidate] < heights[column]) column = candidate
    }

    placements.push({
      key: measurement.key,
      column: column as MasonryColumn,
      top: heights[column],
    })
    heights[column] += Math.max(0, Number.isFinite(measurement.height) ? measurement.height : 0) + gap
  }

  const occupiedHeight = Math.max(0, ...heights)
  return {
    placements,
    height: measurements.length > 0 ? Math.max(0, occupiedHeight - gap) : 0,
  }
}
