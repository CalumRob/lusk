/**
 * The fiche's tab vocabulary (ADR-0007 + ui-elements.md §ThemeTabs).
 *
 * ThemeTabs renders « Aperçu first, then the themes present in the payload »
 * — Aperçu is the default and runs on the general brand ramp; each theme tab
 * wears its own ramp. This module is the single source for the French labels,
 * the tab icons and the stable a11y ids shared between the tab bar and the
 * active panel (the shell's contract with C2/C3).
 */

import { Building2, Home, LayoutDashboard, Route, Trees, Users } from 'lucide-vue-next'
import type { Component } from 'vue'

import type { TerritoireType, Theme } from '@/payload/types'

/** The theme tabs' French labels (canonical order lives in the payload types). */
export const NOMS_THEMES: Record<Theme, string> = {
  mobilite: 'Mobilité',
  demographie: 'Démographie',
  habitat: 'Habitat',
  economie: 'Économie',
  milieux: 'Milieux',
}

/** One lucide icon per theme tab (ui-elements.md: « lucide icon + label »). */
export const ICONES_THEMES: Record<Theme, Component> = {
  mobilite: Route,
  demographie: Users,
  habitat: Home,
  economie: Building2,
  milieux: Trees,
}

/** The Aperçu tab's icon — the cross-theme default, on the brand ramp. */
export const ICONE_APERCU: Component = LayoutDashboard

/** A tab slug: a Theme, null for the fiche's Aperçu, or 'programmes' for the
 *  carte's renamed first tab (ADR-0019, #282 — ?onglet=programmes). */
export type SlugOnglet = Theme | null | 'programmes'

/** Stable ids shared by the tab (aria-controls) and its panel (the view).
 *  'programmes' keeps its own slug — the carte's first tab ids read
 *  onglet-programmes / panneau-programmes (ADR-0019, #282). */
export function idOnglet(slug: SlugOnglet): string {
  return `onglet-${slug ?? 'apercu'}`
}

export function idPanneau(slug: SlugOnglet): string {
  return `panneau-${slug ?? 'apercu'}`
}

/** The territory types' French labels (the fiche's type chip). */
export const NOMS_TYPES: Record<TerritoireType, string> = {
  commune: 'Commune',
  epci: 'EPCI',
  departement: 'Département',
  region: 'Région',
}

/** The data-list page for each type (the fiche's breadcrumb last step). */
export const LIENS_LISTES: Record<
  TerritoireType,
  { nom: string; chemin: string } | null
> = {
  commune: { nom: 'Les communes', chemin: '/communes' },
  epci: { nom: 'Les EPCI', chemin: '/epcis' },
  departement: { nom: 'Les départements', chemin: '/departements' },
  region: null, // la région n'a pas de page liste
}
