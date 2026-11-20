<script setup lang="ts">
/** PROTOTYPE — throwaway. /prototype/atelier — an Atelier page: editable title, prose blocks and figures. */
import { computed, onMounted, ref } from 'vue'

import { CAHIER_COLOR_ROLES } from '@/fiche/prototype/cahierColorRoles'
import '@/fiche/prototype/cahierLayout.css'

import AtelierFigureModal, { type PageEntry } from './AtelierFigureModal.vue'
import AtelierFigurePlaceholder from './AtelierFigurePlaceholder.vue'
import './atelierPrototype.css'
import EditableText from './EditableText.vue'
import { loadCatalogue, type ResourceDef } from './prototypeCellules'
import { buildSpec, cloneState, generatedTitle, type FigureState } from './prototypeFigure'
import { loadTerritoires, type Territoires } from './prototypeTerritoires'
import ProseBlock from './ProseBlock.vue'

type Block =
  | { id: number; kind: 'prose'; text: string; fresh?: boolean }
  | { id: number; kind: 'figure'; state: FigureState; customTitle: string | null }

const INTRO = 'Cette page compose des figures à partir des cellules publiées : un nombre par territoire, à toutes ses coordonnées.'

/** Cross-theme page: the general (brand) ramp stands where a theme would. */
const roles = { ...CAHIER_COLOR_ROLES, '--cahier-theme': 'var(--brand-500)', '--cahier-theme-strong': 'var(--brand-700)', '--cahier-theme-emphasis': 'var(--brand-600)' }

const catalogue = ref<ResourceDef[]>([])
const territoires = ref<Territoires | null>(null)
const status = ref<'loading' | 'ready' | 'error'>('loading')
const error = ref('')

const pageTitle = ref('Atelier')
let counter = 1
const blocks = ref<Block[]>([{ id: counter, kind: 'prose', text: INTRO }])

const modal = ref<{ open: boolean; editingId: number | null; insertAt: number; initial: FigureState | null }>({ open: false, editingId: null, insertAt: 0, initial: null })

onMounted(async () => {
  loadTerritoires().then((t) => (territoires.value = t)).catch(() => undefined)
  try {
    catalogue.value = await loadCatalogue()
    status.value = 'ready'
  } catch (e) {
    status.value = 'error'
    error.value = e instanceof Error ? e.message : String(e)
  }
})

const lookup = (id: string) => catalogue.value.find((r) => r.id === id)
const titleOf = (b: Extract<Block, { kind: 'figure' }>) => b.customTitle ?? generatedTitle(b.state, lookup)
const figureNumber = (id: number) => blocks.value.filter((b) => b.kind === 'figure').findIndex((b) => b.id === id) + 1
const figureCount = computed(() => blocks.value.filter((b) => b.kind === 'figure').length)

function insert(index: number, block: Block) {
  blocks.value.splice(index, 0, block)
}
const addText = (index: number) => insert(index, { id: ++counter, kind: 'prose', text: '', fresh: true })
function openNewFigure(index: number) {
  modal.value = { open: true, editingId: null, insertAt: index, initial: null }
}
function openEdit(id: number) {
  const block = blocks.value.find((b) => b.id === id)
  if (block?.kind === 'figure') modal.value = { open: true, editingId: id, insertAt: 0, initial: block.state }
}
function duplicate(id: number) {
  const index = blocks.value.findIndex((b) => b.id === id)
  const block = blocks.value[index]
  if (block?.kind !== 'figure') return
  const copy: Block = { id: ++counter, kind: 'figure', state: cloneState(block.state), customTitle: block.customTitle }
  insert(index + 1, copy)
  modal.value = { open: true, editingId: copy.id, insertAt: 0, initial: copy.state }
}
function save(state: FigureState) {
  const { editingId, insertAt } = modal.value
  if (editingId === null) insert(Math.min(insertAt, blocks.value.length), { id: ++counter, kind: 'figure', state, customTitle: null })
  else {
    const block = blocks.value.find((b) => b.id === editingId)
    if (block?.kind === 'figure') block.state = state
  }
  modal.value.open = false
}
const remove = (id: number) => (blocks.value = blocks.value.filter((b) => b.id !== id))
function retitle(block: Extract<Block, { kind: 'figure' }>, value: string) {
  block.customTitle = value && value !== generatedTitle(block.state, lookup) ? value : null
}
function saveProse(block: Extract<Block, { kind: 'prose' }>, text: string) {
  block.text = text
  block.fresh = false
}

