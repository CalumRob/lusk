<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePayload } from '@/payload/usePayload'
import type { Fichier } from '@/payload/loader'
import { modeleExploration, payloadPourCarte } from '@/indicateurs/explorationModel'
import type { NiveauIndicateur, OrdreExploration, TriExploration } from '@/indicateurs/explorationModel'
import MapExplorer from '@/components/carte/MapExplorer.vue'
import { useGeometrie } from '@/geo/useGeometrie'
import type { NiveauMasque } from '@/geo/types'
import type { Couche } from '@/carte/coucheModel'
import { THEMES_CANONIQUES } from '@/payload/types'
import type { Theme } from '@/payload/types'
import { themeStyle } from '@/indicateurs/themeTokens'
import { formaterNombreFR } from '@/payload/selectors'
import { sourceRecords } from '@/payload/selectors'
import { ancreSource, datasetDeSource } from '@/methodes/sources'
import RepereFamilyOutlet from '@/components/indicateurs/RepereFamilyOutlet.vue'
import { dispatchIndicatorFamily } from '@/indicateurs/familySeam'

const route = useRoute(); const router = useRouter(); const recherche = ref('')
const theme = computed(() => String(route.params.theme)); const indicator = computed(() => String(route.params.indicator))
const themeValide = computed(() => (THEMES_CANONIQUES as readonly string[]).includes(theme.value))
const selectedTheme = theme.value as Theme
const attendre: Fichier[] = themeValide.value ? ['territoires', `indicateurs_${selectedTheme}`, `theme_${selectedTheme}`] : ['territoires']
const { payload, erreur, chargement } = usePayload({ attendre })
const geometrie = useGeometrie()
const metadata = computed(() => payload.value.themeMetadata?.[theme.value as keyof typeof payload.value.themeMetadata])
const page = computed(() => {
  const raw = metadata.value?.indicator_pages?.[indicator.value]
  if (!raw?.comparison) return raw
  return { ...raw, unit: raw.comparison.unit ?? raw.unit, direction: raw.comparison.direction ?? raw.direction }
})
const familyDispatch = computed(() => page.value ? dispatchIndicatorFamily(page.value, { theme: theme.value as Theme, facts: facts.value, territories: payload.value.territoires, selected: typeof route.query.territoire === 'string' ? route.query.territoire : undefined, facet: route.query }) : null)
const sources = computed(() => {
  if (!page.value || !payload.value) return []
  const authority = sourceRecords(payload.value)
  return page.value.sources.map((id) => authority.find((record) => record.id === datasetDeSource(id))).filter((source): source is NonNullable<typeof source> => Boolean(source))
})
const facts = computed(() => payload.value.indicateurs.filter((f) => f.theme === theme.value && f.key === indicator.value))
const niveauRoute = computed(() => ['commune', 'epci', 'departement'].includes(String(route.query.niveau)) ? route.query.niveau as NiveauIndicateur : undefined)
const validScope = computed(() => {
  if (payload.value.territoires.length === 0) return { departement: typeof route.query.departement === 'string' ? route.query.departement : undefined, epci: typeof route.query.epci === 'string' ? route.query.epci : undefined }
  const communes = payload.value.territoires.filter((territory) => territory.type === 'commune')
  const departement = typeof route.query.departement === 'string' && communes.some((territory) => territory.departement === route.query.departement) ? route.query.departement : undefined
  const epci = typeof route.query.epci === 'string' && communes.some((territory) => territory.epci === route.query.epci) ? route.query.epci : undefined
  if (departement && epci && !communes.some((territory) => territory.departement === departement && territory.epci === epci)) return { departement: undefined, epci }
  return { departement, epci }
})
const requested = computed(() => ({ niveau: niveauRoute.value, ...validScope.value, territoire: typeof route.query.territoire === 'string' ? route.query.territoire : undefined, recherche: recherche.value, tri: ['nom', 'valeur', 'rang'].includes(String(route.query.tri)) ? route.query.tri as TriExploration : undefined, ordre: route.query.ordre === 'desc' ? 'desc' as OrdreExploration : 'asc' as OrdreExploration }))
const model = computed(() => familyDispatch.value ? modeleExploration(facts.value, familyDispatch.value.facet, payload.value.territoires, requested.value, localStorage.getItem('lusk:niveau-indicateur') ?? undefined) : null)
const themeVars = computed(() => themeValide.value ? themeStyle(theme.value as Theme) : undefined)
const directionGlyph = computed(() => familyDispatch.value?.facet.direction === 'low' ? '▼' : '▲')
const directionText = computed(() => familyDispatch.value?.facet.direction === 'low' ? 'moins = mieux' : 'plus = mieux')
const selectedRow = computed(() => model.value?.rows.find((row) => row.highlighted))
const markerDescription = computed(() => selectedRow.value && familyDispatch.value ? `${selectedRow.value.territoire.nom} : ${formaterNombreFR(selectedRow.value.value, 2)} ${familyDispatch.value.facet.unit}, positionné sur l’axe de densité à sa valeur.` : '')
function afficherRang(row: { rang: number; rangTaille: number }) { return `${row.rang === 1 ? '1er' : `${row.rang}e`} / ${row.rangTaille}` }
function setSort(tri: TriExploration) { const ordre = route.query.tri === tri && route.query.ordre === 'asc' ? 'desc' : 'asc'; router.replace({ query: normalizedQuery({ tri, ordre }) }) }
const payloadCarte = computed(() => {
  const niveau = model.value?.state.niveau ?? niveauRoute.value ?? 'commune'
  const departement = niveau === 'commune' && typeof route.query.departement === 'string' ? route.query.departement : undefined
  const epci = niveau === 'commune' && typeof route.query.epci === 'string' ? route.query.epci : undefined
  return payloadPourCarte(payload.value, familyDispatch.value!.facet, niveau, departement, epci)
})
const vue = computed(() => route.query.vue === 'carte' || route.query.vue === 'indicateur' ? route.query.vue : 'reperes')
const couche = computed<Couche | null>(() => page.value && familyDispatch.value ? ({ source: 'indicateur', clef: familyDispatch.value.facet.indicator, detail: familyDispatch.value.facet.detail, libelle: familyDispatch.value.facet.labels[familyDispatch.value.facet.detail ?? ''] ?? page.value.label, parDefaut: true, sousGroupe: null, storyKey: null }) : null)
const niveauMasque = computed<NiveauMasque>(() => model.value?.state.niveau === 'epci' ? 'epcis' : model.value?.state.niveau === 'departement' ? 'departements' : 'communes')
const territoireCible = computed(() => payload.value.territoires.find((t) => t.territoire === route.query.territoire && t.type === model.value?.state.niveau) ?? null)
function normalizedQuery(extra: Record<string, string | undefined> = {}) { const next = { ...route.query, ...extra }; if (next.niveau !== 'commune') { delete next.departement; delete next.epci }; if (payload.value.territoires.length > 0) { if (next.departement !== validScope.value.departement) delete next.departement; if (next.epci !== validScope.value.epci) delete next.epci }; return next }
function setQuery(key: string, value: string) { router.replace({ query: normalizedQuery({ [key]: value || undefined }) }) }
function setVue(value: 'reperes' | 'carte' | 'indicateur') { router.replace({ query: normalizedQuery({ vue: value === 'reperes' ? undefined : value }) }) }
watch(() => [route.params.theme, route.params.indicator, route.query.recherche], () => { recherche.value = String(route.query.recherche ?? '') }, { immediate: true })
watch(() => [route.query.niveau, route.query.departement, route.query.epci, payload.value.territoires.length], () => { if (!payload.value.territoires.length) return; const niveau = model.value?.state.niveau; const query = normalizedQuery({ niveau }); if (JSON.stringify(query) !== JSON.stringify(route.query)) router.replace({ query }) }, { immediate: true })
watch(() => model.value?.state.niveau, (niveau) => { if (niveau && route.query.niveau === undefined) router.replace({ query: normalizedQuery({ niveau }) }) }, { immediate: true })
watch(() => route.query.niveau, (niveau) => { if (typeof niveau === 'string' && ['commune', 'epci', 'departement'].includes(niveau)) localStorage.setItem('lusk:niveau-indicateur', niveau) }, { immediate: true })
watch(() => familyDispatch.value?.resolvedUrl, (resolved) => {
  if (!resolved || !page.value) return
  const canonical = new URLSearchParams(resolved.slice(1)); const next = { ...route.query }
  for (const key of ['detail', 'sex', 'dimension']) delete next[key]
  canonical.forEach((value, key) => { next[key] = value })
  if (JSON.stringify(next) !== JSON.stringify(route.query)) router.replace({ query: next })
}, { immediate: true })
</script>
<template>
  <section class="indicateur-page" :class="`theme-${theme}`" :style="themeVars">
    <div v-if="chargement" role="status">Chargement de l’indicateur…</div><div v-else-if="erreur" role="alert">Impossible de charger l’indicateur.</div><div v-else-if="!page || !model" role="alert">Indicateur introuvable.</div>
    <template v-else>
      <header><p class="sur-titre">{{ metadata?.label }}</p><h1>{{ page.label }}</h1><p>{{ page.definition }}</p></header>
      <nav class="vues" aria-label="Vues de l’indicateur"><button :class="{ active: vue === 'reperes' }" @click="setVue('reperes')">Repères</button><button :class="{ active: vue === 'carte' }" @click="setVue('carte')">Carte</button><button :class="{ active: vue === 'indicateur' }" @click="setVue('indicateur')">L’indicateur</button></nav>
       <main v-if="vue === 'reperes'"><RepereFamilyOutlet v-if="familyDispatch" :dispatch="familyDispatch">
         <template #default>
          <div class="hero"><article class="median"><span>Médiane</span><strong>{{ model!.median === null ? '—' : formaterNombreFR(model!.median, 2) }} <small>{{ familyDispatch.facet.unit }}</small></strong><p>{{ model!.scopeLabel }}</p></article><article class="distribution"><h2>Distribution</h2><svg class="density" viewBox="0 0 600 180" role="img" aria-label="Densité des valeurs"><title>Densité des valeurs</title><desc v-if="markerDescription">{{ markerDescription }}</desc><path :d="`M ${model!.density.map((point, index) => `${index * (600 / Math.max(model!.density.length - 1, 1))},${20 + point.y * 1.5}`).join(' L ')}`" /><circle v-if="model!.markerX !== null && model!.markerY !== null" :cx="model!.markerX! * 6" :cy="20 + model!.markerY! * 1.5" r="7" class="point-highlight" :aria-label="markerDescription" /></svg><span v-if="markerDescription" class="visually-hidden">{{ markerDescription }}</span></article></div>
          <div class="extremes"><article><h2>Valeurs les plus hautes</h2><span v-if="model!.high.count > 1">{{ model!.high.count }} territoires à égalité</span><RouterLink v-for="row in model!.high.rows" :key="row.territoire.territoire" :to="row.fiche">{{ row.territoire.nom }} · {{ row.value }} {{ familyDispatch.facet.unit }}</RouterLink></article><article><h2>Valeurs les plus basses</h2><span v-if="model!.low.count > 1">{{ model!.low.count }} territoires à égalité</span><RouterLink v-for="row in model!.low.rows" :key="row.territoire.territoire" :to="row.fiche">{{ row.territoire.nom }} · {{ row.value }} {{ familyDispatch.facet.unit }}</RouterLink></article></div>
         <div class="controls"><label>Niveau <select :value="model!.state.niveau" @change="setQuery('niveau', ($event.target as HTMLSelectElement).value)"><option v-for="niveau in page.levels" :key="niveau" :value="niveau">{{ niveau === 'commune' ? 'Communes' : niveau === 'epci' ? 'EPCI' : 'Départements' }}</option></select></label><label v-if="model!.state.niveau === 'commune'">Département <input :value="route.query.departement ?? ''" @input="setQuery('departement', ($event.target as HTMLInputElement).value)" /></label><label v-if="model!.state.niveau === 'commune'">EPCI <input :value="route.query.epci ?? ''" @input="setQuery('epci', ($event.target as HTMLInputElement).value)" /></label><label>Rechercher <input v-model="recherche" @input="setQuery('recherche', recherche)" /></label></div>
           <table><caption>Territoires comparables — {{ model!.scopeLabel }}</caption><thead><tr><th><button type="button" @click="setSort('nom')">Territoire</button></th><th><button type="button" @click="setSort('valeur')">Valeur</button></th><th><button type="button" @click="setSort('rang')">Rang</button> <span :title="directionText" :aria-label="directionText">{{ directionGlyph }} {{ directionText }}</span></th><th /></tr></thead><tbody><tr v-for="row in model!.rows" :key="row.territoire.territoire" :class="{ selection: row.highlighted }"><td><RouterLink :to="row.fiche">{{ row.territoire.nom }}</RouterLink></td><td>{{ formaterNombreFR(row.value, 2) }} {{ familyDispatch.facet.unit }}</td><td><span :title="`${directionGlyph} ${directionText}`" :aria-label="`${afficherRang(row)} · ${directionText}`">{{ afficherRang(row) }}</span></td><td><button type="button" @click="setQuery('territoire', row.territoire.territoire)">Voir sur la distribution</button></td></tr></tbody></table>
         </template>
       </RepereFamilyOutlet></main>
       <section v-else-if="vue === 'carte'" class="carte-indicateur"><div v-if="geometrie.masques.value" class="map-wrap"><MapExplorer :masques="geometrie.masques.value" :payload="payloadCarte" :active-ids="payloadCarte.indicateurs.map((fact) => fact.territoire)" :theme="theme as Theme" :couche="couche" :niveau="niveauMasque" :territoire-cible="territoireCible" :requete-zoom="Number(Boolean(route.query.territoire))" /></div><div v-else role="status">Chargement de la carte…</div></section>
       <aside v-else><h2>L’indicateur</h2><dl><dt>Définition</dt><dd>{{ page.definition }}</dd><dt>Unité</dt><dd>{{ page.unit }}</dd><dt>Calcul</dt><dd>{{ page.calculation }}</dd><dt>Direction</dt><dd><span :title="directionText" :aria-label="directionText">{{ directionGlyph }} {{ directionText }}</span></dd><dt>Précautions</dt><dd>{{ page.caveats }}</dd></dl><section v-for="source in sources" :id="`indicator-source-${source.id}`" :key="source.id" class="source-card"><h3>{{ source.dataset }}</h3><p>Éditeur : {{ source.publisher }} · Licence : {{ source.licence ?? '—' }} · Millésime : {{ source.vintage ?? '—' }} · Fraîcheur : {{ source.freshness ?? '—' }}</p><p v-if="source.caveat">Limite de la source : {{ source.caveat }}</p><a v-if="source.url" :href="source.url" target="_blank" rel="noopener noreferrer">Voir le jeu de données</a><RouterLink :to="{ name: 'sources', hash: `#${ancreSource(source.id)}` }">Voir la fiche source</RouterLink><ul><li v-for="vintage in source.vintages" :key="vintage.id">{{ vintage.label }} · {{ vintage.version ?? '—' }} · {{ vintage.licence ?? '—' }} · {{ vintage.dateReference ?? '—' }} · {{ vintage.datePublication ?? '—' }}</li></ul><dl v-if="source.clocks.length"><template v-for="clock in source.clocks" :key="`${clock.name}-${clock.reference}`"><dt>{{ clock.name }}</dt><dd>{{ clock.frequency }} · Référence : {{ clock.reference }}<span v-if="clock.trigger"> · Déclencheur : {{ clock.trigger }}</span></dd></template></dl></section></aside>
    </template>
  </section>
