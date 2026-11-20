<script setup lang="ts">
/** PROTOTYPE — a reader-authored prose block: Markdown subset rendered as VNodes to read, a plain textarea to write. */
import { nextTick, ref } from 'vue'
import { Check, ChevronDown, ChevronUp, CircleHelp, Pencil, Trash2, X } from 'lucide-vue-next'

import BlockHandle from './BlockHandle.vue'
import IconButton from './IconButton.vue'
import { MarkdownProse } from './markdown'

const props = defineProps<{ id: number; text: string; startEditing?: boolean; uid: string; position: number; total: number }>()
const emit = defineEmits<{ save: [text: string]; remove: []; move: [delta: -1 | 1]; dragstart: [event: DragEvent]; dragend: [] }>()

const HINT = 'Markdown : ## titre, ### sous-titre, **gras**, *italique*, - puces, 1. numéros. Pas de liens.'

const editing = ref(props.startEditing ?? false)
const draft = ref(props.text)
const area = ref<HTMLTextAreaElement | null>(null)

async function edit() {
  draft.value = props.text
  editing.value = true
  await nextTick()
  area.value?.focus()
}
if (editing.value) nextTick(() => area.value?.focus())

function save() {
  editing.value = false
  const text = draft.value.trim()
  if (!text) emit('remove')
  else emit('save', text)
}
function cancel() {
  editing.value = false
  if (!props.text.trim()) emit('remove')
}
</script>

<template>
  <div class="at-block prose-block" :data-block="id">
    <template v-if="editing">
      <div class="prose-block__label">
        <label class="at-label" :for="`${uid}-t`">Texte</label>
        <span class="prose-block__hint" role="img" tabindex="0" :aria-label="HINT" :title="HINT"><CircleHelp :size="14" aria-hidden="true" /></span>
      </div>
      <textarea :id="`${uid}-t`" ref="area" v-model="draft" class="prose-block__area" rows="6" spellcheck="true" @keydown.esc.prevent.stop="cancel" />
      <div class="at-block__actions at-block__actions--on">
        <IconButton :icon="Check" label="Enregistrer le texte" @click="save" />
        <IconButton :icon="X" label="Annuler" @click="cancel" />
      </div>
    </template>
    <template v-else>
      <MarkdownProse :source="text" />
      <div class="at-block__actions">
        <BlockHandle :id="id" :position="position" :total="total" @move="emit('move', $event)" @dragstart="emit('dragstart', $event)" @dragend="emit('dragend')" />
        <IconButton class="at-touch-only" :icon="ChevronUp" label="Monter le bloc" :disabled="position === 1" @click="emit('move', -1)" />
        <IconButton class="at-touch-only" :icon="ChevronDown" label="Descendre le bloc" :disabled="position === total" @click="emit('move', 1)" />
        <IconButton :icon="Pencil" label="Modifier le texte" @click="edit" />
        <IconButton :icon="Trash2" label="Retirer le texte" @click="emit('remove')" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.prose-block__label { display: flex; align-items: center; gap: var(--space-2); }
.prose-block__hint { display: inline-grid; color: var(--muted); cursor: help; }
.prose-block__hint:hover, .prose-block__hint:focus-visible { color: var(--red); outline-offset: 2px; }
.prose-block__area {
  box-sizing: border-box;
  width: 100%;
  padding: var(--space-3);
  border: 1px solid color-mix(in srgb, var(--ink) 35%, transparent);
  border-radius: 0;
  background: transparent;
  color: var(--ink);
  font: 400 15px/1.45 var(--font-body);
  resize: vertical;
}
.prose-block__area:focus-visible { outline: 2px solid var(--red); outline-offset: 2px; }
</style>
