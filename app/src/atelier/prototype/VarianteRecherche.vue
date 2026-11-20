<script setup lang="ts">
/** PROTOTYPE — variant B, « Recherche »: type what you mean, pick a fully-addressed candidate, then swap tokens. */
import { computed, nextTick, reactive } from 'vue'

import {
  axisOptions,
  cellUnit,
  coordinateSummary,
  searchCellules,
  type Candidate,
  type ResourceDef,
} from './prototypeCellules'
import type { Draft } from './prototypeFigure'

const props = defineProps<{ draft: Draft; catalogue: ResourceDef[] }>()

const queries = reactive<Record<string, string>>({})
const EXAMPLES = ['médecin vélo 15', '65-79 femmes', 'passoires', 'prix 2022', 'densité']

const results = (letter: string) => searchCellules(props.catalogue, queries[letter] ?? '')

function pick(letter: string, candidate: Candidate) {
  props.draft.address(letter, candidate.resource.id, candidate.coordinates)
}

function clear(letter: string) {
  props.draft.setResource(letter, null)
  nextTick(() => document.getElementById(`b-q-${letter}`)?.focus())
}

const fieldOptions = (letter: string, axisKey: string) => {
  const cell = props.draft.cellByLetter(letter)!
  return axisOptions(props.draft.resourceOf(cell.resourceId)!, axisKey, cell.coordinates)
}

const hasQuery = computed(() => (letter: string) => (queries[letter] ?? '').trim().length > 0)

function move(event: KeyboardEvent, letter: string) {
  const list = document.getElementById(`b-list-${letter}`)
  if (!list) return
  const items = [...list.querySelectorAll<HTMLElement>('button.hit')]
  if (!items.length) return
  const index = items.indexOf(document.activeElement as HTMLElement)
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    items[(index + 1) % items.length]!.focus()
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    if (index <= 0) document.getElementById(`b-q-${letter}`)?.focus()
    else items[index - 1]!.focus()
  }
}
</script>

<template>
  <div class="recherche">
    <article v-for="cell in draft.cells.value" :key="cell.letter" class="at-cell" :aria-label="`Cellule ${cell.letter}`">
      <span class="at-cell__letter" aria-hidden="true">{{ cell.letter }}</span>

      <!-- addressed: the Cellule as a fiche of editable tokens -->
      <div v-if="draft.resourceOf(cell.resourceId)" class="at-cell__body">
        <div class="fiche">
          <h4 class="fiche__title">{{ draft.resourceOf(cell.resourceId)!.label }}</h4>
          <p class="fiche__meta">
            {{ draft.resourceOf(cell.resourceId)!.themeLabel }}<template v-if="draft.resourceOf(cell.resourceId)!.group"> · {{ draft.resourceOf(cell.resourceId)!.group }}</template>
            · <span class="at-unit">{{ cellUnit(draft.resourceOf(cell.resourceId)!, cell.coordinates) || 'sans unité' }}</span>
          </p>
        </div>
        <ul v-if="draft.resourceOf(cell.resourceId)!.axes.length" class="tokens" aria-label="Coordonnées">
          <li v-for="axis in draft.resourceOf(cell.resourceId)!.axes" :key="axis.key" class="token">
            <label :for="`b-${cell.letter}-${axis.key}`" class="at-label">{{ axis.label }}</label>
            <select
              :id="`b-${cell.letter}-${axis.key}`"
              class="token__select"
              :value="cell.coordinates[axis.key]"
              @change="draft.setCoordinate(cell.letter, axis.key, ($event.target as HTMLSelectElement).value)"
            >
              <option v-for="o in fieldOptions(cell.letter, axis.key)" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </li>
        </ul>
        <p v-else class="at-reading">Aucune coordonnée à préciser : un seul nombre par territoire.</p>
        <div class="at-cell__foot">
          <button type="button" class="at-text-button" @click="clear(cell.letter)">Chercher une autre cellule</button>
          <button v-if="draft.cells.value.length > 1" type="button" class="at-text-button" @click="draft.removeCell(cell.letter)">Retirer {{ cell.letter }}</button>
        </div>
      </div>

      <!-- not yet addressed: a ruled search line and ranked, fully addressed candidates -->
      <div v-else class="at-cell__body">
        <div class="search">
          <label class="at-label" :for="`b-q-${cell.letter}`">Chercher une cellule</label>
          <input
            :id="`b-q-${cell.letter}`"
            v-model="queries[cell.letter]"
            class="at-input search__input"
            type="search"
            autocomplete="off"
            placeholder="médecin vélo 15 · 65-79 femmes · passoires"
            :aria-controls="`b-list-${cell.letter}`"
            @keydown="move($event, cell.letter)"
          />
        </div>
        <ol v-if="results(cell.letter).length" :id="`b-list-${cell.letter}`" class="hits" :aria-label="`Cellules proposées pour ${cell.letter}`">
          <li v-for="(hit, index) in results(cell.letter)" :key="hit.key">
            <button type="button" class="hit" @click="pick(cell.letter, hit)" @keydown="move($event, cell.letter)">
              <span class="hit__rank">{{ String(index + 1).padStart(2, '0') }}</span>
              <span class="hit__main">
                <span class="hit__label">{{ hit.resource.label }}</span>
                <span v-if="hit.resource.axes.length" class="hit__address">{{ coordinateSummary(hit.resource, hit.coordinates).join(' · ') }}</span>
              </span>
              <span class="hit__side">{{ hit.resource.themeLabel }}<br /><span class="at-unit">{{ cellUnit(hit.resource, hit.coordinates) || '—' }}</span></span>
            </button>
          </li>
        </ol>
        <p v-else-if="hasQuery(cell.letter)" class="at-reading">Aucune cellule ne répond à « {{ queries[cell.letter] }} ».</p>
        <p v-else class="search__hint">
          Essayez :
          <template v-for="(example, i) in EXAMPLES" :key="example">
            <button type="button" class="at-text-button" @click="queries[cell.letter] = example">{{ example }}</button><template v-if="i < EXAMPLES.length - 1"> · </template>
          </template>
        </p>
        <div v-if="draft.cells.value.length > 1" class="at-cell__foot">
          <button type="button" class="at-text-button" @click="draft.removeCell(cell.letter)">Retirer {{ cell.letter }}</button>
        </div>
      </div>
    </article>
  </div>
</template>

<style scoped>
.search { display: grid; gap: 2px; }
.search__input { font-size: 1.125rem; min-height: 40px; border-bottom-width: 2px; }
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
.hit__label { font: 600 1rem/1.3 var(--font-body); }
.hit__address { color: var(--cahier-default); font: 400 0.875rem/1.4 var(--font-body); overflow-wrap: anywhere; }
.hit__side { color: var(--muted); font: var(--text-caption); text-align: right; }

.fiche__title { margin: 0; font: var(--text-h3); letter-spacing: var(--text-h3-tracking); color: var(--ink); }
.fiche__meta { margin: 2px 0 0; color: var(--muted); font: var(--type-figure-legend); }

/* a token: a labelled slot you can swap on its own — a thin frame, no fill */
.tokens { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
.token {
  display: grid;
  gap: 0;
  min-width: 8.5rem;
  max-width: 100%;
  padding: 6px var(--space-3) 4px;
  border: 1px solid color-mix(in srgb, var(--ink) 30%, transparent);
  background: transparent;
}
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
