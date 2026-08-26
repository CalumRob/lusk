<script setup lang="ts">
import { AlertCircle } from 'lucide-vue-next'
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import AppIcon from '@/components/AppIcon.vue'
import { ancreSource } from '@/methodes/sources'
import { sourceRecords } from '@/payload/selectors'
import { usePayload } from '@/payload/usePayload'

/**
 * ⚠️ PROTOTYPE JETABLE (#500) — la page Sources accueille TEMPORAIREMENT trois
 * variantes de table bornée (/sources?variant=A|B|C), filles de l'ancienne
 * table Méthodes · Sources (ADR-0022, verdict #478). Sans paramètre
 * `variant`, la page de production rend EXACTEMENT comme avant (aucune
 * régression). La bascule flottante est développement-uniquement ; tout le
 * dossier `views/sources/` disparaît avec la branche.
 */
import BasculePrototype from '@/views/sources/BasculePrototype.vue'
import { VARIANTES, type Variante } from '@/views/sources/prototype'
import VarianteDossiers from '@/views/sources/VarianteDossiers.vue'
import VarianteRegistre from '@/views/sources/VarianteRegistre.vue'
import VarianteSections from '@/views/sources/VarianteSections.vue'

const COMPOSANTES_VARIANTE: Record<Variante, unknown> = {
  A: VarianteRegistre,
  B: VarianteDossiers,
  C: VarianteSections,
}

const route = useRoute()
/** ?variant=A|B|C — toute autre valeur retombe sur la page de production. */
const variante = computed<Variante | null>(() => {
  const valeur = route.query.variant
  return typeof valeur === 'string' && (VARIANTES as readonly string[]).includes(valeur)
    ? (valeur as Variante)
    : null
})
/** La bascule flottante n'existe qu'en développement (#500). */
const estDeveloppement = import.meta.env.DEV

const { payload, erreur, chargement, recharger } = usePayload()
const sources = computed(() => payload.value ? sourceRecords(payload.value).filter((source) => source.consumers.length > 0) : [])
</script>

<template>
  <section
    class="page sources-page"
    :class="{ 'sources-page--proto': variante !== null }"
    aria-labelledby="sources-title"
    :aria-busy="chargement ? 'true' : 'false'"
  >
    <h1 id="sources-title">Sources</h1>
    <div v-if="variante" class="proto-bandeau" role="note">
      <strong>Prototype jetable #500</strong> — variante {{ variante }} sur données réelles. Ne pas
      fusionner : tout le dossier <code>views/sources/</code> disparaît avec la branche.
    </div>
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
    <!-- ⚠️ #500 — les trois variantes de table bornée (jetables). -->
    <component :is="COMPOSANTES_VARIANTE[variante!]" v-else-if="variante && payload" :payload="payload" />
    <template v-else-if="!variante">
    <div class="source-records">
      <article v-for="source in sources" :id="ancreSource(source.id)" :key="source.id" class="source-record">
        <header class="source-record__header">
          <div>
            <p class="source-record__eyebrow">Jeu de données</p>
            <h2>{{ source.dataset }}</h2>
            <p class="source-record__publisher">Éditeur : {{ source.publisher }} · Licence : {{ source.licence ?? '—' }}</p>
          </div>
          <a v-if="source.url" :href="source.url" target="_blank" rel="noopener noreferrer">Voir le jeu de données</a>
        </header>
        <p v-if="source.caveat" class="source-record__caveat">{{ source.caveat }}</p>
        <p v-if="source.replie" class="source-record__summary">
          {{ source.vintage ?? '—' }} · {{ source.freshness ?? '—' }} · {{ source.licence ?? '—' }}
        </p>
        <section v-if="source.clocks.length" class="source-record__clocks" aria-label="Horloges de mise à jour">
          <h3>Horloges de mise à jour</h3>
          <dl><template v-for="clock in source.clocks" :key="`${clock.name}-${clock.reference}`"><dt>{{ clock.name }}</dt><dd>{{ clock.frequency }} · Référence : {{ clock.reference }}<span v-if="clock.trigger"> · Déclencheur : {{ clock.trigger }}</span></dd></template></dl>
        </section>
        <h3>Millésimes et fraîcheur</h3>
        <ul class="source-record__vintages">
          <li v-for="vintage in source.vintages" v-if="!source.replie" :id="ancreSource(vintage.id)" :key="vintage.id">
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
            <RouterLink :to="{ name: 'indicateur', params: { theme: consumer.theme, indicator: consumer.key } }">{{ consumer.label }}</RouterLink>
            <span> · {{ consumer.theme }}</span>
            <small v-if="consumer.caveat"> — {{ consumer.caveat }}</small>
          </li>
        </ul>
        <p v-else>Aucun indicateur publié ne cite ce jeu.</p>
      </article>
    </div>
    </template>
    <!-- Bascule flottante : développement uniquement (#500). -->
    <BasculePrototype
      v-if="estDeveloppement"
      :actuelle="variante ?? 'A'"
    />
  </section>
</template>

<style scoped>
.sources-page h1 { margin: 0 0 var(--space-4); font: var(--text-h1); }
.sources-page__intro { max-width: 70ch; margin: 0 0 var(--space-8); color: var(--text-secondary); }
.sources-page__status { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-8) 0; }
/* #500 : la bascule flottante (fixed) ne doit jamais recouvrir le pied de page. */
.sources-page--proto { padding-bottom: 96px; }
.proto-bandeau {
  margin: 0 0 var(--space-4);
  padding: var(--space-2) var(--space-4);
  border: 1px solid color-mix(in oklab, var(--status-warning) 35%, transparent);
  border-radius: var(--radius-md);
  background: color-mix(in oklab, var(--status-warning) 8%, var(--surface-primary));
  color: var(--text-secondary);
  font: var(--text-body-sm);
}
.proto-bandeau strong { color: var(--status-warning); text-transform: uppercase; letter-spacing: 0.04em; }
.proto-bandeau code { font-family: var(--font-mono); font-size: 0.85em; }
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
