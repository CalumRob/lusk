import { h } from 'vue'
import type { VNode } from 'vue'
import type { ContentEvidence, ContentSection } from '@/fiche/content/themeContent'
import CahierAedarAccessSection from './CahierAedarAccessSection.vue'
import CahierAedarDiversityLossSection from './CahierAedarDiversityLossSection.vue'
import CahierAedarExplorerSection from './CahierAedarExplorerSection.vue'
import CahierAedarOverviewSection from './CahierAedarOverviewSection.vue'
import CahierAedarProfileSection from './CahierAedarProfileSection.vue'
import CahierMobiliteSection from './CahierMobiliteSection.vue'

export interface CahierComparisonState {
  status: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'
  error?: string
  retry?: () => void
}
export interface CahierSectionRendererProps {
  section: ContentSection
  unit: { key: string; label: string }
  comparison: CahierComparisonState
}
interface SectionRenderer {
  classes: readonly string[]
  flip: boolean
  argument: boolean
  body: ((props: CahierSectionRendererProps) => VNode | null) | null
}

// Deliberately a closed Cahier lookup, not a plugin/acquisition framework.
// Each binding narrows its evidence before passing the real figure contract.
// Adding a ContentEvidence kind fails type checking until it has a renderer.
const mobilite: SectionRenderer = {
  classes: ['mobilite-delegate'], flip: false, argument: false,
  body: ({ section, unit, comparison }) => h(CahierMobiliteSection, { section, unit, comparison }),
}
export const CAHIER_SECTION_RENDERERS = {
  'aedar-car-overview': {
    classes: ['figure-spread', 'figure-spread--paired'], flip: false, argument: false,
    body: ({ section }) => section.evidence?.kind === 'aedar-car-overview'
      ? h(CahierAedarOverviewSection, { evidence: section.evidence }) : null,
  },
  'aedar-diversity-loss': {
    classes: ['figure-spread', 'figure-spread--stack', 'figure-spread--aedar-diversity-loss'], flip: false, argument: false,
    body: ({ section }) => section.evidence?.kind === 'aedar-diversity-loss'
      ? h(CahierAedarDiversityLossSection, { evidence: section.evidence }) : null,
  },
  'aedar-access': {
    classes: ['figure-spread'], flip: true, argument: true,
    body: ({ section }) => section.evidence?.kind === 'aedar-access'
      ? h(CahierAedarAccessSection, { evidence: section.evidence }) : null,
  },
  'aedar-equipment-profile': {
    classes: ['figure-spread', 'figure-spread--stack', 'figure-spread--aedar-equipment-profile'], flip: true, argument: false,
    body: ({ section }) => section.evidence?.kind === 'aedar-equipment-profile'
      ? h(CahierAedarProfileSection, { evidence: section.evidence, title: section.label }) : null,
  },
  'aedar-equipment-explorer': {
    classes: ['figure-spread', 'figure-spread--stack', 'figure-spread--aedar-equipment-explorer'], flip: true, argument: false,
    body: ({ section }) => section.evidence?.kind === 'aedar-equipment-explorer'
      ? h(CahierAedarExplorerSection, { evidence: section.evidence }) : null,
  },
  'mobilite-networks': mobilite,
  'mobilite-stationnement-ravitaillement': mobilite,
  'mobilite-share': mobilite,
  'mobilite-raccordement': mobilite,
} satisfies Record<ContentEvidence['kind'], SectionRenderer>

const fallback: SectionRenderer = { classes: ['figure-spread'], flip: true, argument: true, body: null }
export function cahierSectionRendererFor(evidence: ContentEvidence | null, aedarEnabled: boolean): SectionRenderer {
  if (evidence === null) return fallback
  if (evidence.kind.startsWith('aedar-') && !aedarEnabled) return fallback
  return CAHIER_SECTION_RENDERERS[evidence.kind]
}

/** Stable component identity: evidence/status updates do not remount controls. */
export function CahierSectionBody(props: CahierSectionRendererProps & { enabled: boolean }): VNode | null {
  return cahierSectionRendererFor(props.section.evidence, props.enabled).body?.(props) ?? null
}
