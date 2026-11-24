/**
 * Public read seam for the shared Cahier export capture (#1021).
 *
 * The shell owns the venue; each mounted section body exposes the local state
 * its own figures already own through a public publication, never through
 * private component internals. Capturing reads the current thunks
 * synchronously: it starts no acquisition and never mutates a control.
 */
import { inject, onBeforeUnmount, provide } from 'vue'
import type { InjectionKey } from 'vue'

import type {
  CahierExportCapture,
  CahierExportPublication,
  CahierExportPublicationState,
} from './cahierExportCapture'
import type { CahierExportAvailability } from './cahierPdfExport'

export interface CahierExportVenue {
  /** Capture the current effective state of one mounted section, or null when absent. */
  captureSection(sectionKey: string): CahierExportCapture | null
  /** Cheap reactive availability read for one section, without cloning its evidence. */
  captureAvailability(sectionKey: string): CahierExportAvailability | null
  /** Capture every mounted section, in mount order. */
  captureAll(): readonly CahierExportCapture[]
  /** Section keys currently mounted on the shared path. */
  sectionKeys(): readonly string[]
}

interface CahierExportRegistry {
  readonly sections: Map<string, Map<string, () => CahierExportPublicationState>>
  order: string[]
}

export const CAHIER_EXPORT_CAPTURE_KEY: InjectionKey<CahierExportVenue> =
  Symbol('Cahier export capture venue')
const CAHIER_EXPORT_REGISTRY_KEY: InjectionKey<CahierExportRegistry> =
  Symbol('Cahier export capture registry')
const CAHIER_EXPORT_SECTION_KEY: InjectionKey<string> =
  Symbol('Cahier export capture section')
const CAHIER_EXPORT_SLOT_KEY: InjectionKey<string> =
  Symbol('Cahier export capture slot')

export type CahierExportCaptureBuilder = (
  sectionKey: string,
  publications: readonly CahierExportPublication[],
) => CahierExportCapture | null

export type CahierExportAvailabilityBuilder = (
  sectionKey: string,
  publications: readonly CahierExportPublication[],
) => CahierExportAvailability | null

export function provideCahierExportVenue(
  build: CahierExportCaptureBuilder,
  buildAvailability?: CahierExportAvailabilityBuilder,
): CahierExportVenue {
  const registry: CahierExportRegistry = { sections: new Map(), order: [] }
  const publicationsFor = (sectionKey: string): CahierExportPublication[] =>
    [...(registry.sections.get(sectionKey)?.entries() ?? [])].map(([slot, read]) => ({
      slot,
      state: read(),
    }))
  const captureFor = (sectionKey: string): CahierExportCapture | null =>
    build(sectionKey, publicationsFor(sectionKey))
  const venue: CahierExportVenue = {
    captureSection: captureFor,
    captureAvailability: (sectionKey) => (buildAvailability ?? build)(sectionKey, publicationsFor(sectionKey)),
    captureAll: () => registry.order
      .map((sectionKey) => captureFor(sectionKey))
      .filter((capture): capture is CahierExportCapture => capture !== null),
    sectionKeys: () => [...registry.order],
  }
  provide(CAHIER_EXPORT_CAPTURE_KEY, venue)
  provide(CAHIER_EXPORT_REGISTRY_KEY, registry)
  return venue
}

/** Consume the public capture seam from the same shared path (PDF controller). */
export function useCahierExportVenue(): CahierExportVenue | null {
  return inject(CAHIER_EXPORT_CAPTURE_KEY, null)
}

/** Called by the renderless section scope, one per rendered section. */
export function useCahierExportSectionRegistration(sectionKey: string): void {
  const registry = inject(CAHIER_EXPORT_REGISTRY_KEY, null)
  if (!registry) return
  if (!registry.sections.has(sectionKey)) {
    registry.sections.set(sectionKey, new Map())
    registry.order.push(sectionKey)
  }
  onBeforeUnmount(() => {
    registry.sections.delete(sectionKey)
    registry.order = registry.order.filter((key) => key !== sectionKey)
  })
}

export interface CahierExportSlotContext {
  readonly sectionKey: string
  readonly slotPath: string
}

/** Called by a section scope so descendants register into the right section. */
export function provideCahierExportSlot(
  context: CahierExportSlotContext,
): string {
  provide(CAHIER_EXPORT_SECTION_KEY, context.sectionKey)
  provide(CAHIER_EXPORT_SLOT_KEY, context.slotPath)
  return context.slotPath
}

export function useCahierExportSlot(): CahierExportSlotContext | null {
  const sectionKey = inject(CAHIER_EXPORT_SECTION_KEY, null)
  if (!sectionKey) return null
  return { sectionKey, slotPath: inject(CAHIER_EXPORT_SLOT_KEY, '') }
}

/**
 * Publish the state a mounted owner already holds. The thunk is read at capture
 * time, so the snapshot reflects the current effective selection; it never
 * copies a live Vue proxy into the request. An optional `key` lets one owner
 * publish several observations (its equipment state and its comparison layer,
 * for example) without inventing a nested scope.
 */
export function useCahierExportPublication(
  read: () => CahierExportPublicationState,
  key = '',
): void {
  const registry = inject(CAHIER_EXPORT_REGISTRY_KEY, null)
  const context = useCahierExportSlot()
  if (!registry || !context) return
  const section = registry.sections.get(context.sectionKey)
  if (!section) return
  const slotPath = key
    ? (context.slotPath ? `${context.slotPath}/${key}` : key)
    : context.slotPath
  if (section.has(slotPath)) {
    throw new Error(`Cahier export capture: duplicate publication slot "${slotPath}"`)
  }
  section.set(slotPath, read)
  onBeforeUnmount(() => {
    if (section.get(slotPath) === read) section.delete(slotPath)
  })
}
