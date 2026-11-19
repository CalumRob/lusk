import { inject } from 'vue'
import type { InjectionKey } from 'vue'
import type { AedarRampMode, ContentSection, ContentUnit, ThemeContent } from '@/fiche/content/themeContent'
import type { CahierCaptureMapLegendDetail } from './cahierExportCapture'

/** A presentation can render a subset of a producer unit without rewriting its section. */
export type CahierPresentationContent = Omit<ThemeContent, 'units'> & {
  units: readonly (Omit<ContentUnit, 'sections'> & { sections: readonly ContentSection[] })[]
}

export interface CahierNativeRenderInput {
  readonly content: CahierPresentationContent
  readonly presentation: 'plain' | 'ruled'
  readonly layoutVariant: 'standard' | 'indexed-sections'
  readonly sectionIndex: number
}

/**
 * Every Cahier section body has one native Vue renderer (`CAHIER_SECTION_RENDERERS`);
 * the shared DOM-paint path mounts that renderer for any of them. This is not an
 * alternate renderer registry: the section kind only gates the frozen-input
 * capture, never a second PDF template.
 */
export function supportsStagedNativeRender(kind: NonNullable<ContentSection['evidence']>['kind'] | undefined): boolean {
  return kind === 'aedar-car-overview' || kind === 'aedar-diversity-loss' || kind === 'aedar-access'
    || kind === 'aedar-equipment-profile' || kind === 'aedar-equipment-explorer'
    || kind === 'mobilite-networks' || kind === 'mobilite-stationnement-ravitaillement'
    || kind === 'mobilite-share' || kind === 'mobilite-raccordement'
}

/** Every value is resolved before mount. Native owners must not acquire in this context. */
export interface CahierNativeRenderContext {
  readonly modes: readonly AedarRampMode[]
  /** Reader's frozen equipment identity and horizon (null when not applicable). */
  readonly typequ: string | null
  readonly horizonMinutes: import('@/fiche/content/aedarEquipmentBuckets').AedarEquipmentHorizon | null
  readonly comparisonVisible: boolean
  readonly comparisonEligible: boolean
  readonly sectionIndex: number
  readonly carMap: { readonly src: string; readonly legend: CahierCaptureMapLegendDetail | null } | null
  /** Settled object URLs of every declared captured map, keyed by owner item id. */
  readonly assets: Readonly<Record<string, string>>
  readonly comparisonNone: boolean
  readonly barToggles: Readonly<Record<string, boolean>>
}

export const CAHIER_NATIVE_RENDER: InjectionKey<CahierNativeRenderContext> = Symbol('Frozen Cahier render')

export function useCahierNativeRender() {
  return inject(CAHIER_NATIVE_RENDER, null)
}
