<script setup lang="ts">
/** PROTOTYPE — click-to-edit inline text. Enter or blur commits, Escape cancels. Optional reset-to-default icon. */
import { nextTick, ref } from 'vue'
import { Pencil, RotateCcw } from 'lucide-vue-next'

import AppIcon from '@/components/AppIcon.vue'

const props = defineProps<{ modelValue: string; tag: 'h1' | 'h3' | 'span'; label: string; resettable?: boolean }>()
const emit = defineEmits<{ commit: [value: string]; reset: [] }>()

const editing = ref(false)
const draft = ref('')
const input = ref<HTMLInputElement | null>(null)
let cancelled = false

async function start() {
  draft.value = props.modelValue
  cancelled = false
  editing.value = true
  await nextTick()
  input.value?.focus()
  input.value?.select()
}
function finish() {
  if (!editing.value) return
  editing.value = false
  if (!cancelled) emit('commit', draft.value.trim())
}
function cancel() {
  cancelled = true
  editing.value = false
}
</script>

<template>
  <component :is="tag" class="editable">
    <input
      v-if="editing"
      ref="input"
      v-model="draft"
      class="editable__input"
      type="text"
      :aria-label="label"
      @keydown.enter.prevent="finish"
      @keydown.esc.prevent.stop="cancel"
      @blur="finish"
    />
    <template v-else>
      <button type="button" class="editable__button" :aria-label="`${label} : ${modelValue}. Modifier`" :title="`${label} — modifier`" @click="start">
        <span>{{ modelValue }}</span><AppIcon class="editable__icon" :icone="Pencil" :taille="13" aria-hidden="true" />
      </button>
      <button v-if="resettable" type="button" class="editable__reset" :aria-label="`${label} : rétablir le titre par défaut`" :title="`Rétablir le titre par défaut`" @click="emit('reset')">
        <AppIcon :icone="RotateCcw" :taille="13" aria-hidden="true" />
      </button>
    </template>
  </component>
</template>

<style scoped>
/* the root takes its font from the class the page gives it (title, figure heading, axis) */
.editable { display: block; min-width: 0; margin: 0; }
.editable__button {
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
.editable__button:hover span { text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 0.18em; text-decoration-color: var(--red); }
.editable__button:focus-visible, .editable__reset:focus-visible { outline: 2px solid var(--red); outline-offset: 3px; }
.editable__icon { margin-left: 0.4em; vertical-align: 0.05em; color: var(--red); opacity: 0; }
.editable:hover .editable__icon, .editable:focus-within .editable__icon { opacity: 0.85; }
@media (hover: none) { .editable__icon { opacity: 0.4; } }
.editable__reset { display: inline-grid; place-items: center; margin-left: 0.3em; padding: 2px; border: 0; background: transparent; color: var(--muted); vertical-align: 0.05em; cursor: pointer; }
.editable__reset:hover { color: var(--red); }
.editable__input {
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
.editable__input:focus-visible { outline: none; }
</style>
