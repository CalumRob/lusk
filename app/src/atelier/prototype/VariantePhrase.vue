<script setup lang="ts">
/** PROTOTYPE — variant C, « Phrase »: each Cellule is a sentence; every bracket is a slot that opens a small list. */
import { computed } from 'vue'

import { AEDAR_TIME_MODE_COLORS } from '@/fiche/prototype/aedarTimeModeColors'

import { axisOptions, axisValueLabel, cellUnit, type AxisDef, type ResourceDef } from './prototypeCellules'
import type { Draft } from './prototypeFigure'
import SlotPicker, { type SlotOption } from './SlotPicker.vue'

const props = defineProps<{ draft: Draft; catalogue: ResourceDef[] }>()

const indicatorOptions = computed<SlotOption[]>(() =>
  props.catalogue.map((r) => ({
    value: r.id,
    label: r.label,
    group: r.group ? `${r.themeLabel} · ${r.group}` : r.themeLabel,
    hint: r.family === 'aedar' ? 'coordonnées' : r.axes.length ? `${r.axes.length} coord.` : undefined,
  })),
)

const resourceFor = (letter: string) => props.draft.resourceOf(props.draft.cellByLetter(letter)?.resourceId ?? null)

function slotOptions(resource: ResourceDef, axis: AxisDef, coordinates: Record<string, string>): SlotOption[] {
  return axisOptions(resource, axis.key, coordinates).map((o) => ({ value: o.value, label: o.label, group: o.group }))
}

/** The connector placed before a slot: profiles read « — 65-79 ans femmes », not « — 65-79 ans — femmes ». */
function joinBefore(resource: ResourceDef, axis: AxisDef): string {
  if (axis.lead) return ''
  const rest = resource.axes.filter((a) => !a.lead)
  return rest[0]?.key === axis.key ? axis.join : axis.join === ' — ' ? ' ' : axis.join
}

const modeInk = (resource: ResourceDef, axis: AxisDef, value: string) => (resource.family === 'aedar' && axis.key === 'mode' ? AEDAR_TIME_MODE_COLORS[value] : undefined)
</script>

<template>
  <div class="phrases">
    <article v-for="cell in draft.cells.value" :key="cell.letter" class="at-cell" :aria-label="`Cellule ${cell.letter}`">
      <span class="at-cell__letter" aria-hidden="true">{{ cell.letter }}</span>
      <div class="at-cell__body">
        <p class="phrase">
          <!-- the indicator is the first slot unless an AEDAR lead (« Part des adresses accédant à ») opens the sentence -->
          <SlotPicker
            v-if="!resourceFor(cell.letter) || resourceFor(cell.letter)!.family !== 'aedar'"
            name="Indicateur"
            :display="resourceFor(cell.letter)?.label ?? ''"
            placeholder="choisir un indicateur"
            :options="indicatorOptions"
            :model-value="cell.resourceId"
            @update:model-value="draft.setResource(cell.letter, $event)"
          />
          <template v-if="resourceFor(cell.letter)">
            <template v-for="axis in resourceFor(cell.letter)!.axes" :key="axis.key">
              <template v-if="joinBefore(resourceFor(cell.letter)!, axis)">{{ joinBefore(resourceFor(cell.letter)!, axis) }}</template>
              <template v-else-if="!axis.lead">{{ ' ' }}</template>
              <SlotPicker
                :name="axis.label"
                :display="axisValueLabel(resourceFor(cell.letter)!, axis.key, cell.coordinates[axis.key]!, 'phrase')"
                :options="slotOptions(resourceFor(cell.letter)!, axis, cell.coordinates)"
                :model-value="cell.coordinates[axis.key] ?? null"
                :ink="modeInk(resourceFor(cell.letter)!, axis, cell.coordinates[axis.key]!)"
                @update:model-value="draft.setCoordinate(cell.letter, axis.key, $event)"
              />{{ axis.lead ? ' ' : '' }}
            </template>
            <span class="at-unit">· {{ cellUnit(resourceFor(cell.letter)!, cell.coordinates) || 'sans unité' }}</span>
          </template>
        </p>
        <div class="at-cell__foot">
          <span v-if="resourceFor(cell.letter)?.family === 'aedar'" class="phrase__indicator">
            Indicateur :
            <SlotPicker
              name="Indicateur"
              :display="resourceFor(cell.letter)!.label"
              :options="indicatorOptions"
              :model-value="cell.resourceId"
              @update:model-value="draft.setResource(cell.letter, $event)"
            />
          </span>
          <span v-else-if="resourceFor(cell.letter) && !resourceFor(cell.letter)!.axes.length" class="at-reading">Un seul nombre par territoire — rien à préciser.</span>
          <button v-if="draft.cells.value.length > 1" type="button" class="at-text-button" @click="draft.removeCell(cell.letter)">Retirer {{ cell.letter }}</button>
        </div>
      </div>
    </article>
  </div>
</template>

<style scoped>
.phrase {
  margin: 0;
  color: var(--cahier-default);
  font: 400 1.0625rem/2.05 var(--font-body);
  text-wrap: pretty;
}
.phrase__indicator { color: var(--muted); font: var(--type-figure-legend); }
.phrase .at-unit { white-space: nowrap; }
</style>
