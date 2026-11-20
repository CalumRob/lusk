<script setup lang="ts">
/** PROTOTYPE — throwaway. /prototype/atelier — an Atelier page: editable title, prose blocks and figures, shareable by link. */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Check, ChartScatter, Share2, Type } from 'lucide-vue-next'

import AppIcon from '@/components/AppIcon.vue'
import { CAHIER_COLOR_ROLES } from '@/fiche/prototype/cahierColorRoles'
import '@/fiche/prototype/cahierLayout.css'

import AtelierFigureModal, { type PageEntry } from './AtelierFigureModal.vue'
import AtelierFigurePlaceholder from './AtelierFigurePlaceholder.vue'
import './atelierPrototype.css'
import EditableText from './EditableText.vue'
import IconButton from './IconButton.vue'
import { loadCatalogue, type ResourceDef } from './prototypeCellules'
import { axisDefault, buildSpec, cloneState, generatedTitle, type FigureState } from './prototypeFigure'
import { decodePage, encodePage, type SharedAxisTitles, type SharedPage } from './prototypeShare'
import { loadTerritoires, type Territoires } from './prototypeTerritoires'
import ProseBlock from './ProseBlock.vue'

type Block =
  | { id: number; kind: 'prose'; text: string; fresh?: boolean }
  | { id: number; kind: 'figure'; state: FigureState; customTitle: string | null; axis: SharedAxisTitles }

const INTRO = 'Cette page compose des figures à partir des cellules publiées : un nombre par territoire, à toutes ses coordonnées.'

/** Cross-theme page: the general (brand) ramp stands where a theme would. */
const roles = { ...CAHIER_COLOR_ROLES, '--cahier-theme': 'var(--brand-500)', '--cahier-theme-strong': 'var(--brand-700)', '--cahier-theme-emphasis': 'var(--brand-600)' }

const route = useRoute()
const router = useRouter()

const catalogue = ref<ResourceDef[]>([])
const territoires = ref<Territoires | null>(null)
const status = ref<'loading' | 'ready' | 'error'>('loading')
const error = ref('')
const notice = ref('')

const pageTitle = ref('Atelier')
let counter = 1
const blocks = ref<Block[]>([{ id: counter, kind: 'prose', text: INTRO }])

const modal = ref<{ open: boolean; editingId: number | null; insertAt: number; initial: FigureState | null }>({ open: false, editingId: null, insertAt: 0, initial: null })

/* ------------------------------------------------------------- share link */

const shareUrl = ref('')
const copied = ref(false)
let restored = false
let timer: ReturnType<typeof setTimeout> | undefined
let copiedTimer: ReturnType<typeof setTimeout> | undefined

const toShared = (): SharedPage => ({
  v: 1,
  t: pageTitle.value,
  b: blocks.value.map((b) => (b.kind === 'prose' ? { k: 'p' as const, x: b.text } : { k: 'f' as const, s: b.state, ct: b.customTitle, ax: b.axis })),
})
async function currentUrl() {
  const c = await encodePage(toShared())
  return `${window.location.origin}${router.resolve({ query: { c } }).href}`
}
function fromShared(page: SharedPage) {
  pageTitle.value = page.t
  blocks.value = page.b.map((b) =>
    b.k === 'p' ? { id: ++counter, kind: 'prose' as const, text: b.x } : { id: ++counter, kind: 'figure' as const, state: b.s, customTitle: b.ct, axis: b.ax },
  )
}
function scheduleSync() {
  if (!restored) return
  clearTimeout(timer)
  timer = setTimeout(async () => {
    const url = await currentUrl()
    shareUrl.value = url
    const c = new URL(url).searchParams.get('c')!
    if (route.query.c !== c) void router.replace({ query: { ...route.query, c } })
  }, 400)
}
watch([pageTitle, blocks], scheduleSync, { deep: true })

async function share() {
  const url = await currentUrl()
  shareUrl.value = url
  try {
    await navigator.clipboard.writeText(url)
    copied.value = true
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copied.value = false), 2200)
  } catch {
    notice.value = 'Copie impossible : le lien est dans la barre d’adresse.'
  }
}

