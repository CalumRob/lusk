<script setup lang="ts">
import { AlertCircle } from 'lucide-vue-next'
import { computed } from 'vue'

import AppIcon from '@/components/AppIcon.vue'
import { ancreSource } from '@/methodes/sources'
import { publishedSources } from '@/methodes/authority'
import { usePayload } from '@/payload/usePayload'

const { payload, erreur, chargement, recharger } = usePayload()
const sources = computed(() => (payload.value ? publishedSources(payload.value) : []))
</script>

<template>
  <section class="page sources-page" aria-labelledby="sources-title" :aria-busy="chargement ? 'true' : 'false'">
    <h1 id="sources-title">Sources</h1>
    <p class="sources-page__intro">
      Les jeux de données publiés par Lusk, leurs millésimes, leurs horloges de mise à jour et les
      indicateurs qui les consomment. Une fiche de source est l’autorité commune des explications.
    </p>
    <div v-if="chargement" class="sources-page__status" role="status">Chargement des sources</div>
    <div v-else-if="erreur" class="sources-page__status">
      <AppIcon :icone="AlertCircle" :taille="24" aria-hidden="true" />
      <span>Impossible de charger les sources.</span>
      <button type="button" @click="recharger">Réessayer</button>
    </div>
    <div v-else class="source-records">
      <article v-for="source in sources" :id="ancreSource(source.id)" :key="source.id" class="source-record">
        <header class="source-record__header">
          <div>
            <p class="source-record__eyebrow">Jeu de données</p>
            <h2>{{ source.name }}</h2>
            <p class="source-record__publisher">Éditeur : {{ source.publisher }}</p>
          </div>
          <a v-if="source.url" :href="source.url" target="_blank" rel="noopener noreferrer">Voir le jeu de données</a>
        </header>
        <p v-if="source.caveat" class="source-record__caveat">{{ source.caveat }}</p>
        <p v-if="source.updateClocks.length" class="source-record__clock">
          <strong>Horloge de mise à jour :</strong> {{ source.updateClocks.join(' · ') }}
        </p>
        <h3>Millésimes et fraîcheur</h3>
        <ul class="source-record__vintages">
          <li v-for="vintage in source.vintages" :id="ancreSource(vintage.id)" :key="vintage.id">
            <strong>{{ vintage.label }}</strong>
            <span>Version : {{ vintage.version ?? '—' }}</span>
            <span>Licence : {{ vintage.licence ?? '—' }}</span>
            <span>Référence : {{ vintage.dateReference ?? '—' }}</span>
            <span>Publication : {{ vintage.datePublication ?? '—' }}</span>
          </li>
        </ul>
        <h3>Consommateurs publiés</h3>
        <ul v-if="source.consumers.length" class="source-record__consumers">
          <li v-for="consumer in source.consumers" :key="`${consumer.theme}-${consumer.key}`">
            <a :href="`/methodologie?onglet=methodes&section=${consumer.theme}#indicateur-${consumer.key}`">{{ consumer.label }}</a>
            <span> · {{ consumer.theme }}</span>
            <small v-if="consumer.caveat"> — {{ consumer.caveat }}</small>
          </li>
        </ul>
        <p v-else>Aucun indicateur publié ne cite ce jeu.</p>
      </article>
    </div>
  </section>
</template>

<style scoped>
.sources-page h1 { margin: 0 0 var(--space-4); font: var(--text-h1); }
.sources-page__intro { max-width: 70ch; margin: 0 0 var(--space-8); color: var(--text-secondary); }
.sources-page__status { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-8) 0; }
.source-records { display: grid; gap: var(--space-8); }
.source-record { scroll-margin-top: calc(var(--header-height) + 12px); padding: var(--space-6); border: 1px solid var(--border-default); border-radius: var(--radius-lg); background: var(--surface-primary); }
.source-record__header { display: flex; justify-content: space-between; gap: var(--space-6); align-items: start; }
.source-record h2 { margin: 0; font: var(--text-h2); }
.source-record h3 { margin: var(--space-6) 0 var(--space-3); font: var(--text-h3); }
.source-record__eyebrow { margin: 0 0 var(--space-1); color: var(--text-tertiary); font: var(--text-overline); }
.source-record__publisher, .source-record__caveat, .source-record__clock { color: var(--text-secondary); }
.source-record__vintages, .source-record__consumers { display: grid; gap: var(--space-2); margin: 0; padding-left: var(--space-5); }
.source-record__vintages li { display: flex; flex-wrap: wrap; gap: var(--space-3); color: var(--text-secondary); }
.source-record__vintages li strong { min-width: 18rem; color: var(--text-primary); }
.source-record a { color: var(--accent-primary); font-weight: 600; }
@media (max-width: 767.98px) { .source-record__header { flex-direction: column; } .source-record__vintages li { flex-direction: column; gap: 0; } }
</style>
