<script setup lang="ts">
/** PROTOTYPE — variant A, « Cascade »: thème → indicateur → one control per declared coordinate. */
import { computed, reactive } from 'vue'

import { axisOptions, cellShortLabel, cellUnit, THEME_LABELS, type ResourceDef } from './prototypeCellules'
import type { Draft } from './prototypeFigure'

const props = defineProps<{ draft: Draft; catalogue: ResourceDef[] }>()

const themeChoice = reactive<Record<string, string>>({})
const themes = computed(() => {
  const seen: string[] = []
  for (const r of props.catalogue) if (!seen.includes(r.themeId)) seen.push(r.themeId)
  return seen.map((id) => ({ id, label: THEME_LABELS[id] ?? id }))
})

const themeOf = (letter: string) => themeChoice[letter] ?? props.draft.resourceOf(props.draft.cellByLetter(letter)?.resourceId ?? null)?.themeId ?? ''

function indicatorsFor(letter: string) {
  const theme = themeOf(letter)
  const list = props.catalogue.filter((r) => r.themeId === theme)
  const plain = list.filter((r) => !r.group)
  const grouped = list.filter((r) => r.group)
  return { plain, grouped, group: grouped[0]?.group ?? '' }
}

function pickTheme(letter: string, theme: string) {
  themeChoice[letter] = theme
  const resource = props.draft.resourceOf(props.draft.cellByLetter(letter)?.resourceId ?? null)
  if (resource && resource.themeId !== theme) props.draft.setResource(letter, null)
}

function domainGroups(resource: ResourceDef, axisKey: string, coordinates: Record<string, string>) {
  const options = axisOptions(resource, axisKey, coordinates)
  const groups = new Map<string, typeof options>()
  for (const option of options) {
    const key = option.group ?? ''
    groups.set(key, [...(groups.get(key) ?? []), option])
  }
  return [...groups].map(([name, items]) => ({ name, items }))
}

const reading = (letter: string) => {
  const cell = props.draft.cellByLetter(letter)
  const resource = props.draft.resourceOf(cell?.resourceId ?? null)
  return cell && resource ? cellShortLabel(resource, cell.coordinates) : ''
}
</script>

<template>
  <div class="cascade">
    <article v-for="cell in draft.cells.value" :key="cell.letter" class="at-cell" :aria-label="`Cellule ${cell.letter}`">
      <span class="at-cell__letter" aria-hidden="true">{{ cell.letter }}</span>
      <div class="at-cell__body">
        <div class="cascade__fields">
          <div class="cascade__field">
            <label class="at-label" :for="`c-theme-${cell.letter}`">Thème</label>
            <select :id="`c-theme-${cell.letter}`" class="at-select" :value="themeOf(cell.letter)" @change="pickTheme(cell.letter, ($event.target as HTMLSelectElement).value)">
              <option value="" disabled>Choisir un thème</option>
              <option v-for="theme in themes" :key="theme.id" :value="theme.id">{{ theme.label }}</option>
            </select>
          </div>
          <div class="cascade__field cascade__field--wide">
            <label class="at-label" :for="`c-ind-${cell.letter}`">Indicateur</label>
            <select
              :id="`c-ind-${cell.letter}`"
              class="at-select"
              :disabled="!themeOf(cell.letter)"
              :value="cell.resourceId ?? ''"
              @change="draft.setResource(cell.letter, ($event.target as HTMLSelectElement).value || null)"
            >
              <option value="" disabled>{{ themeOf(cell.letter) ? 'Choisir un indicateur' : 'Choisir d’abord un thème' }}</option>
              <option v-for="r in indicatorsFor(cell.letter).plain" :key="r.id" :value="r.id">{{ r.label }}</option>
              <optgroup v-if="indicatorsFor(cell.letter).grouped.length" :label="indicatorsFor(cell.letter).group">
                <option v-for="r in indicatorsFor(cell.letter).grouped" :key="r.id" :value="r.id">{{ r.label }}</option>
              </optgroup>
            </select>
          </div>
          <template v-if="draft.resourceOf(cell.resourceId)">
            <div v-for="axis in draft.resourceOf(cell.resourceId)!.axes" :key="axis.key" class="cascade__field" :class="{ 'cascade__field--wide': axis.key === 'typequ' }">
              <label class="at-label" :for="`c-${cell.letter}-${axis.key}`">{{ axis.label }}</label>
              <select
                :id="`c-${cell.letter}-${axis.key}`"
                class="at-select"
                :value="cell.coordinates[axis.key]"
                @change="draft.setCoordinate(cell.letter, axis.key, ($event.target as HTMLSelectElement).value)"
              >
                <template v-for="group in domainGroups(draft.resourceOf(cell.resourceId)!, axis.key, cell.coordinates)" :key="group.name">
                  <optgroup v-if="group.name" :label="group.name">
                    <option v-for="o in group.items" :key="o.value" :value="o.value">{{ o.label }}</option>
                  </optgroup>
                  <template v-else>
                    <option v-for="o in group.items" :key="o.value" :value="o.value">{{ o.label }}</option>
                  </template>
                </template>
              </select>
            </div>
          </template>
        </div>
        <div class="at-cell__foot">
          <p v-if="reading(cell.letter)" class="at-reading">
            <strong>{{ cell.letter }}</strong> = {{ reading(cell.letter) }}
            <span class="at-unit">· {{ cellUnit(draft.resourceOf(cell.resourceId)!, cell.coordinates) || 'sans unité' }}</span>
          </p>
          <p v-else class="at-reading">Cellule non adressée.</p>
          <button v-if="draft.cells.value.length > 1" type="button" class="at-text-button" @click="draft.removeCell(cell.letter)">Retirer {{ cell.letter }}</button>
        </div>
      </div>
    </article>
  </div>
</template>

<style scoped>
.cascade__fields { display: flex; flex-wrap: wrap; gap: var(--space-3) var(--space-6); }
.cascade__field { display: grid; align-content: end; min-width: 9rem; max-width: 100%; }
.cascade__field--wide { min-width: min(100%, 18rem); }
.cascade__field .at-select { width: 100%; }
@media (max-width: 520px) { .cascade__field, .cascade__field--wide { flex: 1 1 100%; } }
</style>
