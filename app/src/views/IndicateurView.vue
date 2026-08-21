<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePayload } from '@/payload/usePayload'
import type { Fichier } from '@/payload/loader'
import { modeleExploration } from '@/indicateurs/explorationModel'
import type { NiveauIndicateur } from '@/indicateurs/explorationModel'
import MapExplorer from '@/components/carte/MapExplorer.vue'
import { useGeometrie } from '@/geo/useGeometrie'
import type { NiveauMasque } from '@/geo/types'
import type { Couche } from '@/carte/coucheModel'
import { THEMES_CANONIQUES } from '@/payload/types'
import type { Theme } from '@/payload/types'
import { themeStyle } from '@/indicateurs/themeTokens'
import { formaterNombreFR } from '@/payload/selectors'

const route = useRoute(); const router = useRouter(); const recherche = ref(String(route.query.recherche ?? ''))
const theme = String(route.params.theme); const indicator = String(route.params.indicator)
const themeValide = (THEMES_CANONIQUES as readonly string[]).includes(theme)
const attendre: Fichier[] = themeValide ? ['territoires', `indicateurs_${theme as Theme}`, `theme_${theme as Theme}`] : ['territoires']
const { payload, erreur, chargement } = usePayload({ attendre })
const geometrie = useGeometrie()
const metadata = computed(() => payload.value.themeMetadata?.[theme as keyof typeof payload.value.themeMetadata])
const page = computed(() => metadata.value?.indicator_pages?.[indicator])
const sources = computed(() => page.value?.sources.map((id) => metadata.value?.source_records?.[id]).filter((source): source is NonNullable<typeof source> => Boolean(source)) ?? [])
const facts = computed(() => payload.value.indicateurs.filter((f) => f.theme === theme && f.key === indicator))
const requested = computed(() => ({ niveau: ['commune', 'epci', 'departement'].includes(String(route.query.niveau)) ? route.query.niveau as NiveauIndicateur : undefined, departement: typeof route.query.departement === 'string' ? route.query.departement : undefined, epci: typeof route.query.epci === 'string' ? route.query.epci : undefined, territoire: typeof route.query.territoire === 'string' ? route.query.territoire : undefined, recherche: recherche.value }))
const model = computed(() => page.value && metadata.value ? modeleExploration(facts.value, metadata.value, payload.value.territoires, requested.value, localStorage.getItem('lusk:niveau-indicateur') ?? undefined, indicator) : null)
const themeVars = computed(() => themeValide ? themeStyle(theme as Theme) : undefined)
const payloadCarte = computed(() => {
  if (!model.value) return payload.value
  const ids = new Set(payload.value.territoires.filter((territory) => territory.type === model.value!.state.niveau && (model.value!.state.niveau !== 'commune' || ((!model.value!.state.departement || territory.departement === model.value!.state.departement) && (!model.value!.state.epci || territory.epci === model.value!.state.epci)))).map((territory) => territory.territoire))
  return { ...payload.value, indicateurs: payload.value.indicateurs.filter((fact) => fact.theme !== theme || (fact.key === indicator && fact.type === model.value!.state.niveau && ids.has(fact.territoire))) }
})
const vue = computed(() => route.query.vue === 'carte' || route.query.vue === 'indicateur' ? route.query.vue : 'reperes')
const couche = computed<Couche | null>(() => page.value ? ({ source: 'indicateur', clef: indicator, detail: page.value.detail ?? null, libelle: page.value.label, parDefaut: true, sousGroupe: null, storyKey: null }) : null)
const niveauMasque = computed<NiveauMasque>(() => model.value?.state.niveau === 'epci' ? 'epcis' : model.value?.state.niveau === 'departement' ? 'departements' : 'communes')
const territoireCible = computed(() => payload.value.territoires.find((t) => t.territoire === route.query.territoire && t.type === model.value?.state.niveau) ?? null)
function normalizedQuery(extra: Record<string, string | undefined> = {}) { const next = { ...route.query, ...extra }; if (next.niveau !== 'commune') { delete next.departement; delete next.epci }; return next }
function setQuery(key: string, value: string) { router.replace({ query: normalizedQuery({ [key]: value || undefined }) }) }
function setVue(value: 'reperes' | 'carte' | 'indicateur') { router.replace({ query: normalizedQuery({ vue: value === 'reperes' ? undefined : value }) }) }
if (route.query.vue !== undefined && route.query.vue !== 'carte' && route.query.vue !== 'indicateur') void router.push({ path: route.path, query: normalizedQuery({ vue: undefined }) })
watch(() => model.value?.state.niveau, (niveau) => { if (niveau && niveau !== route.query.niveau) router.replace({ query: normalizedQuery({ niveau }) }) }, { immediate: true })
watch(() => route.query.niveau, (niveau) => { if (typeof niveau === 'string' && ['commune', 'epci', 'departement'].includes(niveau)) localStorage.setItem('lusk:niveau-indicateur', niveau) }, { immediate: true })
watch(() => route.query.vue, (value) => { if (value !== undefined && value !== 'carte' && value !== 'indicateur') router.replace({ query: normalizedQuery({ vue: undefined }) }) }, { immediate: true })
</script>
<template>
  <section class="indicateur-page" :class="`theme-${theme}`" :style="themeVars">
    <div v-if="chargement" role="status">Chargement de l’indicateur…</div><div v-else-if="erreur" role="alert">Impossible de charger l’indicateur.</div><div v-else-if="!page || !model" role="alert">Indicateur introuvable.</div>
    <template v-else>
      <header><p class="sur-titre">{{ metadata?.label }}</p><h1>{{ page.label }}</h1><p>{{ page.definition }}</p></header>
      <nav class="vues" aria-label="Vues de l’indicateur"><button :class="{ active: vue === 'reperes' }" @click="setVue('reperes')">Repères</button><button :class="{ active: vue === 'carte' }" @click="setVue('carte')">Carte</button><button :class="{ active: vue === 'indicateur' }" @click="setVue('indicateur')">L’indicateur</button></nav>
      <main v-if="vue === 'reperes'"><div class="hero"><article class="median"><span>Médiane</span><strong>{{ model!.median === null ? '—' : formaterNombreFR(model!.median, 2) }} <small>{{ page.unit }}</small></strong><p>{{ model!.scopeLabel }}</p></article><article class="distribution"><h2>Distribution</h2><svg class="density" viewBox="0 0 600 180" role="img" aria-label="Densité des valeurs"><path :d="`M ${model!.density.map((point, index) => `${index * (600 / Math.max(model!.density.length - 1, 1))},${20 + point.y * 1.5}`).join(' L ')}`" /><circle v-if="model!.markerX !== null && model!.markerY !== null" :cx="model!.markerX! * 6" :cy="20 + model!.markerY! * 1.5" r="7" class="point-highlight" /></svg></article></div>
         <div class="extremes"><article><h2>Valeurs les plus hautes</h2><span v-if="model!.high.count > 1">{{ model!.high.count }} territoires à égalité</span><RouterLink v-for="row in model!.high.rows" :key="row.territoire.territoire" :to="row.fiche">{{ row.territoire.nom }} · {{ row.value }} {{ page.unit }}</RouterLink></article><article><h2>Valeurs les plus basses</h2><span v-if="model!.low.count > 1">{{ model!.low.count }} territoires à égalité</span><RouterLink v-for="row in model!.low.rows" :key="row.territoire.territoire" :to="row.fiche">{{ row.territoire.nom }} · {{ row.value }} {{ page.unit }}</RouterLink></article></div>
         <div class="controls"><label>Niveau <select :value="model!.state.niveau" @change="setQuery('niveau', ($event.target as HTMLSelectElement).value)"><option v-for="niveau in page.levels" :key="niveau" :value="niveau">{{ niveau === 'commune' ? 'Communes' : niveau === 'epci' ? 'EPCI' : 'Départements' }}</option></select></label><label v-if="model!.state.niveau === 'commune'">Département <input :value="route.query.departement ?? ''" @input="setQuery('departement', ($event.target as HTMLInputElement).value)" /></label><label v-if="model!.state.niveau === 'commune'">EPCI <input :value="route.query.epci ?? ''" @input="setQuery('epci', ($event.target as HTMLInputElement).value)" /></label><label>Rechercher <input v-model="recherche" @input="setQuery('recherche', recherche)" /></label></div>
         <table><caption>Territoires comparables — {{ model!.scopeLabel }}</caption><thead><tr><th>Territoire</th><th>Valeur</th><th>Rang</th><th /></tr></thead><tbody><tr v-for="row in model!.rows" :key="row.territoire.territoire" :class="{ selection: row.highlighted }"><td><RouterLink :to="row.fiche">{{ row.territoire.nom }}</RouterLink></td><td>{{ row.value }} {{ page.unit }}</td><td>{{ row.rang }}</td><td><button type="button" @click="setQuery('territoire', row.territoire.territoire)">Voir sur la distribution</button></td></tr></tbody></table>
      </main>
      <section v-else-if="vue === 'carte'" class="carte-indicateur"><div v-if="geometrie.masques.value" class="map-wrap"><MapExplorer :masques="geometrie.masques.value" :payload="payloadCarte" :theme="theme as Theme" :couche="couche" :niveau="niveauMasque" :territoire-cible="territoireCible" :requete-zoom="Number(Boolean(route.query.territoire))" /></div><div v-else role="status">Chargement de la carte…</div></section>
      <aside v-else><h2>L’indicateur</h2><dl><dt>Définition</dt><dd>{{ page.definition }}</dd><dt>Unité</dt><dd>{{ page.unit }}</dd><dt>Calcul</dt><dd>{{ page.calculation }}</dd><dt>Direction</dt><dd>{{ page.direction }}</dd><dt>Précautions</dt><dd>{{ page.caveats }}</dd><dt>Vintage</dt><dd>{{ page.vintage }}</dd></dl><div v-for="source in sources" :key="source.dataset"><h3>{{ source.dataset }}</h3><a :href="source.url">{{ source.publisher }}</a><p>{{ source.licence }} · {{ source.vintage }} · {{ source.freshness }}</p></div></aside>
    </template>
  </section>
