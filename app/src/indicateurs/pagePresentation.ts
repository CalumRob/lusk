import { CONTENU_CATALOGUE_INDICATEURS } from './catalogueContent'
import { LIBELLES_INDICATEURS_APP } from '@/fiche/content/libellesAffichage'
import { orderedSeriesAdapterFor } from '@/payload/orderedSeriesAdapter'
import type { SemanticResourceDeclaration } from '@/payload/semanticResourceClient'
import type { IndicatorPageMetadata, Theme } from '@/payload/types'

/**
 * Page reader families kept distinct at the presentation boundary. `profile`
 * and `sparse-collection` identify native reader shapes; the remaining values
 * are the existing figure families. The caller supplies this identity from its
 * verified producer/API contract — this module declares no per-resource shape.
 */
export type FamillePresentationPage = IndicatorPageMetadata['family'] | 'profile' | 'sparse-collection'

/** Editorial and navigation content for one page, joined to a verified reader family. */
export interface PresentationPageIndicateur {
  readonly theme: Theme
  readonly themeLabel: string
  readonly resourceKey: string
  readonly title: string
  readonly subgroupKey: string
  readonly subgroupLabel: string
  readonly href: string
  /** Page-reader/layout identity supplied by the producer/API seam, not availability. */
  readonly layoutFamily: FamillePresentationPage
  /** Renderer compatibility is curated in the app catalogue, independently of API shape. */
  readonly figureFamily: IndicatorPageMetadata['family']
}

/**
 * Resolve stable page headings and grouping from the existing catalogue content.
 * Unknown resource keys have no editorial page binding; discovery and fact
 * availability are deliberately not consulted or inferred here.
 */
export function presentationPageIndicateur(
  theme: Theme,
  resourceKey: string,
  nativeLabel: string,
  layoutFamily: FamillePresentationPage,
  /** Kept optional for callers compiled against the original helper signature. */
  _legacyFigureFamily?: IndicatorPageMetadata['family'],
): PresentationPageIndicateur | null {
  const themeContent = CONTENU_CATALOGUE_INDICATEURS.find((candidate) => candidate.theme === theme)
  if (!themeContent) return null

  for (const subgroup of themeContent.sousGroupes) {
    const page = subgroup.pages.find((candidate) => candidate.resourceKey === resourceKey)
    if (!page) continue
    return {
      theme,
      themeLabel: themeContent.label,
      resourceKey: page.resourceKey,
      // The short app-owned wording wins only where it is already curated as
      // fact-free. Thresholds, years, category bands and scopes stay with the
      // verified producer/API label supplied by the caller.
      title: LIBELLES_INDICATEURS_APP[theme][resourceKey] ?? nativeLabel,
      subgroupKey: subgroup.key,
      subgroupLabel: subgroup.label,
      href: `/indicateurs/${theme}/${page.resourceKey}`,
      layoutFamily,
      figureFamily: page.figureFamily,
    }
  }

  return null
}

/**
 * Bind a discovered native resource to the same reader/layout that admits the
 * routed indicator page. Discovery facts select the native shape; the existing
 * app page binding decides whether that reader can render the curated figure.
 */
export function presentationPageDepuisRessource(
  theme: Theme,
  resourceKey: string,
  resource: SemanticResourceDeclaration,
  nativeLabel = resource.label,
): PresentationPageIndicateur | null {
  if (resource.resource_id !== resourceKey || resource.indicator_id !== resourceKey ||
      resource.theme_id !== theme || !resource.target_kinds.includes('territory_cohort') ||
      !resource.intents.includes('facts') || resource.allowed_levels.length === 0) return null

  let layoutFamily: FamillePresentationPage | null = null
  if (resource.shapes.includes('declared_profile')) {
    layoutFamily = 'profile'
  } else if (orderedSeriesAdapterFor(theme, resourceKey, resource)) {
    layoutFamily = 'trajectory'
  } else if (resource.shapes.length === 1 && resource.shapes[0] === 'scalar') {
    layoutFamily = 'scalar'
  } else if (resource.shapes.length === 1 && resource.shapes[0] === 'period_detail' &&
      resource.allowed_levels.length === 1 && resource.allowed_levels[0] === 'commune') {
    layoutFamily = 'sparse-collection'
  }
  if (!layoutFamily) return null

  const page = presentationPageIndicateur(theme, resourceKey, nativeLabel, layoutFamily)
  if (!page) return null

  const compatible = layoutFamily === 'profile'
    ? ['composition', 'distribution', 'list', 'pyramid'].includes(page.figureFamily)
    : layoutFamily === 'trajectory'
      ? ['trajectory', 'scalar'].includes(page.figureFamily)
      : layoutFamily === 'scalar'
        ? page.figureFamily === 'scalar'
        : page.figureFamily === 'list'
  return compatible ? page : null
}
