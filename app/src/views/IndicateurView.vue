<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePayload } from '@/payload/usePayload'
import { modeleExploration } from '@/indicateurs/explorationModel'

const route = useRoute(); const router = useRouter(); const recherche = ref(String(route.query.recherche ?? ''))
const theme = String(route.params.theme); const indicator = String(route.params.indicator)
const { payload, erreur, chargement } = usePayload({ attendre: ['territoires', `indicateurs_${theme}` as never, `theme_${theme}` as never] })
const metadata = computed(() => payload.value.themeMetadata?.[theme as keyof typeof payload.value.themeMetadata])
const page = computed(() => metadata.value?.scalar_page)
const facts = computed(() => payload.value.indicateurs.filter((f) => f.theme === theme && f.key === indicator))
const requested = computed(() => ({ niveau: typeof route.query.niveau === 'string' ? route.query.niveau : undefined, departement: typeof route.query.departement === 'string' ? route.query.departement : undefined, epci: typeof route.query.epci === 'string' ? route.query.epci : undefined, territoire: typeof route.query.territoire === 'string' ? route.query.territoire : undefined, recherche: recherche.value }))
const model = computed(() => metadata.value ? modeleExploration(facts.value, metadata.value, payload.value.territoires, requested.value, localStorage.getItem('lusk:niveau-indicateur') ?? undefined) : null)
watch(() => model.value?.state.niveau, (niveau) => { if (niveau && niveau !== route.query.niveau) { localStorage.setItem('lusk:niveau-indicateur', niveau); router.replace({ query: { ...route.query, niveau } }) } }, { immediate: true })
function setQuery(key: string, value: string) { router.replace({ query: { ...route.query, [key]: value || undefined } }) }
</script>
<template>
  <section class="indicateur-page" :class="`theme-${theme}`">
    <div v-if="chargement" role="status">Chargement de l’indicateur…</div>
    <div v-else-if="erreur" role="alert">Impossible de charger l’indicateur.</div>
    <template v-else-if="page && model">
      <header><p class="sur-titre">{{ metadata?.label }}</p><h1>{{ page.label }}</h1><p>{{ page.definition }}</p></header>
      <nav class="vues" aria-label="Vues de l’indicateur"><a href="#reperes">Repères</a><a href="#carte">Carte</a><a href="#indicateur">L’indicateur</a></nav>
      <main id="reperes">
        <div class="hero"><article class="median"><span>Médiane</span><strong>{{ model.median ?? '—' }} <small>{{ page.unit }}</small></strong><p>{{ model.scopeLabel }}</p></article><article id="carte" class="distribution"><h2>Distribution</h2><div class="density" aria-label="Distribution des valeurs"><i v-for="(value, index) in model.distribution" :key="index" :style="{ height: `${20 + (value / Math.max(...model.distribution, 1)) * 70}%` }" /></div></article></div>
        <div class="extremes"><article><h2>Valeurs les plus hautes</h2><RouterLink v-for="row in model.high" :key="row.territoire.territoire" :to="row.fiche">{{ row.territoire.nom }} · {{ row.value }} {{ page.unit }}</RouterLink></article><article><h2>Valeurs les plus basses</h2><RouterLink v-for="row in model.low" :key="row.territoire.territoire" :to="row.fiche">{{ row.territoire.nom }} · {{ row.value }} {{ page.unit }}</RouterLink></article></div>
        <div class="controls"><label>Niveau <select :value="model.state.niveau" @change="setQuery('niveau', ($event.target as HTMLSelectElement).value)"><option v-for="niveau in page.levels" :key="niveau" :value="niveau">{{ niveau === 'commune' ? 'Communes' : niveau === 'epci' ? 'EPCI' : 'Départements' }}</option></select></label><label>Rechercher <input v-model="recherche" @input="setQuery('recherche', recherche)" /></label></div>
        <table><caption>Territoires comparables — {{ model.scopeLabel }}</caption><thead><tr><th>Territoire</th><th>Valeur</th><th>Rang</th><th /></tr></thead><tbody><tr v-for="row in model.rows" :key="row.territoire.territoire" :class="{ selection: row.highlighted }"><td><RouterLink :to="row.fiche">{{ row.territoire.nom }}</RouterLink></td><td>{{ row.value }} {{ page.unit }}</td><td>{{ row.rang }}</td><td><button type="button" @click="setQuery('territoire', row.territoire.territoire)">Voir sur la distribution</button></td></tr></tbody></table>
      </main>
      <aside id="indicateur"><h2>L’indicateur</h2><dl><dt>Définition</dt><dd>{{ page.definition }}</dd><dt>Calcul</dt><dd>{{ page.calculation }}</dd><dt>Direction</dt><dd>{{ page.direction }}</dd><dt>Précautions</dt><dd>{{ page.caveats }}</dd><dt>Vintage</dt><dd>{{ page.vintage }}</dd></dl><div v-for="source in page.sources" :key="source.dataset"><h3>{{ source.dataset }}</h3><a :href="source.url">{{ source.publisher }}</a><p>{{ source.licence }} · {{ source.vintage }}</p></div></aside>
    </template>
  </section>
</template>
<style scoped>
.indicateur-page { min-height:100%; padding:clamp(24px,5vw,64px) max(16px,calc((100% - 1200px)/2)); background:var(--surface-secondary); color:var(--text-primary) } header { max-width:760px } h1 { font:var(--text-h1); margin:.3rem 0 1rem } h2 { font:var(--text-h3) } .sur-titre { color:var(--theme-demographie-strong); font:var(--text-overline); text-transform:uppercase } .vues { display:flex; gap:24px; margin:32px 0; border-bottom:1px solid var(--border-default); padding-bottom:12px } .hero,.extremes { display:grid; grid-template-columns:repeat(2,1fr); gap:16px } .hero article,.extremes article,#indicateur { padding:24px; background:var(--surface-primary); border:1px solid var(--border-default); border-radius:12px; margin-bottom:16px } .median strong { display:block; font:600 clamp(3rem,9vw,7rem)/1 var(--font-serif); margin:20px 0 } .median small { font:var(--text-body) } .density { display:flex; align-items:end; height:170px; gap:3px; border-bottom:2px solid var(--theme-demographie-line) } .density i { flex:1; background:var(--theme-demographie); min-height:4px } .extremes article { display:flex; flex-direction:column; gap:8px } .controls { display:flex; gap:16px; flex-wrap:wrap; margin:24px 0 } label { display:flex; flex-direction:column; gap:4px } select,input { padding:8px; border:1px solid var(--border-default); border-radius:6px } table { width:100%; border-collapse:collapse; background:var(--surface-primary) } th,td { padding:12px; border-bottom:1px solid var(--border-subtle); text-align:left } tr.selection { background:var(--theme-demographie-soft) } button { border:0; background:none; color:var(--accent-primary); cursor:pointer } dt { font-weight:700; margin-top:12px } dd { margin:0 } @media(max-width:700px) { .hero,.extremes { grid-template-columns:1fr } table { font-size:.85rem } }
</style>
