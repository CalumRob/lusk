/**
 * The theme → indicator-layer mapping (layouts.md §3 carte): each theme tab
 * switches the displayed indicator layer. One indicator per theme drives the
 * choropleth — the key, its French label (the product terms, CONTEXT.md).
 *
 * Mobilité and Économie map to null: their layers are not defined yet
 * (Mobilité's is mode-based per DESIGN.md §2; Économie has no choropleth
 * contract) — the map shows territory masks only. Their tabs don't render in
 * the payload anyway (payload-driven, ADR-0007); this mapping future-proofs
 * them without inventing a layer.
 */

import type { Theme } from '../payload/types'

export interface ConfigCouche {
  theme: Theme
  /** The payload key that feeds the choropleth (indicateurs_<theme>.json). */
  indicateur: string
  /** The French label of the indicator — legend, popup, sidebar. */
  libelle: string
}

const CONFIG: Partial<Record<Theme, ConfigCouche>> = {
  demographie: {
    theme: 'demographie',
    indicateur: 'densite',
    libelle: 'Densité de population',
  },
  habitat: {
    theme: 'habitat',
    indicateur: 'part_passoires',
    libelle: 'Part de passoires thermiques',
  },
}

/** The indicator layer for a theme — null when the theme has no choropleth (masks only). */
export function configCoucheTheme(theme: Theme): ConfigCouche | null {
  return CONFIG[theme] ?? null
}
