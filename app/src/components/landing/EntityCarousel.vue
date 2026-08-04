<script setup lang="ts">
/**
 * EntityCarousel — the landing's "Sélection aléatoire" (ui-elements.md
 * §EntityCarousel + layouts.md §1): a horizontal carousel of territory cards,
 * each linking to its fiche d'identité.
 *
 * A11y contract: arrow keys move the active card (roving tabindex), pause on
 * hover, and the auto-advance is disabled under prefers-reduced-motion (the
 * host passes `automatique=false` — DESIGN.md §6). Motion is transform-only.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'

import { libelleType } from '@/search/recherche'
import type { Territoire } from '@/payload/types'

const props = withDefaults(
  defineProps<{
    territoires: Territoire[]
    automatique?: boolean
  }>(),
  { automatique: true },
)

const actif = ref(0)
let minuteur: ReturnType<typeof setInterval> | null = null

const nbCartes = () => props.territoires.length

function centrer(index: number): void {
  actif.value = (index + nbCartes()) % nbCartes()
}

function suivant(): void {
  centrer(actif.value + 1)
}

function precedent(): void {
  centrer(actif.value - 1)
}

function surTouche(ev: KeyboardEvent): void {
  if (ev.key === 'ArrowRight') {
    ev.preventDefault()
    suivant()
  } else if (ev.key === 'ArrowLeft') {
    ev.preventDefault()
    precedent()
  }
}

function demarrerAutomatique(): void {
  if (!props.automatique || nbCartes() < 2) return
  minuteur = setInterval(suivant, 4000)
}

function arreterAutomatique(): void {
  if (minuteur) {
    clearInterval(minuteur)
    minuteur = null
  }
}

onMounted(demarrerAutomatique)

onBeforeUnmount(arreterAutomatique)
</script>

<template>
  <section class="carrousel-section" aria-labelledby="titre-exemples">
    <h2 class="carrousel-titre" id="titre-exemples">Sélection aléatoire</h2>

    <div
      class="carrousel"
      role="group"
      aria-roledescription="carrousel"
      aria-label="Exemples de fiches — naviguer avec les flèches"
      @keydown="surTouche"
      @mouseenter="arreterAutomatique()"
      @mouseleave="demarrerAutomatique()"
    >
      <ul class="carrousel-piste">
        <li v-for="(territoire, index) in territoires" :key="territoire.territoire" class="carrousel-slide">
          <RouterLink
            :to="{ name: 'territoire', params: { type: territoire.type, id: territoire.territoire } }"
            class="carrousel-carte"
            :class="{ 'is-actif': index === actif }"
            :tabindex="index === actif ? 0 : -1"
            :aria-current="index === actif ? 'true' : undefined"
          >
            <span class="carrousel-carte-nom">{{ territoire.nom }}</span>
            <span class="carrousel-carte-puce">{{ libelleType(territoire.type) }}</span>
          </RouterLink>
        </li>
      </ul>

      <div class="carrousel-controles">
        <button type="button" class="carrousel-bouton" aria-label="Carte précédente" @click="precedent">
          ←
        </button>
        <button type="button" class="carrousel-bouton" aria-label="Carte suivante" @click="suivant">
          →
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.carrousel-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.carrousel-titre {
  margin: 0;
  font: var(--text-overline);
  letter-spacing: var(--text-overline-tracking);
  text-transform: uppercase;
  color: var(--brand-500);
}

.carrousel {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.carrousel-piste {
  display: flex;
  gap: var(--space-4);
  margin: 0;
  padding: 0;
  list-style: none;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
}

.carrousel-slide {
  flex: 0 0 auto;
  scroll-snap-align: start;
}

.carrousel-carte {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 220px;
  min-height: 96px;
  padding: var(--space-5);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--surface-primary);
  box-shadow: var(--shadow-default);
  color: var(--text-primary);
  text-decoration: none;
  transition:
    transform 200ms ease-in-out,
    box-shadow 200ms ease-in-out,
    border-color 200ms ease-in-out;
}

.carrousel-carte:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-prominent);
  border-color: var(--brand-500);
}

.carrousel-carte-nom {
  font: var(--text-h3);
  color: var(--text-primary);
}

.carrousel-carte-puce {
  align-self: flex-start;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-full);
  background: var(--surface-tertiary);
  color: var(--text-secondary);
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  text-transform: uppercase;
}
</style>
