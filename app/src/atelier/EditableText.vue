<script setup lang="ts">
/**
 * Titre éditable en ligne — porté du prototype `prototype/atelier-cell-picker`
 * (0657b2fe). Entrée ou perte de focus valide, Échap annule. La police vient
 * de la classe que donne la page (le type de titre de page de production).
 */
import { nextTick, ref } from 'vue'
import { Pencil } from 'lucide-vue-next'

import AppIcon from '@/components/AppIcon.vue'

const props = defineProps<{ modelValue: string; tag: 'h1' | 'h3' | 'span'; label: string }>()
const emit = defineEmits<{ commit: [value: string] }>()

const edition = ref(false)
const brouillon = ref('')
const champ = ref<HTMLInputElement | null>(null)
let annule = false

async function commencer(): Promise<void> {
  brouillon.value = props.modelValue
  annule = false
  edition.value = true
  await nextTick()
  champ.value?.focus()
  champ.value?.select()
}

function terminer(): void {
  if (!edition.value) return
  edition.value = false
  if (!annule) emit('commit', brouillon.value.trim())
}

function annuler(): void {
  annule = true
  edition.value = false
}
</script>

<template>
  <component :is="tag" class="atelier-editable">
    <input
      v-if="edition"
      ref="champ"
      v-model="brouillon"
      class="atelier-editable__input atelier-titre-champ"
      type="text"
      :aria-label="label"
      @keydown.enter.prevent="terminer"
      @keydown.esc.prevent.stop="annuler"
      @blur="terminer"
    />
    <button
      v-else
      type="button"
      class="atelier-editable__bouton atelier-titre-bouton"
      :aria-label="`${label} : ${modelValue}. Modifier`"
      :title="`${label} — modifier`"
      @click="commencer"
    >
      <span>{{ modelValue }}</span>
      <AppIcon class="atelier-editable__crayon" :icone="Pencil" :taille="13" aria-hidden="true" />
    </button>
  </component>
</template>

<style scoped>
.atelier-editable { display: block; min-width: 0; margin: 0; }
.atelier-editable__bouton {
  display: inline;
  max-width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  text-align: inherit;
  white-space: normal;
  cursor: text;
}
.atelier-editable__bouton:hover span { text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 0.18em; text-decoration-color: var(--red); }
.atelier-editable__bouton:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: 3px; }
.atelier-editable__crayon { margin-left: 0.4em; vertical-align: 0.05em; color: var(--red); opacity: 0; }
.atelier-editable:hover .atelier-editable__crayon,
.atelier-editable:focus-within .atelier-editable__crayon { opacity: 0.85; }
@media (hover: none) { .atelier-editable__crayon { opacity: 0.4; } }
.atelier-editable__input {
  box-sizing: border-box;
  width: 100%;
  min-width: 16rem;
  padding: 0;
  border: 0;
  border-bottom: 1px solid var(--red);
  border-radius: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  text-align: inherit;
}
.atelier-editable__input:focus-visible { outline: none; }
</style>
