<script setup lang="ts">
/** PROTOTYPE — the Recherche picker: type what you mean, pick a fully addressed cell, then swap coordinate tokens. */
import { computed, nextTick, ref } from 'vue'

import { axisOptions, cellUnit, coordinateSummary, searchCellules, type Candidate, type ResourceDef } from './prototypeCellules'
import type { CellRef } from './prototypeFigure'

const props = defineProps<{
  modelValue: CellRef | null
  catalogue: ResourceDef[]
  /** Unique within the page: ids of the search input and its list. */
  uid: string
  label?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: CellRef | null] }>()

const query = ref('')
const EXAMPLES = ['médecin vélo 15', '65-79 femmes', 'passoires', 'prix 2022']

const resource = computed(() => props.catalogue.find((r) => r.id === props.modelValue?.resourceId) ?? null)
const results = computed(() => searchCellules(props.catalogue, query.value))

function pick(candidate: Candidate) {
  emit('update:modelValue', { resourceId: candidate.resource.id, coordinates: { ...candidate.coordinates } })
}
function clear() {
  emit('update:modelValue', null)
  nextTick(() => document.getElementById(`${props.uid}-q`)?.focus())
}
function setCoordinate(axisKey: string, value: string) {
  if (!props.modelValue || !resource.value) return
  const next = { ...props.modelValue.coordinates, [axisKey]: value }
  // Snap undeclared combinations: keep the touched axis, repair the others.
  let repaired = next
  const r = resource.value
  if (r.isValid && !r.isValid(next)) {
    for (const axis of r.axes) {
      if (axis.key === axisKey || r.isValid(repaired)) continue
      const options = axisOptions(r, axis.key, repaired)
      if (options.length && !options.some((o) => o.value === repaired[axis.key])) repaired = { ...repaired, [axis.key]: options[0]!.value }
    }
  }
  emit('update:modelValue', { resourceId: props.modelValue.resourceId, coordinates: repaired })
}

