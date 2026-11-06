import { CONTENU_CATALOGUE_INDICATEURS } from './catalogueContent'
import { LIBELLES_INDICATEURS_APP } from '@/fiche/content/libellesAffichage'
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
