<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Bike, BusFront, CarFront, ChevronDown, Clock3, Footprints } from 'lucide-vue-next'
import type { Component } from 'vue'
import type { AedarEquipmentProfileEvidence } from '@/fiche/content/themeContent'
import { AEDAR_EQUIPMENT_BUCKET_HORIZONS, AEDAR_EQUIPMENT_MODES, aedarEquipmentShareMeasureKey, classifyAedarEquipmentTypes } from '@/fiche/content/aedarEquipmentBuckets'
import type { AedarEquipmentBucketKey, AedarEquipmentModeKey } from '@/fiche/content/aedarEquipmentBuckets'
import type { FigureLegendEntry } from '@/fiche/cahierFigureGrammaire'
import CahierFigureLegend from './CahierFigureLegend.vue'
import CahierDialog from './CahierDialog.vue'

const props = defineProps<{
  evidence: AedarEquipmentProfileEvidence
  /**
   * Dialog accessible name. Pass the host section's label so the modal title
   * and the section heading share one source and cannot drift apart.
   * @defaults to evidence.figureTitle
   */
  title?: string
}>()

const horizonMinutes = ref(props.evidence.initialHorizonMinutes)
const selectedMode = ref<AedarEquipmentBucketKey | 'all'>('all')
const focusedTypequ = ref<string | null>(null)
const followFocusedMode = ref(false)
const dialogOpen = ref(false)
const search = ref('')
const tableScroll = ref<HTMLElement | null>(null)
const canScrollTable = ref(false)
let tableResizeObserver: ResizeObserver | null = null
const profile = computed(() => {
  try {
    return classifyAedarEquipmentTypes(props.evidence.facts, {
      horizonMinutes: horizonMinutes.value,
      threshold: props.evidence.threshold,
    })
  } catch {
    return null
  }
})
const summary = computed(() => profile.value?.status === 'complete'
  ? `Répartition des ${profile.value.buckets.reduce((total, bucket) => total + bucket.count, 0)} types d’équipements à ${horizonMinutes.value} minutes. ${profile.value.buckets.map((item) => `${item.label} : ${item.count}`).join('. ')}.`
  : 'Répartition indisponible : les données AEDAR sont incomplètes ou incohérentes.')
const modeIcons: Readonly<Record<string, Component>> = {
  walk: Footprints,
  transit: BusFront,
  bike: Bike,
  car: CarFront,
}
const bucketPresentation = {
  walk: { iconKey: 'walk', tone: 'foot', color: 'var(--cahier-mode-foot)' },
  transit: { iconKey: 'transit', tone: 'foot', color: 'color-mix(in oklab, var(--cahier-mode-foot) 68%, white)' },
  bike_lts2: { iconKey: 'bike', tone: 'bike', color: 'var(--cahier-mode-bike)' },
  bike_lts4: { iconKey: 'bike', tone: 'bike', color: 'color-mix(in oklab, var(--cahier-mode-bike) 68%, white)' },
  car: { iconKey: 'car', tone: 'car', color: 'var(--cahier-mode-car)' },
  inaccessible: { iconKey: null, tone: 'foot', color: 'var(--text-tertiary)' },
} satisfies Record<AedarEquipmentBucketKey, { iconKey: keyof typeof modeIcons | null; tone: string; color: string }>
const bucketColors = Object.fromEntries(Object.entries(bucketPresentation).map(([key, value]) => [key, value.color])) as Record<AedarEquipmentBucketKey, string>
const bucketEntries = computed<FigureLegendEntry[]>(() => (profile.value?.buckets ?? []).map((bucket) => ({
  key: bucket.key,
  label: bucket.label,
  marker: bucket.key === 'inaccessible' ? 'slash' : 'icon',
  tone: bucketPresentation[bucket.key].tone,
  iconKey: bucketPresentation[bucket.key].iconKey ?? undefined,
})))
const bucketCounts = computed(() => Object.fromEntries((profile.value?.buckets ?? []).map((bucket) => [bucket.key, bucket.count])))
const filteredTypes = computed(() => {
  if (profile.value?.status !== 'complete') return []
  const modeBuckets = selectedMode.value === 'all'
    ? profile.value.buckets
    : profile.value.buckets.filter((item) => item.key === selectedMode.value)
  const query = search.value.trim().toLocaleLowerCase('fr-FR')
  return modeBuckets.flatMap((item) => item.types.map((type) => ({ ...type, bucket: item.key, bucketLabel: item.label })))
    .filter((type) => !query
      || type.label.toLocaleLowerCase('fr-FR').includes(query)
      || type.typequ.toLocaleLowerCase('fr-FR').includes(query))
})
const shareModes = AEDAR_EQUIPMENT_MODES.map(({ key, tableLabel }) => ({ key, label: tableLabel }))
const percent = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 })

