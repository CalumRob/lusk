import { computed, inject, provide, ref, unref } from 'vue'
import type { InjectionKey, MaybeRef, Ref } from 'vue'
import { comparaisonTerritorialeEligible } from '@/fiche/comparisonContext'
import type { AedarRampMode, ContentSection, ThemeContent, SingleUnitThemeContent } from '@/fiche/content/themeContent'
import type { AedarEquipmentHorizon } from '@/fiche/content/aedarEquipmentBuckets'
import { AEDAR_DEFAULT_VISIBLE_RAMP_MODES } from '@/fiche/content/aedarTimeRampFacts'
import type { CahierComparisonState } from './cahierSectionRenderers'

/** One presentation owner per Cahier mount, not an acquisition or group owner.
 * Equipment identity stays with the explorer (its only consumer). All section
 * compositions share these refs; replacing evidence never creates new controls.
 */
export interface AedarSectionContext {
  selectedModes: Ref<AedarRampMode[]>
  comparisonVisible: Ref<boolean>
  comparisonEligible: Readonly<Ref<boolean>>
  selectedHorizon: Ref<AedarEquipmentHorizon | null>
  chapterActive: Readonly<Ref<boolean>>
  comparison: Readonly<Ref<CahierComparisonState>>
}
const AEDAR_SECTION_CONTEXT: InjectionKey<AedarSectionContext> = Symbol('Cahier AEDAR sections')

export function provideAedarSectionContext(
  content: MaybeRef<ThemeContent | SingleUnitThemeContent>,
  chapterActive: Readonly<Ref<boolean>>,
  comparison: Readonly<Ref<CahierComparisonState>>,
): AedarSectionContext {
  const sections = unref(content).units.flatMap((unit) => unit.sections as readonly ContentSection[])
  const initial = sections.map(({ evidence }) => evidence).find((evidence) =>
    evidence?.kind === 'aedar-equipment-profile' || evidence?.kind === 'aedar-equipment-explorer')
  const context: AedarSectionContext = {
    selectedModes: ref([...AEDAR_DEFAULT_VISIBLE_RAMP_MODES]),
    comparisonVisible: ref(true),
    comparisonEligible: computed(() => comparaisonTerritorialeEligible(unref(content).territory)),
    selectedHorizon: ref(initial?.initialHorizonMinutes ?? null),
    chapterActive,
    comparison,
  }
  provide(AEDAR_SECTION_CONTEXT, context)
  return context
}

export function useAedarSectionContext(): AedarSectionContext {
  const context = inject(AEDAR_SECTION_CONTEXT)
  if (!context) throw new Error('AEDAR sections require their Cahier presentation owner')
  return context
}