onMounted(async () => {
  const c = route.query.c
  if (typeof c === 'string' && c) {
    try {
      fromShared(await decodePage(c))
    } catch {
      notice.value = 'Lien de partage illisible : page vide.'
      pageTitle.value = 'Atelier'
      blocks.value = []
    }
  }
  restored = true
  scheduleSync()
  loadTerritoires().then((t) => (territoires.value = t)).catch(() => undefined)
  try {
    catalogue.value = await loadCatalogue()
    status.value = 'ready'
  } catch (e) {
    status.value = 'error'
    error.value = e instanceof Error ? e.message : String(e)
  }
})
onBeforeUnmount(() => {
  clearTimeout(timer)
  clearTimeout(copiedTimer)
})

/* ------------------------------------------------------------------ blocks */

const lookup = (id: string) => catalogue.value.find((r) => r.id === id)
const titleOf = (b: Extract<Block, { kind: 'figure' }>) => b.customTitle ?? generatedTitle(b.state, lookup)
const figureCount = computed(() => blocks.value.filter((b) => b.kind === 'figure').length)

const insert = (index: number, block: Block) => void blocks.value.splice(index, 0, block)
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
  const copy: Block = { id: ++counter, kind: 'figure', state: cloneState(block.state), customTitle: block.customTitle, axis: { ...block.axis } }
  insert(index + 1, copy)
  modal.value = { open: true, editingId: copy.id, insertAt: 0, initial: copy.state }
}
function save(state: FigureState) {
  const { editingId, insertAt } = modal.value
  if (editingId === null) insert(Math.min(insertAt, blocks.value.length), { id: ++counter, kind: 'figure', state, customTitle: null, axis: { x: null, y: null } })
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
function setAxis(block: Extract<Block, { kind: 'figure' }>, which: 'x' | 'y', value: string) {
  block.axis = { ...block.axis, [which]: value && value !== axisDefault(block.state.channels[which], lookup) ? value : null }
}
function saveProse(block: Extract<Block, { kind: 'prose' }>, text: string) {
  block.text = text
  block.fresh = false
}

/* ----------------------------------------------------------- reordering */

const copyEl = ref<HTMLElement | null>(null)
const announcement = ref('')
const dragId = ref<number | null>(null)
const dropIndex = ref<number | null>(null)
const dropTop = ref<number | null>(null)

/** Move block `id` so that it sits before the block currently at `toIndex` (0..n). */
function moveTo(id: number, toIndex: number) {
  const from = blocks.value.findIndex((b) => b.id === id)
  if (from < 0) return
  const target = toIndex > from ? toIndex - 1 : toIndex
  if (target === from) return
  const [block] = blocks.value.splice(from, 1)
  blocks.value.splice(target, 0, block!)
  announcement.value = `Bloc déplacé en position ${target + 1} sur ${blocks.value.length}`
}
async function moveBy(id: number, delta: -1 | 1) {
  const from = blocks.value.findIndex((b) => b.id === id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= blocks.value.length) {
    announcement.value = delta < 0 ? 'Déjà en première position' : 'Déjà en dernière position'
    return
  }
  moveTo(id, delta > 0 ? to + 1 : to)
  await nextTick()
  document.querySelector<HTMLElement>(`[data-handle="${id}"]`)?.focus()
}
function onDragStart(id: number, event: DragEvent) {
  dragId.value = id
  const block = (event.target as HTMLElement).closest<HTMLElement>('.at-block')
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(id))
    if (block) event.dataTransfer.setDragImage(block, 24, 16)
  }
}
function onDragOver(event: DragEvent) {
  if (dragId.value === null || !copyEl.value) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  const rows = [...copyEl.value.querySelectorAll<HTMLElement>(':scope > .at-block')]
  const area = copyEl.value.getBoundingClientRect()
  let index = rows.length
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!.getBoundingClientRect()
    if (event.clientY < r.top + r.height / 2) {
      index = i
      break
    }
  }
  dropIndex.value = index
  const anchor = rows[index]?.getBoundingClientRect()
  const last = rows[rows.length - 1]?.getBoundingClientRect()
  dropTop.value = (anchor ? anchor.top - 4 : (last?.bottom ?? area.top) + 4) - area.top
}
function onDrop(event: DragEvent) {
  if (dragId.value === null) return
  event.preventDefault()
  if (dropIndex.value !== null) moveTo(dragId.value, dropIndex.value)
  onDragEnd()
}
function onDragEnd() {
  dragId.value = null
  dropIndex.value = null
  dropTop.value = null
}

