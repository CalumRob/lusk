<script setup lang="ts">
/**
 * Renderless capture scope (#1021). A section scope registers the section with
 * the public venue; a nested scope names the figure slot inside it (the paired
 * terrain column, the map plate, …). It renders no DOM element, so the shell's
 * `figure-stack` children and every layout selector stay unchanged.
 */
import { useCahierExportSlot, provideCahierExportSlot, useCahierExportSectionRegistration } from './cahierExportVenue'

const props = defineProps<{
  sectionKey?: string
  captureSlot?: string
}>()

const parent = useCahierExportSlot()
const sectionKey = props.sectionKey ?? parent?.sectionKey ?? null
if (props.sectionKey) useCahierExportSectionRegistration(props.sectionKey)
if (sectionKey) {
  const slotPath = props.captureSlot
    ? (parent?.slotPath ? `${parent.slotPath}/${props.captureSlot}` : props.captureSlot)
    : parent?.slotPath ?? ''
  provideCahierExportSlot({ sectionKey, slotPath })
}
</script>

<template>
  <slot />
</template>
