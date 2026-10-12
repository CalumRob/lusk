import { AEDAR_TYPEQU_REGISTRY } from './aedarTypequRegistry'

const scaleMaximum = 218
const productionScaleColors = ['#E9B2BE', '#D78A9C', '#C4667E', '#AD4562', '#87334E'] as const

/**
 * Semantic companion to the AEDAR car-map assets. Keep the scale and palette
 * aligned with the map producer; derive the BPE universe from its pinned axis,
 * never from rendered image pixels.
 */
export const AEDAR_CAR_MAP_LEGEND = {
  title: 'Types d’équipements accessibles*',
  minimum: 0,
  maximum: scaleMaximum,
  colors: productionScaleColors,
  ticks: Array.from({ length: productionScaleColors.length + 1 }, (_, index) =>
    Math.round(scaleMaximum * index / productionScaleColors.length)),
  note: `* Sur ${AEDAR_TYPEQU_REGISTRY.length} catégories d’équipements BPE`,
} as const
