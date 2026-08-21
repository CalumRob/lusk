<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

// PROTOTYPE THROWAWAY — issue #399. This file intentionally does not define a
// production indicator contract or a reusable renderer. It is a visual fork.
type Fact = { territoire: string; type: string; key: string; value: number | null }
type Territory = { territoire: string; nom: string; type: string; departement?: string; epci?: string }
type Row = Omit<Fact, 'value'> & { value: number; nom: string }
type Variant = 'atlas' | 'focus' | 'tableau'
type DistributionBin = { from: number; to: number; count: number }

const route = useRoute()
const router = useRouter()
const isDev = import.meta.env.DEV
const facts = ref<Fact[]>([])
const territories = ref<Territory[]>([])
const loading = ref(true)
const error = ref('')
const variants: Variant[] = ['atlas', 'focus', 'tableau']
const variant = computed<Variant>(() => variants.includes(route.query.variant as Variant) ? route.query.variant as Variant : 'atlas')

const rows = computed<Row[]>(() => {
  const names = new Map(territories.value.map((territory) => [territory.territoire, territory.nom]))
  return facts.value
    .filter((fact) => fact.type === 'commune' && fact.key === 'densite' && fact.value !== null)
    .map((fact) => ({ ...fact, value: fact.value as number, nom: names.get(fact.territoire) ?? fact.territoire }))
    .sort((a, b) => b.value - a.value)
})
const values = computed(() => rows.value.map((row) => row.value))
const stats = computed(() => {
  const sorted = [...values.value].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const median = sorted.length === 0 ? 0 : sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
  const low = sorted[0] ?? 0
  const high = sorted.at(-1) ?? 0
  return {
    median,
    low,
    high,
    lowCount: sorted.filter((value) => value === low).length,
    highCount: sorted.filter((value) => value === high).length,
  }
})
const highRows = computed(() => rows.value.filter((row) => row.value === stats.value.high))
const lowRows = computed(() => rows.value.filter((row) => row.value === stats.value.low))
const distributionBins = computed<DistributionBin[]>(() => {
  const sorted = [...values.value].sort((a, b) => a - b)
  if (!sorted.length) return []
  const binCount = Math.min(12, sorted.length)
  return Array.from({ length: binCount }, (_, index) => {
    const start = Math.floor(index * sorted.length / binCount)
    const end = Math.floor((index + 1) * sorted.length / binCount)
    return { from: sorted[start], to: sorted[Math.max(start, end - 1)], count: end - start }
  })
})
const middleRows = computed(() => {
  const median = stats.value.median
  return rows.value.filter((row) => row.value >= median * 0.75 && row.value <= median * 1.25).slice(0, 12)
})
const tableRows = computed(() => rows.value.slice(0, 18))

