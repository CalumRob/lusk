<script setup lang="ts">
/** PROTOTYPE — click-to-edit inline text. Enter or blur commits, Escape cancels. */
import { nextTick, ref } from 'vue'
import { Pencil } from 'lucide-vue-next'

const props = defineProps<{ modelValue: string; tag: 'h1' | 'h3'; label: string }>()
const emit = defineEmits<{ commit: [value: string] }>()

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
    <button v-else type="button" class="editable__button" :aria-label="`${label} : ${modelValue}`" @click="start">
      <span>{{ modelValue }}</span><Pencil class="editable__icon" :size="13" aria-hidden="true" />
    </button>
  </component>
</template>

<style scoped>
/* the root takes its font from the class the page gives it (title, figure heading) */
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
  cursor: text;
}
.editable__button:hover span { text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 0.18em; text-decoration-color: var(--red); }
.editable__button:focus-visible { outline: 2px solid var(--red); outline-offset: 3px; }
.editable__icon { margin-left: 0.4em; vertical-align: 0.05em; color: var(--muted); opacity: 0.55; }
.editable__button:hover .editable__icon, .editable__button:focus-visible .editable__icon { color: var(--red); opacity: 1; }
.editable__input {
  box-sizing: border-box;
  width: 100%;
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
