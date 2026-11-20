<script setup lang="ts">
/** PROTOTYPE — « Ajouter / Modifier la figure »: niveau, population, variables, état. */
import { computed, nextTick, ref, watch } from 'vue'

import CahierActionButton from '@/fiche/prototype/CahierActionButton.vue'
import CahierDialog from '@/fiche/prototype/CahierDialog.vue'

import { LEVELS, type ResourceDef } from './prototypeCellules'
import {
  buildSpec,
  channelIssues,
  cloneState,
  generatedTitle,
  newFigureState,
  type FigureState,
} from './prototypeFigure'
import type { Territoires } from './prototypeTerritoires'
import PopulationFilters from './PopulationFilters.vue'
import VariablesEditor from './VariablesEditor.vue'

export interface PageEntry {
  id: number
  json: unknown
}

const props = defineProps<{
  open: boolean
  catalogue: ResourceDef[]
  territoires: Territoires | null
  /** The figure being edited (reopened pre-filled); null when adding. */
  initial: FigureState | null
  /** Page context for the état annex. */
  pageTitle: string
  entries: PageEntry[]
  editingId: number | null
  insertAt: number
  /** The reader's own title for the figure being edited, if any. */
  customTitle: string | null
}>()
const emit = defineEmits<{ close: []; save: [state: FigureState] }>()

const scroller = ref<HTMLElement | null>(null)
const annex = ref<HTMLDetailsElement | null>(null)
const state = ref<FigureState>(newFigureState())
watch(
  () => props.open,
  (open) => {
    if (!open) return
    state.value = props.initial ? cloneState(props.initial) : newFigureState()
    nextTick(() => {
      if (scroller.value) scroller.value.scrollTop = 0
      annex.value?.removeAttribute('open')
    })
  },
)

const lookup = (id: string) => props.catalogue.find((r) => r.id === id)
const issues = computed(() => channelIssues(state.value, lookup))
const spec = computed(() => buildSpec(state.value, lookup))
const specJson = computed(() => {
  const live = { figure: { titre: props.customTitle ?? generatedTitle(state.value, lookup), ...spec.value } }
  const blocs = props.entries.map((e) => (e.id === props.editingId ? live : e.json))
  if (props.editingId === null) blocs.splice(Math.min(props.insertAt, blocs.length), 0, live)
  return JSON.stringify({ page: { titre: props.pageTitle, blocs }, figure: spec.value }, null, 2)
})

function save() {
  if (!issues.value.length) emit('save', cloneState(state.value))
}
</script>

<template>
  <CahierDialog :open="open" :title="editingId === null ? 'Ajouter une figure' : 'Modifier la figure'" labelled-by="atelier-modal-title" class="atelier-dialog" @close="emit('close')">
    <div class="at-modal">
      <div ref="scroller" class="at-modal__scroll">
        <section class="at-section" aria-labelledby="at-s-niveau">
          <h3 id="at-s-niveau" class="at-section__title">Niveau</h3>
          <fieldset class="at-levels">
            <legend>Niveau territorial</legend>
            <label v-for="level in LEVELS" :key="level.id" class="at-choice">
              <input v-model="state.level" type="radio" name="atelier-niveau" :value="level.id" />
              <span>{{ level.label }}</span>
            </label>
          </fieldset>
        </section>

        <section class="at-section" aria-labelledby="at-s-pop">
          <h3 id="at-s-pop" class="at-section__title">Population</h3>
          <PopulationFilters :population="state.population" :territoires="territoires" />
        </section>

        <section class="at-section" aria-labelledby="at-s-vars">
          <h3 id="at-s-vars" class="at-section__title">Variables</h3>
          <VariablesEditor :state="state" :catalogue="catalogue" />
        </section>

        <details ref="annex" class="at-etat">
          <summary>État (prototype)</summary>
          <pre aria-label="État de la page et de la figure, JSON">{{ specJson }}</pre>
        </details>
      </div>

      <footer class="at-modal__foot">
        <p class="at-modal__issues" aria-live="polite">
          <template v-if="issues.length">À compléter — {{ issues.join(' · ') }}</template>
        </p>
        <CahierActionButton @click="emit('close')">Annuler</CahierActionButton>
        <CahierActionButton class="at-primary" :disabled="issues.length > 0" @click="save">{{ editingId === null ? 'Créer la figure' : 'Enregistrer' }}</CahierActionButton>
      </footer>
    </div>
  </CahierDialog>
</template>