function move(event: KeyboardEvent) {
  const items = [...(document.getElementById(`${props.uid}-list`)?.querySelectorAll<HTMLElement>('button.hit') ?? [])]
  if (!items.length || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return
  event.preventDefault()
  const index = items.indexOf(document.activeElement as HTMLElement)
  if (event.key === 'ArrowDown') items[(index + 1) % items.length]!.focus()
  else if (index <= 0) document.getElementById(`${props.uid}-q`)?.focus()
  else items[index - 1]!.focus()
}
</script>

<template>
  <div class="picker">
    <!-- addressed: the cell as a fiche of editable tokens -->
    <template v-if="resource && modelValue">
      <div class="fiche">
        <h4 class="fiche__title">{{ resource.label }}</h4>
        <p class="fiche__meta">
          {{ resource.themeLabel }}<template v-if="resource.group"> · {{ resource.group }}</template> ·
          <span class="at-unit">{{ cellUnit(resource, modelValue.coordinates) || 'sans unité' }}</span>
        </p>
      </div>
      <ul v-if="resource.axes.length" class="tokens" aria-label="Coordonnées">
        <li v-for="axis in resource.axes" :key="axis.key" class="token">
          <label :for="`${uid}-${axis.key}`" class="at-label">{{ axis.label }}</label>
          <select
            :id="`${uid}-${axis.key}`"
            class="token__select"
            :value="modelValue.coordinates[axis.key]"
            @change="setCoordinate(axis.key, ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="o in axisOptions(resource, axis.key, modelValue.coordinates)" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </li>
      </ul>
      <button type="button" class="at-text-button picker__swap" @click="clear">Autre cellule</button>
    </template>

    <!-- not yet addressed: a ruled search line and ranked candidates -->
    <template v-else>
      <div class="search">
        <label class="at-label" :for="`${uid}-q`">{{ label ?? 'Chercher une cellule' }}</label>
        <input
          :id="`${uid}-q`"
          v-model="query"
          class="at-input search__input"
          type="search"
          autocomplete="off"
          placeholder="médecin vélo 15 · 65-79 femmes · passoires"
          :aria-controls="`${uid}-list`"
          @keydown="move"
        />
      </div>
      <ol v-if="results.length" :id="`${uid}-list`" class="hits" aria-label="Cellules proposées">
        <li v-for="(hit, index) in results" :key="hit.key">
          <button type="button" class="hit" @click="pick(hit)" @keydown="move">
            <span class="hit__rank">{{ String(index + 1).padStart(2, '0') }}</span>
            <span class="hit__main">
              <span class="hit__label">{{ hit.resource.label }}</span>
              <span v-if="hit.resource.axes.length" class="hit__address">{{ coordinateSummary(hit.resource, hit.coordinates).join(' · ') }}</span>
            </span>
            <span class="hit__side">{{ hit.resource.themeLabel }}<br /><span class="at-unit">{{ cellUnit(hit.resource, hit.coordinates) || '—' }}</span></span>
          </button>
        </li>
      </ol>
      <p v-else-if="query.trim()" class="search__hint">Aucune cellule pour « {{ query }} ».</p>
      <p v-else class="search__hint">
        <template v-for="(example, i) in EXAMPLES" :key="example">
          <button type="button" class="at-text-button" @click="query = example">{{ example }}</button><template v-if="i < EXAMPLES.length - 1"> · </template>
        </template>
      </p>
    </template>
  </div>
</template>

<style scoped>
.picker { display: grid; gap: var(--space-3); min-width: 0; }
.search { display: grid; gap: 2px; }
.search__input { font-size: 1.0625rem; min-height: 38px; }
.search__hint { margin: 0; color: var(--muted); font: var(--type-figure-legend); line-height: 1.8; }

.hits { display: grid; margin: 0; padding: 0; list-style: none; border-top: 1px solid var(--at-rule-soft); }
.hits li + li { border-top: 1px solid var(--at-rule-soft); }
.hit {
  display: grid;
  grid-template-columns: 2rem minmax(0, 1fr) auto;
  gap: var(--space-3);
  align-items: baseline;
  width: 100%;
  padding: var(--space-2) var(--space-2) var(--space-2) 0;
  border: 0;
  border-left: 2px solid transparent;
  border-radius: 0;
  background: transparent;
  color: var(--ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.hit:hover, .hit:focus-visible { background: color-mix(in srgb, var(--ink) 6%, transparent); border-left-color: var(--red); outline: none; padding-left: var(--space-2); }
.hit__rank { color: var(--red); font: var(--type-figure-value); font-size: 0.75rem; }
.hit__main { display: grid; gap: 2px; min-width: 0; }
.hit__label { font: 600 0.9375rem/1.3 var(--font-body); }
.hit__address { color: var(--cahier-default); font: 400 0.875rem/1.4 var(--font-body); overflow-wrap: anywhere; }
.hit__side { color: var(--muted); font: var(--text-caption); text-align: right; }

.fiche__title { margin: 0; color: var(--ink); font: var(--text-h3); letter-spacing: var(--text-h3-tracking); }
.fiche__meta { margin: 2px 0 0; color: var(--muted); font: var(--type-figure-legend); }
.picker__swap { justify-self: start; }

.tokens { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
.token { display: grid; min-width: 8.5rem; max-width: 100%; padding: 6px var(--space-3) 4px; border: 1px solid color-mix(in srgb, var(--ink) 30%, transparent); }
.token:hover, .token:focus-within { border-color: var(--red); }
.token__select {
  box-sizing: border-box;
  width: 100%;
  max-width: 22rem;
  min-height: 28px;
  padding: 2px 18px 2px 0;
  border: 0;
  background-color: transparent;
  color: var(--ink);
  font: 600 0.875rem/1.3 var(--font-body-emphasis);
  appearance: none;
  cursor: pointer;
  text-overflow: ellipsis;
  background-image: linear-gradient(45deg, transparent 50%, var(--ink) 50%), linear-gradient(-45deg, transparent 50%, var(--ink) 50%);
  background-position: right 7px center, right 2px center;
  background-size: 5px 5px;
  background-repeat: no-repeat;
}
.token__select:focus-visible { outline: 2px solid var(--red); outline-offset: 2px; }
@media (max-width: 520px) { .hit { grid-template-columns: 1.6rem minmax(0, 1fr); } .hit__side { display: none; } .token { flex: 1 1 100%; } }
</style>
