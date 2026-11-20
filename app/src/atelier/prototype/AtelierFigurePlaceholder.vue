<script setup lang="ts">
/** PROTOTYPE — a Figure d'atelier: a production-style figure title, an empty plot with editable axis titles, legends, a sources line. */
import { computed } from 'vue'
import { ChevronDown, ChevronUp, Copy, Pencil, Trash2 } from 'lucide-vue-next'

import { cahierFigureStyle } from '@/fiche/cahierFigureGrammaire'
import type { CahierFigureGeometry } from '@/fiche/cahierFigureGrammaire'
import '@/fiche/prototype/cahierEvidenceSource.css'
import '@/fiche/prototype/cahierFigure.css'

import AtelierLegends from './AtelierLegends.vue'
import BlockHandle from './BlockHandle.vue'
import EditableText from './EditableText.vue'
import IconButton from './IconButton.vue'
import type { ResourceDef } from './prototypeCellules'
import type { SharedAxisTitles } from './prototypeShare'
import { axisDefault, type FigureState } from './prototypeFigure'
import type { Territoires } from './prototypeTerritoires'

const props = defineProps<{
  state: FigureState
  catalogue: ResourceDef[]
  territoires: Territoires | null
  title: string
  /** The reader's overrides; null = default. */
  axis: SharedAxisTitles
  id: number
  position: number
  total: number
}>()
const emit = defineEmits<{
  retitle: [value: string]
  axis: [which: 'x' | 'y', value: string]
  edit: []
  duplicate: []
  remove: []
  move: [delta: -1 | 1]
  dragstart: [event: DragEvent]
  dragend: []
}>()

const lookup = (id: string) => props.catalogue.find((r) => r.id === id)
const axisText = (which: 'x' | 'y') => props.axis[which] ?? axisDefault(props.state.channels[which], lookup)

const sources = computed(() => {
  const labels = new Set<string>()
  for (const channel of Object.values(props.state.channels)) {
    const cells = channel.mode === 'cellule' ? [channel.cell] : channel.mode === 'formule' ? channel.operands : []
    for (const cell of cells) if (cell) labels.add(lookup(cell.resourceId)?.label ?? cell.resourceId)
  }
  return [...labels]
})

/** Production frame geometry, with a deeper bottom and left rail so wrapped axis titles have room. */
const geometry: CahierFigureGeometry = { width: 820, height: 380, margin: { top: 20, right: 26, bottom: 84, left: 96 } }
const frameStyle = cahierFigureStyle(geometry)
const g = geometry
const plot = { left: g.margin.left, right: g.width - g.margin.right, top: g.margin.top, bottom: g.height - g.margin.bottom }
const ticks = [0.25, 0.5, 0.75]
</script>

<template>
  <figure class="at-block at-figure" :data-block="id">
    <div class="at-block__actions">
      <BlockHandle :id="id" :position="position" :total="total" @move="emit('move', $event)" @dragstart="emit('dragstart', $event)" @dragend="emit('dragend')" />
      <IconButton class="at-touch-only" :icon="ChevronUp" label="Monter le bloc" :disabled="position === 1" @click="emit('move', -1)" />
      <IconButton class="at-touch-only" :icon="ChevronDown" label="Descendre le bloc" :disabled="position === total" @click="emit('move', 1)" />
      <IconButton :icon="Pencil" label="Modifier la figure" @click="emit('edit')" />
      <IconButton :icon="Copy" label="Dupliquer la figure" @click="emit('duplicate')" />
      <IconButton :icon="Trash2" label="Retirer la figure" @click="emit('remove')" />
    </div>

    <EditableText class="cahier-figure-title" tag="h3" label="Titre de la figure" :model-value="title" @commit="emit('retitle', $event)" />

    <div class="cahier-figure-frame cahier-figure-frame--standard at-plot" :style="frameStyle">
      <div class="cahier-figure-frame__plot">
        <svg class="cahier-figure-plot" :viewBox="`0 0 ${g.width} ${g.height}`" role="img" :aria-label="`Cadre vide du nuage : ${title}`">
          <line v-for="t in ticks" :key="`h${t}`" class="cahier-figure-tick" :x1="plot.left" :x2="plot.right" :y1="plot.top + (plot.bottom - plot.top) * t" :y2="plot.top + (plot.bottom - plot.top) * t" />
          <line v-for="t in ticks" :key="`v${t}`" class="cahier-figure-tick" :y1="plot.top" :y2="plot.bottom" :x1="plot.left + (plot.right - plot.left) * t" :x2="plot.left + (plot.right - plot.left) * t" />
          <line class="cahier-figure-axis" :x1="plot.left" :x2="plot.right" :y1="plot.bottom" :y2="plot.bottom" />
          <line class="cahier-figure-axis" :x1="plot.left" :x2="plot.left" :y1="plot.top" :y2="plot.bottom" />
        </svg>
        <div class="cahier-figure-axis-title cahier-figure-axis-title--x at-axis">
          <EditableText tag="span" label="Titre de l’axe x" :model-value="axisText('x')" :resettable="axis.x !== null" @commit="emit('axis', 'x', $event)" @reset="emit('axis', 'x', '')" />
        </div>
        <div class="cahier-figure-axis-title cahier-figure-axis-title--y at-axis">
          <EditableText tag="span" label="Titre de l’axe y" :model-value="axisText('y')" :resettable="axis.y !== null" @commit="emit('axis', 'y', $event)" @reset="emit('axis', 'y', '')" />
        </div>
      </div>
    </div>

    <AtelierLegends :state="state" :catalogue="catalogue" :territoires="territoires" />

    <p v-if="sources.length" class="cahier-evidence-source at-figure__sources">Sources : {{ sources.join(' · ') }}</p>
  </figure>
</template>
