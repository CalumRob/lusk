<script setup lang="ts">
/**
 * The one shared Cahier PDF action (#1023).
 *
 * The shell mounts this once per native section heading. It owns no section
 * facts and no PDF template: capture comes from #1021's venue, generation from
 * the injected browser-side generator. Until lot E wires the real composer the
 * action stays visibly inert and explains that generation is unavailable; it
 * never simulates a success or a download.
 */
import { Check, FileDown, LoaderCircle, RotateCcw } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import AppIcon from '@/components/AppIcon.vue'
import type { CahierExportCapture } from './cahierExportCapture'
import { CAHIER_EXPORT_MAX_MODES } from './cahierExportCapture'
import type { CahierExportAvailability } from './cahierPdfExport'
import CahierActionButton from './CahierActionButton.vue'
import CahierDialog from './CahierDialog.vue'
import { CahierPdfExportController, cleIdentite } from './cahierPdfExportController'
import { messageActivationPdf } from './cahierPdfExport'
import type { CahierPdfGenerator, CahierPdfScopeIdentity } from './cahierPdfExportController'

const props = withDefaults(defineProps<{
  sectionKey: string
  sectionLabel: string
  identite: CahierPdfScopeIdentity
  capture: () => CahierExportCapture | null
  /** Cheap reactive read for button state; generation still uses `capture`. */
  availability: () => CahierExportAvailability | null
  generator?: CahierPdfGenerator | null
}>(), { generator: null })

const controller = new CahierPdfExportController({
  capture: () => props.capture(),
  availability: () => props.availability(),
  generator: props.generator,
  identite: () => props.identite,
})
const {
  etat,
  modaleOuverte,
  modesProposes,
  choix,
  nombreChoix,
  choixValide,
  peutActiver,
  disponibilite,
} = controller

const trigger = ref<HTMLButtonElement | null>(null)
const modesFieldset = ref<HTMLFieldSetElement | null>(null)
const reasonId = `cahier-pdf-reason-${props.sectionKey}`
const titleId = `cahier-pdf-title-${props.sectionKey}`
let focusReturn: HTMLElement | null = null
let unmounted = false

const label = computed(() => ({
  idle: 'PDF',
  preparing: 'Préparation…',
  done: 'PDF généré',
  error: 'Réessayer',
}[etat.value]))

const icon = computed(() => ({
  idle: FileDown,
  preparing: LoaderCircle,
  done: Check,
  error: RotateCcw,
}[etat.value]))

const ariaLabel = computed(() => {
  const action = etat.value === 'error'
    ? 'Échec de l’export, réessayer'
    : etat.value === 'done'
      ? 'PDF généré, exporter à nouveau'
      : etat.value === 'preparing'
        ? 'Préparation du PDF'
        : 'Exporter cette section en PDF'
  return `${action} : ${props.sectionLabel}`
})

const disabled = computed(() => etat.value === 'preparing')
// Before the first post-mount readiness read the DOM must already advertise a
// pending action with an honest reason; never show an enabled export on the
// first paint and withdraw it after hydration settles.
const amorce = ref(false)
const blocked = computed(() => !amorce.value || (etat.value !== 'preparing'
  && etat.value !== 'error'
  && !peutActiver.value))
const identityKey = computed(() => cleIdentite(props.identite))

watch(identityKey, () => controller.changerIdentite())
watch(() => props.generator, (next) => controller.definirGenerateur(next ?? null))

const blockedReason = computed(() => {
  if (!amorce.value) return messageActivationPdf(props.generator ? 'capture-unavailable' : 'generator-unavailable')
  if (etat.value === 'preparing' || etat.value === 'error') return ''
  if (peutActiver.value) return ''
  return disponibilite.value.ready ? '' : disponibilite.value.message
})

onMounted(() => {
  // Section owners register their public observations while the child body
  // mounts, after this sibling's first render. Re-read once the whole heading
  // is mounted so the action's reactive availability tracks their thunks.
  void nextTick(() => {
    controller.rafraichir()
    void nextTick(() => { amorce.value = true })
  })
})
onBeforeUnmount(() => {
  unmounted = true
  controller.dispose()
})

watch(modaleOuverte, async (open) => {
  if (unmounted) return
  if (open) {
    focusReturn = trigger.value
    await nextTick()
    await nextTick()
    if (unmounted) return
    modesFieldset.value?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus()
    return
  }
  await nextTick()
  await nextTick()
  if (!unmounted && focusReturn?.isConnected) {
    focusReturn.focus()
    focusReturn = null
  }
})
</script>

