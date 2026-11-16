<script setup lang="ts">
// THROWAWAY: approved visual/state specimen; simulated generation, not a production exporter.
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { Check, FileDown, LoaderCircle, RotateCcw } from 'lucide-vue-next'
import AppIcon from '@/components/AppIcon.vue'
import CahierActionButton from '../CahierActionButton.vue'
import CahierDialog from '../CahierDialog.vue'

type Section = { key: string; label: string; selectableModes: boolean }
type Mode = { key: string; label: string }
type State = 'ready' | 'preparing' | 'error' | 'done'
const props = defineProps<{
  sections: Section[]
  modes: () => Mode[]
  scenario: string
  changeScenario: (scenario: string) => void
}>()
const states = reactive<Record<string, State>>({})
const chooser = ref<Section | null>(null)
const choices = ref<string[]>([])
const offeredModes = ref<Mode[]>([])
const validChoice = computed(() => choices.value.length > 0 && choices.value.length <= 3)
const timers = new Set<ReturnType<typeof setTimeout>>()
const buttonLabels = { ready: 'PDF', preparing: 'Préparation…', error: 'Réessayer', done: 'PDF généré' }
const buttonIcons = { ready: FileDown, preparing: LoaderCircle, error: RotateCcw, done: Check }
watch(() => props.scenario, value => {
  chooser.value = null
  for (const timer of timers) clearTimeout(timer)
  timers.clear()
  for (const section of props.sections) states[section.key] = value === 'preparing' ? 'preparing' : value === 'error' ? 'error' : value === 'done' ? 'done' : 'ready'
}, { immediate: true })
onBeforeUnmount(() => timers.forEach(clearTimeout))

function prepare(section: Section) {
  chooser.value = null
  states[section.key] = 'preparing'
  const timer = setTimeout(() => {
    timers.delete(timer)
    states[section.key] = props.scenario === 'error' ? 'error' : 'done'
  }, 1400)
  timers.add(timer)
}
function start(section: Section) {
  if (states[section.key] === 'preparing') return
  // Retry represents the same failed export request, not a fresh mode choice.
  if (states[section.key] === 'error') { prepare(section); return }
  const modes = section.selectableModes ? props.modes() : []
  if (modes.length > 3) {
    offeredModes.value = modes
    choices.value = []
    chooser.value = section
  } else prepare(section)
}
function accept() {
  if (chooser.value && validChoice.value) prepare(chooser.value)
}
</script>

<template>
  <template v-for="section in sections" :key="section.key">
    <Teleport :to="`[data-pdf-ui-action='${section.key}']`">
      <CahierActionButton
        class="pdf-ui-button"
        :data-pdf-ui-export="section.key"
        :data-pdf-ui-state="states[section.key]"
        :disabled="states[section.key] === 'preparing'"
        :aria-busy="states[section.key] === 'preparing'"
        :aria-label="`${states[section.key] === 'error' ? 'Échec de l’export, réessayer' : states[section.key] === 'done' ? 'PDF généré, exporter à nouveau' : states[section.key] === 'preparing' ? 'Préparation du PDF' : 'Exporter cette section en PDF'} : ${section.label}`"
        aria-live="polite"
        aria-atomic="true"
        @click="start(section)"
      >
        <span>{{ buttonLabels[states[section.key]] }}</span>
        <AppIcon :icone="buttonIcons[states[section.key]]" :taille="16" aria-hidden="true" :class="{ 'pdf-ui-spinner': states[section.key] === 'preparing' }" />
      </CahierActionButton>
    </Teleport>
  </template>

  <CahierDialog :open="chooser !== null" title="Exporter en PDF" labelled-by="pdf-ui-choice-title" class="pdf-ui-dialog" @close="chooser = null">
    <template #toolbar><p class="pdf-ui-context">Choisissez jusqu’à trois modes pour garder les tableaux lisibles.</p></template>
    <fieldset class="pdf-ui-modes">
      <legend>Modes à inclure</legend>
      <label v-for="mode in offeredModes" :key="mode.key">
        <input v-model="choices" type="checkbox" :value="mode.key" />
        <span>{{ mode.label }}</span>
      </label>
    </fieldset>
    <p class="pdf-ui-count" aria-live="polite">{{ choices.length }} / 3 modes sélectionnés<span v-if="choices.length > 3"> — retirez un mode pour continuer.</span></p>
    <div class="pdf-ui-dialog-actions">
      <CahierActionButton @click="chooser = null">Annuler</CahierActionButton>
      <CahierActionButton :disabled="!validChoice" data-pdf-ui-confirm @click="accept">Générer le PDF <AppIcon :icone="FileDown" :taille="16" aria-hidden="true" /></CahierActionButton>
    </div>
    <p class="pdf-ui-disclaimer">Maquette interactive — aucun PDF ne sera généré.</p>
  </CahierDialog>

  <nav class="pdf-ui-switcher" aria-label="États de la maquette PDF">
    <span>Maquette PDF · simulation</span>
    <div>
      <button v-for="(label, key) in { ready: 'Prêt', preparing: 'Préparation', done: 'Succès', error: 'Erreur' }" :key="key" type="button" :aria-pressed="scenario === key" @click="changeScenario(key)">{{ label }}</button>
    </div>
  </nav>
