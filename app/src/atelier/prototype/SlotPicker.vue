<script setup lang="ts">
/** PROTOTYPE — a blank in a sentence: a button that opens a small list. */
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'

export interface SlotOption {
  value: string
  label: string
  group?: string
  hint?: string
}

const props = withDefaults(
  defineProps<{
    /** Accessible name of the blank, e.g. « Équipement ». */
    name: string
    display: string
    options: SlotOption[]
    modelValue: string | null
    placeholder?: string
    /** Colour override for the slot ink (AEDAR mode inks). */
    ink?: string
    /** Default: filter when the list is long (Vue would otherwise cast an absent boolean to false). */
    filterable?: boolean
  }>(),
  { filterable: undefined, placeholder: undefined, ink: undefined },
)
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const open = ref(false)
const query = ref('')
const trigger = ref<HTMLButtonElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const filterInput = ref<HTMLInputElement | null>(null)
const position = ref({ top: 0, left: 0, maxHeight: 280 })
const uid = `slot-${Math.random().toString(36).slice(2, 8)}`

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr-FR')
const showFilter = computed(() => props.filterable ?? props.options.length > 9)
const visible = computed(() => {
  const q = fold(query.value.trim())
  return q ? props.options.filter((o) => fold(`${o.label} ${o.group ?? ''} ${o.value}`).includes(q)) : props.options
})
const grouped = computed(() => {
  const groups: { name: string; items: SlotOption[] }[] = []
  for (const option of visible.value) {
    const name = option.group ?? ''
    let group = groups.find((g) => g.name === name)
    if (!group) groups.push((group = { name, items: [] }))
    group.items.push(option)
  }
  return groups
})

function place() {
  const rect = trigger.value?.getBoundingClientRect()
  if (!rect) return
  const width = Math.min(340, window.innerWidth - 16)
  const below = window.innerHeight - rect.bottom - 12
  const above = rect.top - 12
  const useAbove = below < 200 && above > below
  const maxHeight = Math.max(160, Math.min(320, useAbove ? above : below))
  position.value = {
    left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
    top: useAbove ? Math.max(8, rect.top - Math.min(maxHeight, 320) - 4) : rect.bottom + 4,
    maxHeight,
  }
}

async function openPanel() {
  query.value = ''
  place()
  open.value = true
  document.addEventListener('pointerdown', onOutside, true)
  document.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', place)
  await nextTick()
  if (showFilter.value) filterInput.value?.focus()
  else (panel.value?.querySelector<HTMLElement>('[aria-selected="true"]') ?? panel.value?.querySelector<HTMLElement>('[role=option]'))?.focus()
}

function close() {
  if (!open.value) return
  open.value = false
  document.removeEventListener('pointerdown', onOutside, true)
  document.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', place)
}
/** Follow the trigger when the modal body scrolls; scrolling the list itself must not move the panel. */
function onScroll(event: Event) {
  if (panel.value?.contains(event.target as Node)) return
  place()
}
function closeAndReturn() {
  close()
  trigger.value?.focus()
}
function onOutside(event: Event) {
  const target = event.target as Node
  if (panel.value?.contains(target) || trigger.value?.contains(target)) return
  close()
}
onBeforeUnmount(close)

function choose(value: string) {
  emit('update:modelValue', value)
  closeAndReturn()
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation()
    event.preventDefault()
    closeAndReturn()
    return
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  event.preventDefault()
  const items = [...(panel.value?.querySelectorAll<HTMLElement>('[role=option]') ?? [])]
  if (!items.length) return
  const index = items.indexOf(document.activeElement as HTMLElement)
  const next = event.key === 'ArrowDown' ? (index + 1) % items.length : index <= 0 ? items.length - 1 : index - 1
  items[next]!.focus()
}
</script>