function format(value: number) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)
}
function goTo(next: Variant) {
  void router.replace({ query: { ...route.query, variant: next } })
}
function cycle(direction: number) {
  const index = variants.indexOf(variant.value)
  goTo(variants[(index + direction + variants.length) % variants.length])
}
function onKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return
  if (event.key === 'ArrowRight') cycle(1)
  if (event.key === 'ArrowLeft') cycle(-1)
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  try {
    const [factsResponse, territoriesResponse] = await Promise.all([
      fetch('/data/indicateurs_demographie.json'),
      fetch('/data/territoires.json'),
    ])
    if (!factsResponse.ok || !territoriesResponse.ok) throw new Error('Payload indisponible')
    facts.value = await factsResponse.json() as Fact[]
    territories.value = await territoriesResponse.json() as Territory[]
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Impossible de charger les données.'
  } finally {
    loading.value = false
  }
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="prototype-page">
    <div v-if="isDev" class="prototype-switcher" aria-label="Variantes du prototype">
      <span>Prototype · Repères</span>
      <button v-for="(name, index) in variants" :key="name" :class="{ active: variant === name }" @click="goTo(name)">
        {{ index + 1 }} · {{ name }}
      </button>
      <small>← →</small>
    </div>

    <header class="prototype-heading">
      <p class="eyebrow">Direction {{ variant }} · prototype jetable #399</p>
      <h1>Repères scalaires</h1>
      <p class="lede">Densité de population des communes bretonnes, pour éprouver la hiérarchie d’une future Page d’indicateur.</p>
      <p class="source">Démographie · densité · communes · données publiées Lusk</p>
    </header>

    <p v-if="loading" class="state">Chargement des faits territoriaux…</p>
    <p v-else-if="error" class="state error">{{ error }}</p>
    <template v-else>
      <!-- Direction A: one large reference number, then an editorial distribution strip. -->
      <section v-if="variant === 'atlas'" class="atlas-layout">
        <article class="hero-card">
          <p class="eyebrow">La médiane · {{ rows.length }} communes</p>
          <strong>{{ format(stats.median) }}</strong><span> hab./km²</span>
          <p>La moitié des communes se situe sous cette valeur, l’autre moitié au-dessus.</p>
        </article>
        <div class="atlas-grid">
          <article class="card distribution-card">
            <p class="eyebrow">Distribution</p><h2>Une échelle très étirée</h2>
            <div class="bars"><i v-for="bin in distributionBins" :key="`${bin.from}-${bin.to}`" :style="{ height: `${Math.max(8, bin.count / Math.max(...distributionBins.map((item) => item.count)) * 100)}%` }" :title="`${bin.count} communes · ${format(bin.from)}–${format(bin.to)} hab./km²`" /></div>
            <div class="axis"><span>{{ format(distributionBins[0]?.from ?? 0) }}</span><span>médiane {{ format(stats.median) }}</span><span>{{ format(distributionBins.at(-1)?.to ?? 0) }}</span></div>
          </article>
          <article class="card extremes-card"><p class="eyebrow">Extrêmes neutres</p><h2>Valeurs les plus hautes</h2><p v-if="highRows.length === 1"><b><RouterLink :to="`/territoire/commune/${highRows[0].territoire}`">{{ highRows[0].nom }}</RouterLink></b> · {{ format(stats.high) }} hab./km².</p><p v-else><b>{{ highRows.length }} communes</b> partagent la valeur maximale : {{ format(stats.high) }} hab./km².</p><h2>Valeurs les plus basses</h2><p v-if="lowRows.length === 1"><b><RouterLink :to="`/territoire/commune/${lowRows[0].territoire}`">{{ lowRows[0].nom }}</RouterLink></b> · {{ format(stats.low) }} hab./km².</p><p v-else><b>{{ lowRows.length }} communes</b> partagent la valeur minimale : {{ format(stats.low) }} hab./km².</p></article>
        </div>
        <article class="card table-card"><div class="section-head"><div><p class="eyebrow">Repères dans les communes</p><h2>Les valeurs les plus élevées</h2></div><span>Classement indicatif</span></div><table><tbody><tr v-for="row in tableRows.slice(0, 8)" :key="row.territoire"><td><RouterLink :to="`/territoire/commune/${row.territoire}`">{{ row.nom }}</RouterLink></td><td>{{ format(row.value) }} hab./km²</td></tr></tbody></table></article>
      </section>

      <!-- Direction B: a quiet statistical dashboard with the median as anchor. -->
      <section v-else-if="variant === 'focus'" class="focus-layout">
        <article class="focus-card"><p class="eyebrow">Repère central</p><h2>La densité médiane des communes</h2><div class="focus-number">{{ format(stats.median) }} <small>hab./km²</small></div><p>Une commune située à {{ format(stats.median * 2.4) }} hab./km² est à <b>2,4 fois la médiane</b> : une comparaison de ratio adaptée à une densité.</p><div class="range"><span>plus bas<br><b>{{ format(stats.low) }}</b></span><div><i :style="{ left: `${Math.min(94, stats.median / stats.high * 100)}%` }" /></div><span>plus haut<br><b>{{ format(stats.high) }}</b></span></div></article>
        <div class="focus-side"><article class="stat-block"><span>Valeur la plus haute</span><strong>{{ format(stats.high) }}</strong><small v-if="highRows.length > 1">{{ highRows.length }} communes à égalité</small><RouterLink v-else :to="`/territoire/commune/${highRows[0].territoire}`">{{ highRows[0].nom }}</RouterLink></article><article class="stat-block"><span>Valeur la plus basse</span><strong>{{ format(stats.low) }}</strong><small v-if="lowRows.length > 1">{{ lowRows.length }} communes à égalité</small><RouterLink v-else :to="`/territoire/commune/${lowRows[0].territoire}`">{{ lowRows[0].nom }}</RouterLink></article></div>
        <article class="card quiet-table"><div class="section-head"><div><p class="eyebrow">Densités proches du centre</p><h2>Autour de la médiane</h2></div><span>{{ middleRows.length }} communes affichées</span></div><div class="row-list"><RouterLink v-for="row in middleRows" :key="row.territoire" :to="`/territoire/commune/${row.territoire}`"><span>{{ row.nom }}</span><b>{{ format(row.value) }}</b><em>{{ (row.value / stats.median).toFixed(1).replace('.', ',') }}×</em></RouterLink></div></article>
      </section>

      <!-- Direction C: territory table first; the distribution is a compact side rail. -->
      <section v-else class="tableau-layout">
        <article class="table-intro"><p class="eyebrow">Vue tableau · lecture exacte</p><h2>Chaque commune, une valeur</h2><p>Le tableau devient le point d’entrée. La médiane reste visible pour situer chaque ligne dans la distribution.</p><div class="mini-median"><span>Médiane</span><strong>{{ format(stats.median) }}</strong><span>hab./km²</span></div></article>
        <aside class="distribution-rail"><p class="eyebrow">Distribution · 12 quantiles</p><div v-for="bin in distributionBins" :key="`${bin.from}-${bin.to}`" class="rail-row"><span>{{ format(bin.from) }}–{{ format(bin.to) }}</span><i><b :style="{ width: `${bin.count / Math.max(...distributionBins.map((item) => item.count)) * 100}%` }" /></i><small>{{ bin.count }} communes</small></div><hr><p><b>{{ highRows.length }}</b> extrême{{ highRows.length > 1 ? 's' : '' }} haut · <b>{{ lowRows.length }}</b> bas</p></aside>
        <article class="card full-table"><div class="section-head"><div><p class="eyebrow">Communes · densité décroissante</p><h2>Repères exacts</h2></div><span>{{ rows.length }} lignes publiées</span></div><table><thead><tr><th>Commune</th><th>Valeur</th><th>Écart à la médiane</th></tr></thead><tbody><tr v-for="row in tableRows" :key="row.territoire"><td><RouterLink :to="`/territoire/commune/${row.territoire}`">{{ row.nom }}</RouterLink></td><td><b>{{ format(row.value) }}</b> hab./km²</td><td>{{ row.value >= stats.median ? '+' : '' }}{{ format(row.value - stats.median) }}</td></tr></tbody></table></article>
      </section>
    </template>
    <footer class="prototype-note">Prototype visuel · données réelles publiées · aucune décision de production prise. Le verdict produit est attendu sur cette PR.</footer>
  </div>
