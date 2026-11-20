<script setup lang="ts">
/** PROTOTYPE — a reader-authored prose block: production CahierProse to read, a textarea to write. Plain text, blank line = new paragraph. */
import { computed, nextTick, ref } from 'vue'

import type { TextBlock } from '@/fiche/content/themeContent'
import CahierProse from '@/fiche/prototype/CahierProse.vue'

const props = defineProps<{ text: string; startEditing?: boolean; uid: string }>()
const emit = defineEmits<{ save: [text: string]; remove: [] }>()

const editing = ref(props.startEditing ?? false)
const draft = ref(props.text)
const area = ref<HTMLTextAreaElement | null>(null)

const blocks = computed<TextBlock[]>(() =>
  props.text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => [{ kind: 'text' as const, value: p }]),
)

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
  <div class="prose-block">
    <template v-if="editing">
      <label class="at-label" :for="`${uid}-t`">Texte</label>
      <textarea
        :id="`${uid}-t`"
        ref="area"
        v-model="draft"
        class="prose-block__area"
        rows="5"
        @keydown.esc.prevent.stop="cancel"
      />
      <div class="prose-block__actions">
        <button type="button" class="at-action" @click="save">Enregistrer</button>
        <button type="button" class="at-action at-action--quiet" @click="cancel">Annuler</button>
      </div>
    </template>
    <template v-else>
      <CahierProse class="page-subtitle" :blocks="blocks" />
      <div class="prose-block__actions">
        <button type="button" class="at-action at-action--quiet" @click="edit">Modifier</button>
        <button type="button" class="at-action at-action--quiet" @click="emit('remove')">Retirer</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.prose-block { display: grid; gap: 2px; }
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
.prose-block__actions { display: flex; justify-content: flex-end; gap: var(--space-1); }
</style>