<template>
  <div class="cahier-pdf-action" :data-pdf-state="etat">
    <button
      ref="trigger"
      type="button"
      class="cahier-pdf-action__button"
      :aria-disabled="disabled || blocked ? 'true' : undefined"
      :aria-label="ariaLabel"
      :aria-busy="etat === 'preparing' ? 'true' : undefined"
      :aria-describedby="blockedReason ? reasonId : undefined"
      aria-live="polite"
      aria-atomic="true"
      @click="controller.activer()"
    >
      <span class="cahier-pdf-action__label">{{ label }}</span>
      <AppIcon
        :icone="icon"
        :taille="16"
        aria-hidden="true"
        :class="{ 'cahier-pdf-action__spinner': etat === 'preparing' }"
      />
    </button>
    <span
      v-if="blockedReason"
      :id="reasonId"
      class="cahier-pdf-action__reason"
    >{{ blockedReason }}</span>

    <CahierDialog
      v-if="modaleOuverte"
      :open="true"
      title="Exporter en PDF"
      :labelled-by="titleId"
      class="cahier-pdf-dialog"
      :style="{ width: 'min(94vw, 500px)' }"
      @close="controller.annuler()"
    >
      <template #toolbar>
        <p class="cahier-pdf-dialog__context">
          Choisissez jusqu’à trois modes pour garder les tableaux lisibles.
        </p>
      </template>
      <fieldset ref="modesFieldset" class="cahier-pdf-dialog__modes">
        <legend>Modes à inclure</legend>
        <label v-for="mode in modesProposes" :key="mode.id">
          <input
            type="checkbox"
            :value="mode.id"
            :checked="choix.includes(mode.id)"
            @change="controller.basculerMode(mode.id, ($event.target as HTMLInputElement).checked)"
          />
          <span>{{ mode.label }}</span>
        </label>
      </fieldset>
      <p class="cahier-pdf-dialog__count" aria-live="polite">
        {{ nombreChoix }} / {{ CAHIER_EXPORT_MAX_MODES }} modes sélectionnés<span
          v-if="nombreChoix > CAHIER_EXPORT_MAX_MODES"
        > — retirez un mode pour continuer.</span>
      </p>
      <div class="cahier-pdf-dialog__actions">
        <CahierActionButton @click="controller.annuler()">Annuler</CahierActionButton>
        <CahierActionButton
          :disabled="!choixValide"
          data-pdf-confirm
          @click="controller.confirmer()"
        >
          Générer le PDF
          <AppIcon :icone="FileDown" :taille="16" aria-hidden="true" />
        </CahierActionButton>
      </div>
    </CahierDialog>
  </div>
</template>

<style scoped>
.cahier-pdf-action {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
}
.cahier-pdf-action__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-height: 36px;
  padding: var(--space-2);
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--red, var(--cahier-theme-strong));
  font: var(--type-figure-label);
  white-space: nowrap;
  cursor: pointer;
}
.cahier-pdf-action__button:hover:not([aria-disabled='true']) {
  background: color-mix(in srgb, currentColor 8%, transparent);
}
.cahier-pdf-action__button:active:not([aria-disabled='true']) {
  background: color-mix(in srgb, currentColor 14%, transparent);
}
.cahier-pdf-action__button:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}
.cahier-pdf-action__button[aria-disabled='true'] {
  cursor: not-allowed;
  opacity: .55;
}
.cahier-pdf-action__button[aria-busy='true'] {
  cursor: wait;
}
.cahier-pdf-action__reason {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.cahier-pdf-action__spinner {
  animation: cahier-pdf-spin 1s linear infinite;
}
.cahier-pdf-dialog__context {
  flex: 1;
  margin: 0;
  color: var(--red);
  font: var(--type-figure-label);
  line-height: 1.6;
}
.cahier-pdf-dialog__modes {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.cahier-pdf-dialog__modes legend {
  margin-bottom: var(--space-2);
  color: var(--muted);
  font: var(--type-figure-legend);
}
.cahier-pdf-dialog__modes label {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) 0;
  color: var(--ink);
  font: var(--type-figure-label);
  cursor: pointer;
}
.cahier-pdf-dialog__modes input {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  accent-color: var(--red);
}
.cahier-pdf-dialog__count {
  margin: 0;
  color: var(--muted);
  font: var(--type-figure-legend);
}
.cahier-pdf-dialog__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-3);
}
.cahier-pdf-dialog__actions :deep(button) {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
.cahier-pdf-dialog__actions :deep(button:disabled) {
  opacity: .5;
  cursor: not-allowed;
}
@keyframes cahier-pdf-spin {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .cahier-pdf-action__spinner { animation: none; }
}
@media (max-width: 760px) {
  .cahier-pdf-action__button {
    min-height: 44px;
  }
}
</style>
