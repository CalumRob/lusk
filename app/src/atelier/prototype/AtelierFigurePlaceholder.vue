<script setup lang="ts">
/** PROTOTYPE — a Figure d'atelier in the production nested frame: centered editable title, small actions top right, empty plot, key, sources. */
import { computed } from 'vue'

import CahierFigureFrame from '@/fiche/prototype/CahierFigureFrame.vue'
import '@/fiche/prototype/cahierEvidenceSource.css'
import { CAHIER_FIGURE_GEOMETRY } from '@/fiche/cahierFigureGrammaire'

import type { ResourceDef } from './prototypeCellules'
import EditableText from './EditableText.vue'
import {
  channelLabel,
  describe,
  formulaReadingOf,
  prettyExpression,
  type ChannelId,
  type FigureState,
} from './prototypeFigure'

const props = defineProps<{ state: FigureState; catalogue: ResourceDef[]; title: string; number: number }>()
const emit = defineEmits<{ retitle: [value: string]; edit: []; duplicate: []; remove: [] }>()

const lookup = (id: string) => props.catalogue.find((r) => r.id === id)
const short = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)
const label = (id: ChannelId) => channelLabel(props.state.channels[id], lookup)

const levelLabel = computed(() => ({ commune: 'communes', epci: 'EPCI', departement: 'départements' })[props.state.level])
const subtitle = computed(() =>
  [
    `Nuage de ${levelLabel.value}`,
    props.state.channels.taille.mode !== 'aucune' ? `taille : ${label('taille')}` : '',
    props.state.channels.couleur.mode !== 'aucune' ? `couleur : ${label('couleur')}` : '',
  ]
    .filter(Boolean)
    .join(' · '),
)

interface Row { tag: string; text: string; unit: string; sub?: boolean }
const rows = computed<Row[]>(() => {
  const out: Row[] = []
  for (const id of ['x', 'y', 'taille', 'couleur'] as const) {
    const channel = props.state.channels[id]
    if (channel.mode === 'aucune') continue
    if (channel.mode === 'cellule') {
      const info = describe(channel.cell, lookup)
      out.push({ tag: id, text: info?.lecture ?? '', unit: info?.unite || '' })
    } else if (channel.mode === 'formule') {
      out.push({ tag: id, text: prettyExpression(channel.expression), unit: '' })
      for (const letter of formulaReadingOf(channel).letters) {
        const info = describe(channel.operands[letter.charCodeAt(0) - 65] ?? null, lookup)
        out.push({ tag: letter, text: info?.lecture ?? '', unit: info?.unite || '', sub: true })
      }
    } else out.push({ tag: id, text: label(id), unit: '' })
  }
  return out
})

const sources = computed(() => {
  const labels = new Set<string>()
  for (const channel of Object.values(props.state.channels)) {
    const cells = channel.mode === 'cellule' ? [channel.cell] : channel.mode === 'formule' ? channel.operands : []
    for (const cell of cells) if (cell) labels.add(lookup(cell.resourceId)?.label ?? cell.resourceId)
  }
  return [...labels]
})

const FILTER_LABELS: Record<string, string> = { departement: 'Département', epci: 'EPCI', classe_densite: 'Classe de densité', littoral: 'Littoral' }
const filters = computed(() => Object.entries(props.state.population).filter(([, v]) => v.length).map(([k, v]) => `${FILTER_LABELS[k]} (${v.length})`))

const g = CAHIER_FIGURE_GEOMETRY
const plot = { left: g.margin.left, right: g.width - g.margin.right, top: g.margin.top, bottom: g.height - g.margin.bottom }
const ticks = [0.25, 0.5, 0.75]
</script>

<template>
  <section class="concept-group at-group" :aria-label="`Figure ${number}`">
    <div class="concept-group-heading at-group__heading">
      <span class="at-group__number">{{ String(number).padStart(2, '0') }}</span>
      <EditableText class="at-group__title" tag="h3" label="Titre de la figure" :model-value="title" @commit="emit('retitle', $event)" />
      <div class="at-group__actions">
        <button type="button" class="at-action" @click="emit('edit')">Modifier</button>
        <button type="button" class="at-action" @click="emit('duplicate')">Dupliquer</button>
        <button type="button" class="at-action at-action--quiet" @click="emit('remove')">Retirer</button>
      </div>
    </div>

    <p class="at-group__subtitle">{{ subtitle }}<template v-if="filters.length"> · {{ filters.join(' · ') }}</template></p>

    <CahierFigureFrame :x-title="short(label('x'), 48)" :y-title="short(label('y'), 40)" size="standard">
      <template #plot>
        <svg class="cahier-figure-plot" :viewBox="`0 0 ${g.width} ${g.height}`" role="img" :aria-label="`Cadre vide du nuage : ${title}`">
          <line v-for="t in ticks" :key="`h${t}`" class="cahier-figure-tick" :x1="plot.left" :x2="plot.right" :y1="plot.top + (plot.bottom - plot.top) * t" :y2="plot.top + (plot.bottom - plot.top) * t" />
          <line v-for="t in ticks" :key="`v${t}`" class="cahier-figure-tick" :y1="plot.top" :y2="plot.bottom" :x1="plot.left + (plot.right - plot.left) * t" :x2="plot.left + (plot.right - plot.left) * t" />
          <line class="cahier-figure-axis" :x1="plot.left" :x2="plot.right" :y1="plot.bottom" :y2="plot.bottom" />
          <line class="cahier-figure-axis" :x1="plot.left" :x2="plot.left" :y1="plot.top" :y2="plot.bottom" />
        </svg>
      </template>
    </CahierFigureFrame>

    <dl class="at-figure__key">
      <template v-for="row in rows" :key="`${row.tag}-${row.sub}`">
        <dt :class="{ 'at-figure__sub': row.sub }">{{ row.tag }}</dt>
        <dd>{{ row.text }}</dd>
        <dd>{{ row.unit }}</dd>
      </template>
    </dl>
    <p v-if="sources.length" class="cahier-evidence-source">Sources : {{ sources.join(' · ') }}</p>
  </section>
</template>
