<script setup lang="ts">
/** PROTOTYPE — the drag handle of a block: draggable with the mouse, ↑/↓ with the keyboard. */
import { GripVertical } from 'lucide-vue-next'

import AppIcon from '@/components/AppIcon.vue'

defineProps<{ id: number; position: number; total: number }>()
const emit = defineEmits<{ move: [delta: -1 | 1]; dragstart: [event: DragEvent]; dragend: [] }>()
</script>

<template>
  <button
    type="button"
    class="at-icon at-handle"
    draggable="true"
    :data-handle="id"
    :aria-label="`Déplacer le bloc, position ${position} sur ${total} : glisser, ou flèches haut et bas`"
    :title="`Déplacer (glisser, ou ↑ ↓) — ${position}/${total}`"
    @keydown.up.prevent="emit('move', -1)"
    @keydown.down.prevent="emit('move', 1)"
    @dragstart="emit('dragstart', $event)"
    @dragend="emit('dragend')"
  >
    <AppIcon :icone="GripVertical" :taille="16" aria-hidden="true" />
  </button>
</template>

<style>
.at-handle { cursor: grab; touch-action: none; }
.at-handle:active { cursor: grabbing; }
</style>