const entries = computed<PageEntry[]>(() =>
  blocks.value.map((b) => ({
    id: b.id,
    json: b.kind === 'prose' ? { texte: b.text } : { figure: { titre: titleOf(b), titres_axes: b.axis, ...buildSpec(b.state, lookup) } },
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
          <div class="page-heading-tools">
            <span class="page-heading-context">
              <span class="page-heading-theme">Atelier</span>
              <span class="page-heading-context-separator" aria-hidden="true">·</span>
              <span class="page-heading-territory">{{ figureCount }} figure{{ figureCount > 1 ? 's' : '' }}</span>
            </span>
            <button type="button" class="at-action at-share" :disabled="status !== 'ready'" @click="share">
              <AppIcon :icone="copied ? Check : Share2" :taille="14" aria-hidden="true" />
              <span aria-live="polite">{{ copied ? 'Lien copié' : 'Partager' }}</span>
            </button>
          </div>
        </header>

        <p v-if="status === 'loading'" class="at-state" role="status">Lecture du catalogue…</p>
        <p v-else-if="status === 'error'" class="at-state" role="alert">Catalogue injoignable ({{ error }}).</p>
        <p v-if="notice" class="at-state at-state--quiet" role="status">{{ notice }}</p>

        <div v-if="status === 'ready'" ref="copyEl" class="page-copy" @dragover="onDragOver" @drop="onDrop">
          <div v-if="dropTop !== null" class="at-dropline" :style="{ top: `${dropTop}px` }" aria-hidden="true" />
          <template v-for="(block, index) in blocks" :key="block.id">
            <ProseBlock
              v-if="block.kind === 'prose'"
              :id="block.id"
              :uid="`p${block.id}`"
              :text="block.text"
              :start-editing="block.fresh"
              :position="index + 1"
              :total="blocks.length"
              :class="{ 'at-block--dragging': dragId === block.id }"
              @save="saveProse(block, $event)"
              @remove="remove(block.id)"
              @move="moveBy(block.id, $event)"
              @dragstart="onDragStart(block.id, $event)"
              @dragend="onDragEnd"
            />
            <AtelierFigurePlaceholder
              v-else
              :id="block.id"
              :position="index + 1"
              :total="blocks.length"
              :class="{ 'at-block--dragging': dragId === block.id }"
              @move="moveBy(block.id, $event)"
              @dragstart="onDragStart(block.id, $event)"
              @dragend="onDragEnd"
              :state="block.state"
              :catalogue="catalogue"
              :territoires="territoires"
              :title="titleOf(block)"
              :axis="block.axis"
              @retitle="retitle(block, $event)"
              @axis="(which, value) => setAxis(block, which, value)"
              @edit="openEdit(block.id)"
              @duplicate="duplicate(block.id)"
              @remove="remove(block.id)"
            />
            <div v-if="index < blocks.length - 1" class="at-insert" role="group" :aria-label="`Insérer après le bloc ${index + 1}`">
              <IconButton :icon="Type" label="Insérer un texte ici" :size="15" @click="addText(index + 1)" />
              <IconButton :icon="ChartScatter" label="Insérer une figure ici" :size="15" @click="openNewFigure(index + 1)" />
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

    <p class="page-heading-sr-only" role="status" aria-live="polite">{{ announcement }}</p>

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
      :share-length="shareUrl.length"
      @close="modal.open = false"
      @save="save"
    />
  </article>
</template>
