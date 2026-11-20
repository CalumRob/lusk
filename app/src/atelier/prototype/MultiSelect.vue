<script setup lang="ts">
/** PROTOTYPE — a dropdown with checkable values (multi-select), in the ruled-select style. */
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'

import type { Option } from './prototypeTerritoires'

const props = defineProps<{ label: string; options: Option[]; modelValue: string[]; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

const open = ref(false)
const query = ref('')
const trigger = ref<HTMLButtonElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const pos = ref({ top: 0, left: 0, maxHeight: 300 })
const uid = `ms-${Math.random().toString(36).slice(2, 8)}`

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr-FR')
const showFilter = computed(() => props.options.length > 8)
const visible = computed(() => {
  const q = fold(query.value.trim())
  return q ? props.options.filter((o) => fold(o.label).includes(q)) : props.options
})
const summary = computed(() => {
  const n = props.modelValue.length
  if (!n) return 'Tous'
  if (n === 1) return props.options.find((o) => o.value === props.modelValue[0])?.label ?? props.modelValue[0]!
  return `${n} sélectionnés`
})

function place() {
  const rect = trigger.value?.getBoundingClientRect()
  if (!rect) return
  const width = Math.min(320, window.innerWidth - 16)
  const below = window.innerHeight - rect.bottom - 12
  const above = rect.top - 12
  const useAbove = below < 220 && above > below
  const maxHeight = Math.max(160, Math.min(340, useAbove ? above : below))
  pos.value = { left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), top: useAbove ? Math.max(8, rect.top - maxHeight - 4) : rect.bottom + 4, maxHeight }
}
async function toggleOpen() {
  if (open.value) return closeAndReturn()
  query.value = ''
  place()
  open.value = true
  document.addEventListener('pointerdown', onOutside, true)
  document.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', place)
  await nextTick()
  ;(panel.value?.querySelector<HTMLElement>('input') ?? panel.value)?.focus()
}
function close() {
  if (!open.value) return
  open.value = false
  document.removeEventListener('pointerdown', onOutside, true)
  document.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', place)
}
function closeAndReturn() {
  close()
  trigger.value?.focus()
}
function onScroll(e: Event) {
  if (!panel.value?.contains(e.target as Node)) place()
}
function onOutside(e: Event) {
  const t = e.target as Node
  if (!panel.value?.contains(t) && !trigger.value?.contains(t)) close()
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    closeAndReturn()
  }
}
onBeforeUnmount(close)

function toggle(value: string) {
  emit('update:modelValue', props.modelValue.includes(value) ? props.modelValue.filter((v) => v !== value) : [...props.modelValue, value])
}
</script>

<template>
  <div class="ms">
    <span class="at-label" :id="`${uid}-l`">{{ label }}</span>
    <button
      ref="trigger"
      type="button"
      class="at-select ms__trigger"
      :disabled="disabled"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :aria-labelledby="`${uid}-l ${uid}-v`"
      @click="toggleOpen"
    >
      <span :id="`${uid}-v`" :class="{ 'ms__none': !modelValue.length }">{{ summary }}</span>
    </button>
    <div v-if="open" ref="panel" class="ms__panel" role="dialog" :aria-label="label" tabindex="-1" :style="{ top: `${pos.top}px`, left: `${pos.left}px`, maxHeight: `${pos.maxHeight}px` }" @keydown="onKey">
      <input v-if="showFilter" v-model="query" class="at-input" type="search" :placeholder="`Filtrer — ${options.length}`" autocomplete="off" :aria-label="`Filtrer ${label}`" />
      <div class="ms__list" role="group" :aria-label="label">
        <label v-for="o in visible" :key="o.value" class="ms__option">
          <input type="checkbox" :checked="modelValue.includes(o.value)" @change="toggle(o.value)" />
          <span>{{ o.label }}</span>
        </label>
        <p v-if="!visible.length" class="ms__empty">Aucun résultat</p>
      </div>
      <button v-if="modelValue.length" type="button" class="at-text-button ms__clear" @click="emit('update:modelValue', [])">Tout effacer</button>
    </div>
  </div>
</template>

<style scoped>
.ms { display: grid; align-content: end; min-width: 9rem; }
.ms__trigger { width: 100%; text-align: left; }
.ms__none { color: var(--muted); }
.ms__panel {
  position: fixed;
  z-index: var(--z-popover, 1300);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: var(--space-2);
  box-sizing: border-box;
  width: min(320px, calc(100vw - 16px));
  padding: var(--space-3);
  border: 1px solid color-mix(in srgb, var(--ink) 30%, transparent);
  background: var(--paper, #f5f2eb);
  box-shadow: 0 12px 28px rgb(35 42 42 / 16%);
  color: var(--ink);
  font: 400 0.9375rem/1.35 var(--font-body);
  outline: none;
}
.ms__list { min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.ms__option { display: flex; align-items: baseline; gap: var(--space-2); min-height: 32px; padding: 4px 0; cursor: pointer; }
.ms__option input { accent-color: var(--red); flex: none; margin: 0; align-self: center; }
.ms__option:hover { background: color-mix(in srgb, var(--ink) 6%, transparent); }
.ms__empty { margin: 0; color: var(--muted); font: var(--type-figure-legend); }
.ms__clear { justify-self: start; }
</style>
