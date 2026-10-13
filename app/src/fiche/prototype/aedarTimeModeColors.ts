import type { AedarRampMode } from '@/fiche/content/themeContent'

/** Canonical AEDAR mode palette shared by time ramps, maps and equipment figures. */
export const AEDAR_TIME_MODE_COLORS: Readonly<Record<string, string>> = {
  car: 'var(--cahier-mode-car)',
  bike_lts2: 'color-mix(in srgb, var(--cahier-mode-bike) 55%, var(--paper))',
  bike_lts4: 'var(--cahier-mode-bike)',
  transit: 'var(--cahier-mode-foot)',
  walk: 'color-mix(in srgb, var(--cahier-mode-foot) 55%, var(--paper))',
} satisfies Readonly<Record<AedarRampMode, string>>
