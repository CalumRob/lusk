<script setup lang="ts">
/** PROTOTYPE — the « Ajouter une figure » modal: niveau, population, cellules (the variant), canaux, état. */
import { computed, shallowRef, watch } from 'vue'

import CahierActionButton from '@/fiche/prototype/CahierActionButton.vue'
import CahierDialog from '@/fiche/prototype/CahierDialog.vue'

import CanauxEditor from './CanauxEditor.vue'
import { LEVELS, type ResourceDef } from './prototypeCellules'
import { createDraft, POPULATION_STUBS, type Draft } from './prototypeFigure'
import PrototypeSwitcher from './PrototypeSwitcher.vue'
import VarianteCascade from './VarianteCascade.vue'
import VariantePhrase from './VariantePhrase.vue'
import VarianteRecherche from './VarianteRecherche.vue'

export type FigureSpec = Draft['spec']['value']

const props = defineProps<{ open: boolean; variant: 'A' | 'B' | 'C'; catalogue: ResourceDef[] }>()
const emit = defineEmits<{ close: []; create: [spec: FigureSpec] }>()

const draft = shallowRef<Draft>(createDraft(() => props.catalogue))
watch(
  () => props.open,
  (open) => {
    if (open) draft.value = createDraft(() => props.catalogue)
  },
)

const variantComponent = computed(() => ({ A: VarianteCascade, B: VarianteRecherche, C: VariantePhrase })[props.variant])
const specJson = computed(() => JSON.stringify(draft.value.spec.value, null, 2))
const issues = computed(() => draft.value.channelIssues.value)

function create() {
  if (!draft.value.canCreate.value) return
  emit('create', JSON.parse(JSON.stringify(draft.value.spec.value)))
}
</script>

<template>
  <CahierDialog :open="open" title="Ajouter une figure" labelled-by="atelier-modal-title" class="atelier-dialog" @close="emit('close')">
    <div class="at-modal">
      <div class="at-modal__scroll">
        <section class="at-section" aria-labelledby="at-s-niveau">
          <div class="at-section__head">
            <h3 id="at-s-niveau" class="at-section__title">Niveau</h3>
            <p class="at-section__note">Un point par territoire de ce niveau.</p>
          </div>
          <fieldset class="at-levels">
            <legend class="at-label">Niveau territorial</legend>
            <label v-for="level in LEVELS" :key="level.id" class="at-choice">
              <input v-model="draft.level.value" type="radio" name="atelier-niveau" :value="level.id" />
              <span>{{ level.label }}</span>
            </label>
          </fieldset>
        </section>

        <section class="at-section" aria-labelledby="at-s-pop">
          <div class="at-section__head">
            <h3 id="at-s-pop" class="at-section__title">Population</h3>
            <p class="at-section__note">Filtre de population — restreint les territoires tracés. Non évalué dans ce prototype.</p>
          </div>
          <div class="at-chips" role="group" aria-label="Filtre de population">
            <button
              v-for="stub in POPULATION_STUBS"
              :key="stub.id"
              type="button"
              class="at-chip"
              :aria-pressed="draft.population[stub.id]"
              @click="draft.population[stub.id] = !draft.population[stub.id]"
            >
              <span class="at-chip__glyph" aria-hidden="true">{{ draft.population[stub.id] ? '✓' : '+' }}</span>{{ stub.label }}
            </button>
          </div>
        </section>

        <section class="at-section" aria-labelledby="at-s-cellules">
          <div class="at-section__head">
            <h3 id="at-s-cellules" class="at-section__title">Cellules</h3>
            <p class="at-section__note">Une cellule : un nombre publié par territoire, à toutes ses coordonnées.</p>
          </div>
          <component :is="variantComponent" :draft="draft" :catalogue="catalogue" />
          <div>
            <CahierActionButton v-if="draft.cells.value.length < 8" @click="draft.addCell()">+ Ajouter une cellule</CahierActionButton>
          </div>
        </section>

        <section class="at-section" aria-labelledby="at-s-canaux">
          <div class="at-section__head">
            <h3 id="at-s-canaux" class="at-section__title">Canaux</h3>
            <p class="at-section__note">Chaque canal lit une cellule, ou une formule sur les cellules.</p>
          </div>
          <CanauxEditor :draft="draft" />
        </section>

        <details class="at-etat">
          <summary>État (prototype)</summary>
          <pre aria-label="Spécification de la figure, JSON">{{ specJson }}</pre>
        </details>
      </div>

      <footer class="at-modal__foot">
        <p class="at-modal__issues" aria-live="polite">
          <template v-if="issues.length">À compléter — {{ issues.join(' · ') }}.</template>
          <template v-else>La figure est prête.</template>
        </p>
        <CahierActionButton @click="emit('close')">Annuler</CahierActionButton>
        <CahierActionButton class="at-primary" :disabled="!draft.canCreate.value" @click="create">Créer la figure</CahierActionButton>
      </footer>
      <PrototypeSwitcher v-if="open" lift />
    </div>
  </CahierDialog>
</template>