function updateTableScrollAffordance() {
  const element = tableScroll.value
  canScrollTable.value = Boolean(element && element.scrollHeight > element.clientHeight + 2 && element.scrollTop + element.clientHeight < element.scrollHeight - 2)
}

onMounted(() => {
  if (tableScroll.value && typeof ResizeObserver !== 'undefined') {
    tableResizeObserver = new ResizeObserver(updateTableScrollAffordance)
    tableResizeObserver.observe(tableScroll.value)
  }
  updateTableScrollAffordance()
})

onBeforeUnmount(() => tableResizeObserver?.disconnect())

watch([filteredTypes, dialogOpen], async () => {
  await nextTick()
  updateTableScrollAffordance()
}, { flush: 'post' })

function shareFor(typequ: string, mode: AedarEquipmentModeKey): string {
  const fact = props.evidence.facts.find((item) => item.typequ === typequ)
  const value = fact?.measures[aedarEquipmentShareMeasureKey(horizonMinutes.value, mode)]
  return typeof value === 'number' && Number.isFinite(value) ? percent.format(value) : '—'
}

function openBucket(key: string) {
  if (!AEDAR_EQUIPMENT_BUCKET_HORIZONS.includes(horizonMinutes.value)) return
  selectedMode.value = key as AedarEquipmentBucketKey
  focusedTypequ.value = null
  followFocusedMode.value = false
  search.value = ''
  dialogOpen.value = true
}

function openEquipment(typequ: string, key: AedarEquipmentBucketKey) {
  selectedMode.value = key
  focusedTypequ.value = typequ
  followFocusedMode.value = true
  search.value = ''
  dialogOpen.value = true
}

function openExplorer() {
  selectedMode.value = 'all'
  focusedTypequ.value = null
  followFocusedMode.value = false
  search.value = ''
  dialogOpen.value = true
}

function selectMode(mode: AedarEquipmentBucketKey | 'all') {
  selectedMode.value = mode
  followFocusedMode.value = false
}

function closeDialog() {
  dialogOpen.value = false
}

watch(horizonMinutes, (horizon) => {
  if (!dialogOpen.value || !followFocusedMode.value || !focusedTypequ.value || profile.value?.status !== 'complete') return
  const mode = profile.value.buckets.find((item) => item.types.some((type) => type.typequ === focusedTypequ.value))
  if (mode) selectedMode.value = mode.key
  void horizon
})
</script>