</template>

<style scoped>
.pdf-ui-button { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2); border: 0; white-space: nowrap; }
.pdf-ui-button:disabled { cursor: wait; opacity: .65; }
.pdf-ui-spinner { animation: pdf-ui-spin 1s linear infinite; }
.pdf-ui-dialog { width: min(94vw, 500px); }
.pdf-ui-context { margin: 0; color: var(--red); font: var(--type-figure-label); line-height: 1.6; flex: 1; }
.pdf-ui-modes { display: grid; gap: var(--space-2); margin: 0; padding: 0; border: 0; min-width: 0; }
.pdf-ui-modes legend { margin-bottom: var(--space-2); color: var(--muted); font: var(--type-figure-legend); }
.pdf-ui-modes label { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) 0; color: var(--ink); font: var(--type-figure-label); cursor: pointer; }
.pdf-ui-modes input { width: 18px; height: 18px; accent-color: var(--red); flex-shrink: 0; }
.pdf-ui-count { margin: 0; color: var(--muted); font: var(--type-figure-legend); }
.pdf-ui-dialog-actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: var(--space-3); }
.pdf-ui-dialog-actions :deep(button) { display: inline-flex; align-items: center; gap: var(--space-2); }
.pdf-ui-dialog-actions :deep(button:disabled) { opacity: .5; cursor: not-allowed; }
.pdf-ui-disclaimer { margin: 0; color: var(--muted); font: var(--type-figure-legend); }
.pdf-ui-switcher { position: fixed; z-index: 100; bottom: 12px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: var(--space-4); padding: var(--space-2) var(--space-3); max-width: calc(100vw - 24px); background: var(--ink); color: var(--paper); font: var(--type-figure-legend); box-shadow: 0 2px 12px color-mix(in srgb, var(--ink) 20%, transparent); }
.pdf-ui-switcher > span { white-space: nowrap; }
.pdf-ui-switcher > div { display: flex; gap: var(--space-1); }
.pdf-ui-switcher button { border: 1px solid transparent; padding: var(--space-2); background: transparent; color: inherit; font: inherit; cursor: pointer; }
.pdf-ui-switcher button[aria-pressed='true'] { border-color: currentColor; }
.pdf-ui-switcher button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
@keyframes pdf-ui-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .pdf-ui-spinner { animation: none; } }
@media (max-width: 760px) {
  .pdf-ui-button { min-height: 44px; }
  .pdf-ui-switcher { gap: var(--space-1); flex-direction: column; padding: var(--space-1) var(--space-2); }
}
</style>
