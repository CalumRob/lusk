<script setup lang="ts">
export type CahierDonutRingMode = 'car' | 'bike' | 'walkTransit'

export interface CahierDonutRing {
  mode: CahierDonutRingMode
  value: number | null
  color: string
}

const props = withDefaults(defineProps<{
  rings: readonly CahierDonutRing[]
  labelAccessible: string
  /** Compact consumers can scale the fixed screen-space stroke with the mark. */
  scale?: number
  /** Show a neutral full ring when the represented type is inaccessible by every mode. */
  inaccessible?: boolean
}>(), {
  scale: 1,
  inaccessible: false,
})

const RING_RADII: Readonly<Record<CahierDonutRingMode, number>> = {
  car: 18,
  bike: 27,
  walkTransit: 36,
}
const RING_STROKE_WIDTH = 6
function ringRadius(mode: CahierDonutRingMode): number {
  return RING_RADII[mode]
}

function boundedRingValue(value: number | null): number {
  const bounded = value === null ? 0 : value
  return Math.max(0, Math.min(1, bounded))
}

function ringPath(mode: CahierDonutRingMode, value: number | null): string {
  const radius = ringRadius(mode)
  const boundedValue = boundedRingValue(value)
  const startY = 50 - radius
  if (boundedValue === 0) return `M 50 ${coordinate(startY)} L 50 ${coordinate(startY)}`
  if (boundedValue === 1) {
    return [
      `M 50 ${coordinate(startY)}`,
      `A ${radius} ${radius} 0 1 1 50 ${coordinate(50 + radius)}`,
      `A ${radius} ${radius} 0 1 1 50 ${coordinate(startY)}`,
    ].join(' ')
  }

  const angle = -Math.PI / 2 + boundedValue * 2 * Math.PI
  const endX = 50 + radius * Math.cos(angle)
  const endY = 50 + radius * Math.sin(angle)
  return `M 50 ${coordinate(startY)} A ${radius} ${radius} 0 ${boundedValue > 0.5 ? 1 : 0} 1 ${coordinate(endX)} ${coordinate(endY)}`
}

function coordinate(value: number): string {
  return Number(value.toFixed(3)).toString()
}

function ringStrokeWidth(): number {
  return Number((RING_STROKE_WIDTH * props.scale).toFixed(2))
}
</script>

<template>
  <div
    class="concentric-donut stacked-donut"
    :aria-label="props.labelAccessible"
    role="img"
    tabindex="0"
  >
    <svg
      class="concentric-donut-svg"
      viewBox="0 0 100 100"
      aria-hidden="true"
    >
      <path
        v-if="props.inaccessible"
        class="concentric-donut-ring concentric-donut-ring--inaccessible"
        fill="none"
        stroke="var(--cahier-profile-inaccessible)"
        stroke-linecap="butt"
        :stroke-width="ringStrokeWidth()"
        :d="ringPath('walkTransit', 1)"
      />
      <template v-else>
        <path
          v-for="ring in props.rings"
          :key="ring.mode"
          class="concentric-donut-ring"
          :class="`concentric-donut-ring--${ring.mode}`"
          :d="ringPath(ring.mode, ring.value)"
          fill="none"
          :stroke="ring.color"
          stroke-linecap="butt"
          :stroke-width="ringStrokeWidth()"
        />
      </template>
    </svg>
    <span v-if="$slots.default" class="stacked-donut-center">
      <slot />
    </span>
  </div>
</template>

<style scoped>
.stacked-donut {
  position: relative;
  width: var(--cahier-donut-size, clamp(92px, 12vw, 132px));
  aspect-ratio: 1;
  margin: 0 auto;
}

.concentric-donut-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.concentric-donut-ring {
  /* Keep the deliberate screen-space stroke; compact consumers pass scale. */
  vector-effect: non-scaling-stroke;
}

.stacked-donut:focus-visible {
  outline: 2px solid var(--cahier-region-emphasis);
  outline-offset: 5px;
}

.stacked-donut-center {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 4px;
  color: var(--cahier-default);
  font-family: var(--font-sans);
  font-size: 11px;
  line-height: 1.1;
  text-align: center;
}
</style>
