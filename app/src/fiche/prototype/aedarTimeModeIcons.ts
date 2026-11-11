import { Bike, BusFront, CarFront, Footprints } from 'lucide-vue-next'
import type { Component } from 'vue'

/**
 * AEDAR travel-mode glyphs shared by the cahier figures. A series uses one of
 * these where the product already owns the mode identity; colour-only series
 * keep a plain dot instead of an invented icon.
 */
export const AEDAR_TIME_MODE_ICONS: Readonly<Record<string, Component>> = {
  car: CarFront,
  bike_lts4: Bike,
  bike_lts2: Bike,
  transit: BusFront,
  walk: Footprints,
}