<template>
  <figure class="aedar-waffle aedar-waffle--centered">
    <figcaption class="cahier-figure-title cahier-baseline-anchor">{{ evidence.figureTitle }}</figcaption>

    <div class="aedar-waffle-controls">
      <div class="aedar-waffle-horizon" role="group" aria-label="Temps de trajet">
        <span class="aedar-waffle-horizon-label type-figure-label">
          <Clock3 class="aedar-waffle-clock" :size="16" stroke-width="2" aria-hidden="true" />
          Temps de trajet
        </span>
        <div class="aedar-waffle-horizon-options">
          <button
            v-for="horizon in AEDAR_EQUIPMENT_BUCKET_HORIZONS"
            :key="horizon"
            class="aedar-waffle-horizon-link"
            type="button"
            :value="horizon"
            :aria-pressed="horizonMinutes === horizon"
            @click="horizonMinutes = horizon"
          >{{ horizon }} min</button>
        </div>
      </div>
    </div>

    <p v-if="profile?.status !== 'complete'" class="aedar-waffle-state" role="status">{{ summary }}</p>
    <template v-else>
      <div class="aedar-waffle-grid aedar-waffle-grid--five-rows" role="group" :aria-label="summary">
        <button
          v-for="(type, index) in profile.buckets.flatMap((item) => item.types.map((entry) => ({ ...entry, bucket: item.key, bucketLabel: item.label })))"
          :key="type.typequ"
          class="aedar-waffle-tile"
          :data-bucket="type.bucket"
          :data-typequ="type.typequ"
          :style="{ order: index }"
          :aria-label="`${type.label}, ${type.typequ}, ${type.bucketLabel}. Afficher le détail.`"
          :title="`${type.label} (${type.typequ}) — ${type.bucketLabel}`"
          type="button"
          @click="openEquipment(type.typequ, type.bucket)"
        />
      </div>
      <CahierFigureLegend
        class="aedar-waffle-legend--centered"
        :entries="bucketEntries"
        :icons="modeIcons"
        :action-keys="bucketEntries.map((entry) => entry.key)"
        :counts="bucketCounts"
        :mark-colors="bucketColors"
        label="Types par premier mode d’accès — ouvrir le détail d’une catégorie"
        @activate="openBucket"
      />
      <button class="aedar-waffle-explore" type="button" @click="openExplorer">Parcourir les équipements</button>
    </template>

    <CahierDialog
      v-if="profile?.status === 'complete'"
      :open="dialogOpen"
      :title="title ?? evidence.figureTitle"
      labelled-by="aedar-waffle-dialog-title"
      @close="closeDialog"
    >
        <template #toolbar>
          <div class="aedar-waffle-dialog-horizon aedar-waffle-field" role="group" aria-label="Temps de trajet dans l’exploration">
            <span class="aedar-waffle-field-label type-figure-label">Temps de trajet</span>
            <div class="aedar-waffle-field-control">
              <button v-for="horizon in AEDAR_EQUIPMENT_BUCKET_HORIZONS" :key="horizon" type="button" :aria-pressed="horizonMinutes === horizon" @click="horizonMinutes = horizon">{{ horizon }} min</button>
            </div>
          </div>
          <label class="aedar-waffle-search aedar-waffle-field">
            <span class="aedar-waffle-field-label type-figure-label">Rechercher un équipement</span>
            <input v-model="search" type="search" aria-label="Nom ou code BPE" placeholder="Nom ou code BPE" autofocus />
          </label>
        </template>
        <div class="aedar-waffle-mode-filter" role="group" aria-label="Filtrer par mode d’accès">
          <button type="button" data-mode="all" :aria-pressed="selectedMode === 'all'" @click="selectMode('all')">
            Tous les modes
          </button>
          <button
            v-for="item in profile.buckets"
            :key="item.key"
            type="button"
            :data-mode="item.key"
            :aria-pressed="selectedMode === item.key"
            :style="{ '--mode-color': bucketColors[item.key] }"
            @click="selectMode(item.key)"
          >
            <component :is="modeIcons[bucketPresentation[item.key].iconKey!]" v-if="bucketPresentation[item.key].iconKey" :size="16" aria-hidden="true" />
            <span v-else aria-hidden="true">∅</span>
            {{ item.label }} <span class="aedar-waffle-mode-count">{{ item.count }}</span>
          </button>
        </div>
        <p class="aedar-waffle-table-explanation">Part des adresses résidentielles situées à {{ horizonMinutes }} minutes ou moins par mode de transport. Les catégories d’équipements BPE sont classées selon le mode le plus lent qui permet à au moins {{ percent.format(evidence.threshold) }} des adresses d’y accéder.</p>
        <div class="aedar-waffle-table-frame">
          <div ref="tableScroll" class="aedar-waffle-table-scroll" @scroll="updateTableScrollAffordance">
          <table class="aedar-waffle-share-table">
            <thead>
              <tr>
                <th scope="col">Type d’équipement</th>
                <th v-for="mode in shareModes" :key="mode.key" scope="col">{{ mode.label }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="type in filteredTypes" :key="type.typequ" class="aedar-waffle-dialog-row" :class="{ 'is-highlighted': type.typequ === focusedTypequ }" :style="{ '--mode-color': bucketColors[type.bucket] }" :data-typequ="type.typequ" :aria-current="type.typequ === focusedTypequ ? 'true' : undefined">
                <th scope="row"><span>{{ type.label }}</span><code>{{ type.typequ }}</code></th>
                <td
                  v-for="mode in shareModes"
                  :key="mode.key"
                  :data-mode="mode.key"
                  :class="{ 'is-classifying-bucket': type.bucket === mode.key }"
                >{{ shareFor(type.typequ, mode.key) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="filteredTypes.length === 0" class="aedar-waffle-empty">Aucun type ne correspond à cette recherche.</p>
          </div>
          <div v-if="canScrollTable" class="aedar-waffle-scroll-cue" aria-hidden="true"><ChevronDown :size="20" :stroke-width="2.5" /></div>
        </div>
    </CahierDialog>
  </figure>
</template>

<style scoped>
.aedar-waffle {
  display: grid;
  justify-items: center;
  gap: var(--space-4);
  width: 100%;
  margin: 0;
  text-align: center;
  font-family: var(--font-body);
}
.aedar-waffle > .cahier-figure-title { width: 100%; margin: 0; text-align: center; }
.aedar-waffle-controls { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: var(--space-3) var(--space-5); width: 100%; }
.aedar-waffle-horizon { display: grid; justify-items: center; gap: var(--space-2); }
.aedar-waffle-horizon-label { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--cahier-default); font: var(--type-figure-label); letter-spacing: var(--type-figure-label-tracking); }
.aedar-waffle-clock { flex: 0 0 auto; }
.aedar-waffle-horizon-options { display: inline-flex; flex-wrap: wrap; justify-content: center; gap: var(--space-3) var(--space-5); padding: 0; border: 0; background: transparent; }
.aedar-waffle-horizon-options button { min-height: 36px; padding: var(--space-2) var(--space-3); border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--text-secondary); font: var(--type-figure-label); cursor: pointer; }
.aedar-waffle-explore { min-height: 36px; padding: var(--space-2) 0; border: 0; border-radius: 0; background: transparent; color: var(--red, var(--cahier-theme-strong)); font: var(--type-figure-label); font-weight: 700; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 0.22em; cursor: pointer; }
.aedar-waffle-explore:hover { text-decoration-thickness: 2px; }
.aedar-waffle-horizon-options .aedar-waffle-horizon-link { padding-inline: 0; border-radius: 0; background: transparent; color: var(--text-secondary); text-decoration: underline; text-underline-offset: 0.2em; box-shadow: none; }
.aedar-waffle-horizon-options .aedar-waffle-horizon-link[aria-pressed='true'] { color: var(--text-primary); font-weight: 700; text-decoration-color: currentColor; background: transparent; box-shadow: none; }
.aedar-waffle-horizon-options .aedar-waffle-horizon-link:hover { text-decoration-color: currentColor; }
.aedar-waffle-horizon-options button:focus-visible, .aedar-waffle-dialog button:focus-visible, .aedar-waffle-dialog input:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: 2px; }
.aedar-waffle-grid { display: grid; grid-template-rows: repeat(5, minmax(0, 1fr)); grid-auto-flow: column; grid-auto-columns: 1fr; gap: 2px; width: min(100%, 1000px); margin-inline: auto; }
.aedar-waffle-tile { display: block; aspect-ratio: 1; min-width: 0; padding: 0; border: 0; border-radius: 2px; background: var(--aedar-bucket-color); cursor: pointer; }
.aedar-waffle-tile:hover { filter: brightness(0.88); }
.aedar-waffle-tile:focus-visible { position: relative; z-index: 1; outline: 2px solid var(--text-primary); outline-offset: 1px; }
.aedar-waffle-tile[data-bucket='walk'] { --aedar-bucket-color: var(--cahier-mode-foot); }
.aedar-waffle-tile[data-bucket='transit'] { --aedar-bucket-color: color-mix(in oklab, var(--cahier-mode-foot) 68%, white); }
.aedar-waffle-tile[data-bucket='bike_lts2'] { --aedar-bucket-color: var(--cahier-mode-bike); }
.aedar-waffle-tile[data-bucket='bike_lts4'] { --aedar-bucket-color: color-mix(in oklab, var(--cahier-mode-bike) 68%, white); }
.aedar-waffle-tile[data-bucket='car'] { --aedar-bucket-color: var(--cahier-mode-car); }
.aedar-waffle-tile[data-bucket='inaccessible'] { --aedar-bucket-color: var(--text-tertiary); }
.aedar-waffle :deep(.aedar-waffle-legend--centered) { justify-content: center; width: 100%; margin: 0; }
.aedar-waffle :deep(.cahier-figure-legend-action) { min-height: 36px; }
.aedar-waffle-state { max-width: 72ch; margin: 0; color: var(--text-secondary); font: var(--type-figure-label); line-height: 1.5; }
/* Shared control primitive: a field is one label plus one control, so the
 * dialog's travel-time selector and search box read as the same object. */