</template>

<style scoped>
.prototype-page { width: min(1180px, calc(100% - 40px)); margin: 0 auto; padding: 72px 0 48px; color: var(--text-primary); }
.prototype-switcher { position: fixed; z-index: 10; right: 20px; bottom: 20px; display: flex; gap: 5px; align-items: center; padding: 8px 10px; border: 1px solid var(--border-default); border-radius: 999px; background: rgba(255,255,255,.95); box-shadow: 0 8px 30px rgba(45,55,72,.12); font-size: .72rem; }
.prototype-switcher button { border: 0; border-radius: 999px; padding: 5px 8px; color: var(--text-secondary); background: transparent; cursor: pointer; }.prototype-switcher button.active { background: var(--theme-demographie-soft); color: var(--theme-demographie-strong); font-weight: 700; }.prototype-switcher small { color: var(--text-tertiary); }
.prototype-heading { max-width: 760px; margin-bottom: 48px; }.eyebrow { margin: 0 0 8px; color: var(--theme-demographie-strong); font-size: .72rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }.prototype-heading h1 { margin: 0 0 12px; font: var(--text-display); }.lede { max-width: 650px; margin: 0 0 12px; font: var(--text-body-lg); }.source, .prototype-note { color: var(--text-secondary); font-size: .8rem; }.card, .hero-card, .focus-card, .table-intro, .distribution-rail, .stat-block { border: 1px solid var(--border-default); border-radius: 14px; background: var(--surface-primary); }.card { padding: 24px; }.card h2, .table-intro h2, .focus-card h2 { margin: 0 0 16px; font: var(--text-h2); }.hero-card { padding: 36px; background: var(--theme-demographie-wash); }.hero-card strong { font: var(--text-display); font-variant-numeric: tabular-nums; }.hero-card span { font-size: 1.1rem; }.hero-card p:last-child { max-width: 480px; margin: 12px 0 0; }.atlas-grid { display: grid; grid-template-columns: 1.6fr 1fr; gap: 20px; margin: 20px 0; }.bars { display: flex; align-items: end; gap: 5px; height: 160px; padding-top: 20px; border-bottom: 1px solid var(--border-default); }.bars i { flex: 1; min-width: 2px; border-radius: 4px 4px 0 0; background: var(--theme-demographie); opacity: .76; }.axis { display: flex; justify-content: space-between; color: var(--text-secondary); font-size: .72rem; }.extremes-card h2 { margin: 18px 0 4px; font-size: 1rem; }.extremes-card p { margin: 0; font-size: .9rem; }.section-head { display: flex; align-items: start; justify-content: space-between; gap: 16px; }.section-head > span { color: var(--text-secondary); font-size: .8rem; }.table-card table, .full-table table { width: 100%; border-collapse: collapse; }.table-card td, .full-table td, .full-table th { padding: 10px 4px; border-bottom: 1px solid var(--border-subtle); text-align: left; font-size: .88rem; }.table-card td:last-child, .full-table td:not(:first-child), .full-table th:not(:first-child) { text-align: right; }.table-card a, .full-table a { color: var(--text-primary); font-weight: 700; }.table-card a:hover, .full-table a:hover { color: var(--accent-primary); }
.focus-layout { display: grid; grid-template-columns: 1fr 240px; gap: 20px; }.focus-card { grid-row: span 2; padding: 40px; }.focus-number { margin: 28px 0 16px; font: var(--text-display); color: var(--theme-demographie-strong); }.focus-number small { font: var(--text-body); color: var(--text-secondary); }.range { display: grid; grid-template-columns: auto 1fr auto; gap: 12px; align-items: center; margin-top: 48px; color: var(--text-secondary); font-size: .75rem; }.range div { position: relative; height: 8px; border-radius: 8px; background: linear-gradient(90deg, var(--theme-demographie-soft), var(--theme-demographie)); }.range i { position: absolute; top: 50%; width: 16px; height: 16px; border: 3px solid white; border-radius: 50%; background: var(--theme-demographie-strong); box-shadow: 0 0 0 1px var(--theme-demographie-strong); transform: translate(-50%, -50%); }.stat-block { display: flex; flex-direction: column; justify-content: center; padding: 24px; }.stat-block span, .stat-block small { color: var(--text-secondary); font-size: .78rem; }.stat-block strong { margin: 8px 0; font-size: 1.8rem; }.quiet-table { grid-column: 1 / -1; }.row-list { display: grid; grid-template-columns: 1fr 1fr; gap: 0 24px; }.row-list a { display: grid; grid-template-columns: 1fr auto auto; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border-subtle); color: var(--text-primary); }.row-list b { font-variant-numeric: tabular-nums; }.row-list em { width: 40px; color: var(--text-secondary); font-size: .8rem; font-style: normal; text-align: right; }
.tableau-layout { display: grid; grid-template-columns: 1fr 300px; gap: 20px; }.table-intro, .distribution-rail { padding: 28px; }.table-intro p:not(.eyebrow) { max-width: 560px; }.mini-median { display: flex; align-items: baseline; gap: 8px; margin-top: 30px; color: var(--text-secondary); }.mini-median strong { color: var(--theme-demographie-strong); font-size: 2.5rem; }.distribution-rail { background: var(--theme-demographie-wash); }.rail-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: center; margin: 12px 0; font-size: .78rem; }.rail-row i { height: 8px; border-radius: 8px; background: var(--surface-primary); }.rail-row b { display: block; height: 100%; border-radius: inherit; background: var(--theme-demographie); }.distribution-rail hr { border: 0; border-top: 1px solid var(--border-default); margin: 24px 0; }.distribution-rail p:last-child { color: var(--text-secondary); font-size: .8rem; }.full-table { grid-column: 1 / -1; }.full-table th { color: var(--text-secondary); font-size: .72rem; text-transform: uppercase; }.state { padding: 40px; text-align: center; }.error { color: var(--status-error); }.prototype-note { margin-top: 40px; padding-top: 20px; border-top: 1px solid var(--border-default); }
@media (max-width: 760px) { .prototype-page { width: min(100% - 24px, 620px); padding-top: 40px; }.prototype-switcher { right: 12px; bottom: 12px; }.prototype-switcher > span, .prototype-switcher small { display: none; }.atlas-grid, .focus-layout, .tableau-layout { display: block; }.extremes-card, .distribution-rail, .stat-block, .table-intro { margin-top: 16px; }.row-list { grid-template-columns: 1fr; }.hero-card, .focus-card { padding: 24px; } }
</style>
