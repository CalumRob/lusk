<script setup lang="ts">
/**
 * OngletTheme — one theme's tab content (ui-elements.md §ThemeBlock): the
 * theme overline (-strong) → the standard indicator figures (4, contract
 * order) → one story angle (serif one-liner + one chart) → "comment lire" +
 * Méthodes link. The block wears the theme's ramp — Démographie wears indigo;
 * the page background -wash is the shell's (TerritoireView).
 *
 * The block consumes the payload selectors only — never raw JSON. The Story
 * copy is keyed by the pipeline's classification (storyDemographie); a
 * territory without a story renders the standard block and no invented
 * one-liner.
 */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import GraphiqueSoldes from '@/components/fiche/GraphiqueSoldes.vue'
import IndicatorFigure from '@/components/fiche/IndicatorFigure.vue'
import { NOMS_INDICATEURS, NOMS_TRANCHES_AGE } from '@/fiche/indicateurs'
import { NOMS_THEMES } from '@/fiche/onglets'
import { storyDemographie } from '@/fiche/storyDemographie'
import {
  histoirePourTerritoire,
  indicateursGroupeesPourTerritoire,
  nuageComparaison,
  trouverTerritoire,
} from '@/payload/selectors'
import type { Payload, Theme } from '@/payload/types'

const props = defineProps<{
  theme: Theme
  payload: Payload
  territoire: string
}>()

const nomTheme = computed(() => NOMS_THEMES[props.theme])

const groupes = computed(() =>
  indicateursGroupeesPourTerritoire(props.payload, props.theme, props.territoire),
)

const histoire = computed(() =>
  histoirePourTerritoire(props.payload, props.theme, props.territoire),
)

// The solde chart is the Démographie story's shape only; the block guards on
// the theme before touching the theme-specific fields of the Histoire union.
const histoireDemographie = computed(() =>
  histoire.value?.theme === 'demographie' ? histoire.value : null,
)

const story = computed(() => {
  const histoire = histoireDemographie.value
  if (!histoire) return null
  return storyDemographie(
    histoire.classification,
    histoire.taux_solde_naturel,
    histoire.taux_solde_migratoire,
  )
})

const nuage = computed(() => nuageComparaison(props.payload, props.territoire) ?? [])

// The story's data sources, exhaustive: the série historique (the rates the
// reading crosses) and the base des EPCI (the nuage's comparison groups).
// Cited from the payload's vintages table — never invented, never a theme
// stamp. Absent table → no source line (honest, nothing to cite).
const sourceHistoire = computed(() => {
  const vintages = props.payload.vintages
  if (!vintages) return null
  const ids = new Set(['serie_historique', 'epci'])
  const citees = vintages.filter((v) => ids.has(v.id))
  if (citees.length === 0) return null
  return citees.map((v) => `${v.source} · ${v.version}`).join(' · ')
})

const nomTerritoire = computed(
  () => trouverTerritoire(props.payload, props.territoire)?.nom ?? props.territoire,
)

function libelleIndicateur(clef: string): string {
  return NOMS_INDICATEURS[props.theme]?.[clef] ?? clef
}
</script>

<template>
  <article
    class="onglet-theme"
    :class="`onglet-theme--${theme}`"
    :style="{
      '--couleur-strong': `var(--theme-${theme}-strong)`,
      '--couleur-soft': `var(--theme-${theme}-soft)`,
      '--couleur-line': `var(--theme-${theme}-line)`,
    }"
  >
    <p class="onglet-theme-overline">{{ nomTheme }}</p>

    <div class="grille-indicateurs">
      <IndicatorFigure
        v-for="groupe in groupes"
        :key="groupe.key"
        :clef="groupe.key"
        :lignes="groupe.lignes"
        :libelle="libelleIndicateur(groupe.key)"
        :labels-detail="NOMS_TRANCHES_AGE"
        :signe="groupe.key === 'evolution_1968'"
        :large="groupe.key === 'structure_age'"
      />
    </div>

    <section v-if="story" class="angle-story">
      <p class="angle-story-titre">{{ story.titre }}</p>
      <p class="angle-story-une-ligne">{{ story.uneLigne }}</p>
      <GraphiqueSoldes
        v-if="histoireDemographie"
        :taux-naturel="histoireDemographie.taux_solde_naturel"
        :taux-migratoire="histoireDemographie.taux_solde_migratoire"
        :classification="histoireDemographie.classification"
        :nom="nomTerritoire"
        :nuage="nuage"
      />
      <p class="angle-story-comment-lire">
        <span class="angle-story-etiquette">Comment lire</span>
        {{ story.commentLire }}
      </p>
      <p v-if="sourceHistoire" class="angle-story-source">
        <span class="angle-story-etiquette">Source</span>
        {{ sourceHistoire }}
      </p>
      <RouterLink class="angle-story-methodes" to="/methodologie">Méthodes</RouterLink>
    </section>
  </article>
</template>

<style scoped>
.onglet-theme {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  animation: entree-bloc 450ms cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes entree-bloc {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .onglet-theme {
    animation: none;
  }
}

.onglet-theme-overline {
  margin: 0;
  font: var(--text-overline);
  letter-spacing: var(--text-overline-tracking);
  text-transform: uppercase;
  color: var(--couleur-strong);
}

.grille-indicateurs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-6) var(--space-8);
}

@media (max-width: 1024px) {
  .grille-indicateurs {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .grille-indicateurs {
    grid-template-columns: 1fr;
  }
}

.angle-story {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-8);
  border: 1px solid var(--couleur-line);
  border-radius: var(--radius-lg);
  background: var(--surface-primary);
  box-shadow: var(--shadow-subtle);
}

.angle-story-titre {
  margin: 0;
  font: 600 1.1875rem/1.4 var(--font-serif);
  color: var(--couleur-strong);
}

.angle-story-une-ligne {
  margin: 0;
  font: var(--text-display);
  letter-spacing: var(--text-display-tracking);
  color: var(--text-primary);
}

.angle-story-comment-lire {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  font: var(--text-body-sm);
  color: var(--text-secondary);
}

.angle-story-source {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--text-tertiary);
}

.angle-story-etiquette {
  font: var(--text-overline);
  letter-spacing: var(--text-overline-tracking);
  text-transform: uppercase;
  color: var(--couleur-strong);
}

.angle-story-methodes {
  align-self: flex-start;
  font: var(--text-body-sm);
  font-weight: 600;
  color: var(--couleur-strong);
  text-underline-offset: 3px;
}
</style>