</template>
<style scoped>
.visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.indicateur-page{min-height:100%;padding:clamp(24px,5vw,64px) max(16px,calc((100% - 1200px)/2));background:var(--surface-secondary);color:var(--text-primary)}header{max-width:760px}h1{font:var(--text-h1);margin:.3rem 0 1rem}h2{font:var(--text-h3)}.sur-titre{color:var(--indicateur-strong);font:var(--text-overline);text-transform:uppercase}.vues{display:flex;gap:24px;margin:32px 0;border-bottom:1px solid var(--border-default);padding-bottom:12px}.vues button.active{border-bottom:3px solid var(--indicateur-accent);font-weight:700}.hero,.extremes{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}.hero article,.extremes article,aside{padding:24px;background:var(--surface-primary);border:1px solid var(--border-default);border-radius:12px;margin-bottom:16px}.median strong{display:block;font:600 clamp(3rem,9vw,7rem)/1 var(--font-serif);margin:20px 0}.median small{font:var(--text-body)}.density{width:100%;height:170px;border-bottom:2px solid var(--indicateur-line)}.density path{fill:none;stroke:var(--indicateur-accent);stroke-width:4}.point-highlight{fill:var(--status-error)}.extremes article{display:flex;flex-direction:column;gap:8px}.controls{display:flex;gap:16px;flex-wrap:wrap;margin:24px 0}label{display:flex;flex-direction:column;gap:4px}select,input{padding:8px;border:1px solid var(--border-default);border-radius:6px}table{width:100%;border-collapse:collapse;background:var(--surface-primary)}th,td{padding:12px;border-bottom:1px solid var(--border-subtle);text-align:left}tr.selection{background:var(--indicateur-soft)}button{border:0;background:none;color:var(--accent-primary);cursor:pointer}.carte-indicateur,.map-wrap{min-height:540px}dt{font-weight:700;margin-top:12px}dd{margin:0}@media(max-width:700px){.hero,.extremes{grid-template-columns:1fr}table{font-size:.85rem}}
</style>