</template>
<style scoped>
.indicateur-page{min-height:100%;padding:clamp(24px,5vw,64px) max(16px,calc((100% - 1200px)/2));background:var(--surface-secondary);color:var(--text-primary)}header{max-width:760px}h1{font:var(--text-h1);margin:.3rem 0 1rem}h2{font:var(--text-h3)}.sur-titre{color:var(--indicateur-strong);font:var(--text-overline);text-transform:uppercase}.vues{display:flex;gap:24px;margin:32px 0;border-bottom:1px solid var(--border-default);padding-bottom:12px}.vues button.active{border-bottom:3px solid var(--indicateur-accent);font-weight:700}.hero,.extremes{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}.hero article,.extremes article,aside{padding:24px;background:var(--surface-primary);border:1px solid var(--border-default);border-radius:12px;margin-bottom:16px}.median strong{display:block;font:600 clamp(3rem,9vw,7rem)/1 var(--font-serif);margin:20px 0}.median small{font:var(--text-body)}.density{width:100%;height:170px;border-bottom:2px solid var(--indicateur-line)}.density path{fill:none;stroke:var(--indicateur-accent);stroke-width:4}.point-highlight{fill:var(--status-error)}.extremes article{display:flex;flex-direction:column;gap:8px}.controls{display:flex;gap:16px;flex-wrap:wrap;margin:24px 0}label{display:flex;flex-direction:column;gap:4px}select,input{padding:8px;border:1px solid var(--border-default);border-radius:6px}table{width:100%;border-collapse:collapse;background:var(--surface-primary)}th,td{padding:12px;border-bottom:1px solid var(--border-subtle);text-align:left}tr.selection{background:var(--indicateur-soft)}button{border:0;background:none;color:var(--accent-primary);cursor:pointer}.carte-indicateur,.map-wrap{min-height:540px}dt{font-weight:700;margin-top:12px}dd{margin:0}@media(max-width:700px){.hero,.extremes{grid-template-columns:1fr}table{font-size:.85rem}}
</style>