<template>
  <span class="slot">
    <button
      ref="trigger"
      type="button"
      class="slot__trigger"
      :class="{ 'slot__trigger--empty': !modelValue, 'slot__trigger--open': open }"
      :style="ink && modelValue ? { color: ink } : undefined"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-label="`${name} : ${display || placeholder || 'à choisir'}`"
      @click="open ? closeAndReturn() : openPanel()"
    >{{ display || placeholder || 'choisir' }}</button>
    <div
        v-if="open"
        ref="panel"
        class="slot__panel"
        :style="{ top: `${position.top}px`, left: `${position.left}px`, maxHeight: `${position.maxHeight}px` }"
        @keydown="onKey"
      >
        <label v-if="showFilter" class="slot__filter">
          <span class="at-label">{{ name }}</span>
          <input ref="filterInput" v-model="query" class="at-input" type="search" :placeholder="`Filtrer — ${options.length} choix`" :aria-controls="uid" autocomplete="off" />
        </label>
        <p v-else class="at-label slot__title">{{ name }}</p>
        <div :id="uid" class="slot__list" role="listbox" :aria-label="name">
          <template v-for="group in grouped" :key="group.name">
            <p v-if="group.name" class="slot__group">{{ group.name }}</p>
            <button
              v-for="option in group.items"
              :key="option.value"
              type="button"
              role="option"
              class="slot__option"
              :aria-selected="option.value === modelValue"
              @click="choose(option.value)"
            >
              <span>{{ option.label }}</span>
              <small v-if="option.hint">{{ option.hint }}</small>
            </button>
          </template>
          <p v-if="!visible.length" class="slot__none">Aucun choix ne correspond.</p>
        </div>
    </div>
  </span>
</template>

<style scoped>
.slot { display: inline; }
.slot__trigger {
  display: inline;
  margin: 0;
  padding: 0 2px;
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--ink) 55%, transparent);
  border-radius: 0;
  background: transparent;
  color: var(--ink);
  font: 600 0.9em/inherit var(--font-body-emphasis);
  letter-spacing: 0;
  cursor: pointer;
  text-align: left;
}
.slot__trigger:hover { border-bottom-color: var(--red); background: color-mix(in srgb, var(--red) 6%, transparent); }
.slot__trigger--open { border-bottom-color: var(--red); background: color-mix(in srgb, var(--red) 8%, transparent); }
.slot__trigger--empty { border-bottom-style: dashed; border-bottom-color: var(--red); color: var(--red); font-weight: 500; }
.slot__trigger:focus-visible { outline: 2px solid var(--red); outline-offset: 2px; }

.slot__panel {
  position: fixed;
  z-index: var(--z-popover, 1300);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: var(--space-2);
  box-sizing: border-box;
  width: min(340px, calc(100vw - 16px));
  padding: var(--space-3);
  border: 1px solid color-mix(in srgb, var(--ink) 30%, transparent);
  background: var(--paper, #f5f2eb);
  box-shadow: 0 12px 28px rgb(35 42 42 / 16%);
  color: var(--ink);
  font: 400 0.9375rem/1.35 var(--font-body);
  text-align: left;
}
.slot__filter { display: grid; gap: 2px; }
.slot__title { margin: 0; }
.slot__list { min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.slot__group {
  position: sticky;
  top: 0;
  margin: 0;
  padding: var(--space-2) 0 2px;
  background: var(--paper, #f5f2eb);
  border-bottom: 1px solid var(--at-rule-soft);
  color: var(--red);
  font: var(--text-overline);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.slot__option {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  width: 100%;
  min-height: 32px;
  padding: 4px var(--space-2);
  border: 0;
  border-left: 2px solid transparent;
  border-radius: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.slot__option small { flex: none; color: var(--muted); font: var(--text-caption); }
.slot__option:hover, .slot__option:focus-visible { background: color-mix(in srgb, var(--ink) 7%, transparent); outline: none; border-left-color: var(--ink); }
.slot__option[aria-selected='true'] { border-left-color: var(--red); font-weight: 700; }
.slot__none { margin: var(--space-2) 0 0; color: var(--muted); font: var(--type-figure-legend); }
</style>