.aedar-waffle-field { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.aedar-waffle-field-label { flex: 0 0 auto; color: var(--cahier-default); white-space: nowrap; }
.aedar-waffle-field-control { display: inline-flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.aedar-waffle-field-control button,
.aedar-waffle-field input { display: inline-flex; align-items: center; gap: var(--space-2); min-height: 36px; padding: var(--space-1) var(--space-2); border: 1px solid color-mix(in oklab, var(--cahier-default) 22%, transparent); border-radius: 0; background: transparent; color: var(--cahier-default); font: var(--type-figure-label); }
.aedar-waffle-field-control button { cursor: pointer; }
.aedar-waffle-field input { min-width: 0; flex: 1 1 auto; font: var(--text-body-sm); letter-spacing: normal; }
.aedar-waffle-search { flex: 1 1 260px; min-width: 0; }
.aedar-waffle-dialog-horizon { flex: 0 0 auto; }
.aedar-waffle-field-control button[aria-pressed='true'] { border-color: var(--brand-500); color: var(--brand-600); background: color-mix(in oklab, var(--brand-200) 24%, transparent); }
.aedar-waffle-field-control button:focus-visible, .aedar-waffle-field input:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: 2px; }
.aedar-waffle-mode-filter { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.aedar-waffle-mode-filter button { display: inline-flex; align-items: center; gap: var(--space-2); min-height: 36px; padding: var(--space-1) var(--space-2); border: 1px solid color-mix(in oklab, var(--cahier-default) 22%, transparent); border-radius: 0; background: transparent; color: var(--cahier-default); font: var(--type-figure-label); cursor: pointer; }
.aedar-waffle-mode-filter button[aria-pressed='true'] { border-color: var(--mode-color, var(--brand-500)); color: var(--mode-color, var(--brand-500)); background: color-mix(in oklab, var(--mode-color, var(--brand-500)) 10%, transparent); }
.aedar-waffle-mode-filter button:focus-visible { outline: 2px solid var(--red, var(--accent-primary)); outline-offset: 2px; }
.aedar-waffle-mode-count { font-variant-numeric: tabular-nums; }
.aedar-waffle-table-explanation { width: 100%; margin: 0; color: var(--cahier-default); font: var(--text-body-sm); }
.aedar-waffle-table-frame { position: relative; min-width: 0; }
.aedar-waffle-table-scroll { max-height: min(36dvh, 324px); min-height: 0; overflow: auto; border: 1px solid color-mix(in oklab, var(--cahier-default) 24%, transparent); border-radius: 0; }
.aedar-waffle-scroll-cue { position: absolute; right: 0; bottom: 1px; left: 0; display: grid; height: 34px; place-items: end center; padding-bottom: 3px; background: linear-gradient(to bottom, transparent, color-mix(in oklab, var(--paper, #f1f2ec) 94%, white)); color: var(--brand-600); pointer-events: none; }
.aedar-waffle-share-table { width: 100%; border-collapse: collapse; font: var(--type-figure-label); text-align: left; }
.aedar-waffle-share-table th, .aedar-waffle-share-table td { padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--border-subtle); }
.aedar-waffle-share-table thead { position: sticky; z-index: 1; top: 0; background: var(--paper, #f1f2ec); color: var(--cahier-default); }
.aedar-waffle-share-table thead th { min-width: 100px; font: var(--type-figure-label); letter-spacing: var(--type-figure-label-tracking); }
.aedar-waffle-share-table tbody th { min-width: 220px; color: var(--text-primary); font-weight: 500; }
.aedar-waffle-share-table tbody th span { display: block; }
.aedar-waffle-share-table code { color: var(--text-secondary); font-family: var(--font-metadata); font-size: 0.85em; }
.aedar-waffle-share-table td { color: var(--text-primary); font-family: var(--font-figure-value); font-variant-numeric: tabular-nums; white-space: nowrap; }
.aedar-waffle-share-table td.is-classifying-bucket { color: var(--mode-color); font-weight: 700; }
.aedar-waffle-share-table tbody tr.is-highlighted { outline: 2px solid var(--mode-color); outline-offset: -2px; background: color-mix(in oklab, var(--mode-color) 18%, var(--paper, #f1f2ec)); }
.aedar-waffle-share-table tbody tr.is-highlighted th::before { content: '→ '; color: var(--mode-color); }
.aedar-waffle-share-table tbody tr:last-child th, .aedar-waffle-share-table tbody tr:last-child td { border-bottom: 0; }
.aedar-waffle-empty { margin: 0; padding: var(--space-4); color: var(--text-secondary); text-align: center; }
@media (max-width: 760px) {
  .aedar-waffle-dialog-horizon { order: 1; flex: 1 1 auto; min-width: 0; }
  .aedar-waffle-search { order: 3; flex-basis: 100%; }
  .aedar-waffle-field-control { justify-content: center; }
}
@media (max-width: 520px) { .aedar-waffle-share-table thead th, .aedar-waffle-share-table th, .aedar-waffle-share-table td { padding-inline: var(--space-2); } .aedar-waffle-table-scroll { max-height: 36dvh; } }
</style>