const entries = computed<PageEntry[]>(() =>
  blocks.value.map((b) => ({
    id: b.id,
    json: b.kind === 'prose' ? { texte: b.text } : { figure: { titre: titleOf(b), ...buildSpec(b.state, lookup) } },
  })),
)
const editedCustomTitle = computed(() => {
  const block = blocks.value.find((b) => b.id === modal.value.editingId)
  return block?.kind === 'figure' ? block.customTitle : null
})
</script>

<template>
  <article class="atelier cahier presentation-editorial cahier--sans-grille cahier--indexed-sections" :style="roles as Record<string, string>">
    <div class="atelier-wrap">
      <section class="cahier-page atelier-page" aria-labelledby="atelier-title">
        <header class="page-heading">
          <span class="page-heading-index"><span class="page-heading-sr-only">Page </span><span>01</span><small>/01</small></span>
          <EditableText id="atelier-title" class="page-heading-title" tag="h1" label="Titre de la page" :model-value="pageTitle" @commit="pageTitle = $event || 'Atelier'" />
          <span class="page-heading-context">
            <span class="page-heading-theme">Atelier</span>
            <span class="page-heading-context-separator" aria-hidden="true">·</span>
            <span class="page-heading-territory">{{ figureCount }} figure{{ figureCount > 1 ? 's' : '' }}</span>
          </span>
        </header>

        <p v-if="status === 'loading'" class="at-state" role="status">Lecture du catalogue…</p>
        <p v-else-if="status === 'error'" class="at-state" role="alert">Catalogue injoignable ({{ error }}).</p>

        <div v-if="status === 'ready'" class="page-copy">
          <div class="at-insert" role="group" aria-label="Ajouter en haut de page">
            <button type="button" class="at-action" @click="addText(0)">+ Ajouter un texte</button>
            <button type="button" class="at-action" @click="openNewFigure(0)">+ Ajouter une figure</button>
          </div>

          <template v-for="(block, index) in blocks" :key="block.id">
            <ProseBlock v-if="block.kind === 'prose'" :uid="`p${block.id}`" :text="block.text" :start-editing="block.fresh" @save="saveProse(block, $event)" @remove="remove(block.id)" />
            <AtelierFigurePlaceholder
              v-else
              :state="block.state"
              :catalogue="catalogue"
              :title="titleOf(block)"
              :number="figureNumber(block.id)"
              @retitle="retitle(block, $event)"
              @edit="openEdit(block.id)"
              @duplicate="duplicate(block.id)"
              @remove="remove(block.id)"
            />
            <div v-if="index < blocks.length - 1" class="at-insert" role="group" :aria-label="`Ajouter après le bloc ${index + 1}`">
              <button type="button" class="at-action" @click="addText(index + 1)">+ Ajouter un texte</button>
              <button type="button" class="at-action" @click="openNewFigure(index + 1)">+ Ajouter une figure</button>
            </div>
          </template>

          <div class="at-slot">
            <p>{{ figureCount ? 'Une figure de plus ?' : 'Aucune figure sur cette page.' }}</p>
            <div class="at-slot__buttons">
              <button type="button" class="at-add" @click="openNewFigure(blocks.length)"><span class="at-add__plus" aria-hidden="true">+</span>Ajouter une figure</button>
              <button type="button" class="at-add at-add--quiet" @click="addText(blocks.length)"><span class="at-add__plus" aria-hidden="true">+</span>Ajouter un texte</button>
            </div>
          </div>
        </div>
      </section>
    </div>

    <AtelierFigureModal
      :open="modal.open"
      :catalogue="catalogue"
      :territoires="territoires"
      :initial="modal.initial"
      :page-title="pageTitle"
      :entries="entries"
      :editing-id="modal.editingId"
      :insert-at="modal.insertAt"
      :custom-title="editedCustomTitle"
      @close="modal.open = false"
      @save="save"
    />
  </article>
</template>
