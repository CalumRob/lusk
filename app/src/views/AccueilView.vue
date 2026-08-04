<script setup lang="ts">
/**
 * L'accueil — the landing (layouts.md §1 + site-map.md). The visitor's
 * decision path: claim → prove → entice → trust. The serif claim is the hero
 * moment (DESIGN.md §1); the GlobalSearchBar is the way into any fiche; the
 * freshness line makes the "alive" promise literal (ligneFraicheur from the
 * run report); EXEMPLES shows a random selection of fiches (EntityCarousel);
 * the outro closes with the thesis-as-evidence teaser and Sources & Méthodes.
 *
 * States (ui-elements.md): skeleton while the payload loads; typed
 * PayloadError with a Retry button; honest static-rhythm freshness fallback.
 * The search bar and the carousel need the reference table — the carousel's
 * auto-advance is disabled under prefers-reduced-motion (DESIGN.md §6).
 */
import { AlertCircle, ArrowRight, Map } from 'lucide-vue-next'
import { computed, ref, watchEffect } from 'vue'

import AppIcon from '@/components/AppIcon.vue'
import EntityCarousel from '@/components/landing/EntityCarousel.vue'
import GlobalSearchBar from '@/components/GlobalSearchBar.vue'
import { selectionAleatoire } from '@/landing/selection'
import { ligneFraicheur } from '@/payload/selectors'
import type { Territoire } from '@/payload/types'
import { usePayload } from '@/payload/usePayload'

const { payload, erreur, chargement, recharger } = usePayload()

const territoires = computed<Territoire[]>(() => payload.value?.territoires ?? [])

const fraicheur = computed(() => {
  if (erreur.value) return 'Données actualisées chaque semaine'
  return payload.value ? ligneFraicheur(payload.value) : null
})

const messagesErreur = computed(() =>
  erreur.value ? 'Impossible de charger les données.' : null,
)

// Les exemples : un tirage aléatoire des territoires, stable par session (la
// sélection ne change pas à chaque rendu — le carrousel n'est pas une loterie).
const exemples = ref<Territoire[]>([])
watchEffect(() => {
  if (payload.value && exemples.value.length === 0) {
    exemples.value = selectionAleatoire(payload.value.territoires, 6)
  }
})

// L'auto-avance du carrousel respecte prefers-reduced-motion (DESIGN.md §6).
const automatique = ref(true)
watchEffect(() => {
  if (typeof window.matchMedia === 'function') {
    automatique.value = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }
})
</script>

<template>
  <section class="accueil" :aria-busy="chargement ? 'true' : 'false'">
    <div class="accueil-interieur">
      <header class="accueil-hero">
        <p class="accueil-accroche">
          «&nbsp;Lusk transforme des données publiques éparses en intelligence territoriale.&nbsp;»
        </p>
        <p class="accueil-sous-titre">
          Lusk rassemble les chiffres ouverts de la Bretagne — communes, EPCI, départements —
          en une fiche d’identité lisible pour chaque territoire.
        </p>

        <GlobalSearchBar
          class="accueil-recherche"
          :territoires="territoires"
          :chargement="chargement"
          :erreur="messagesErreur"
        />

        <div class="accueil-produit">
          <RouterLink to="/carte" class="accueil-carte">
            <AppIcon :icone="Map" :taille="18" aria-hidden="true" />
            La carte interactive
            <AppIcon :icone="ArrowRight" :taille="16" aria-hidden="true" />
          </RouterLink>

          <RouterLink
            v-if="fraicheur"
            :to="{ path: '/methodologie' }"
            class="accueil-fraicheur"
          >{{ fraicheur }}</RouterLink>
          <div
            v-else
            class="squelette squelette--fraicheur"
            role="status"
            aria-label="Chargement des données"
          />
        </div>
      </header>

      <EntityCarousel
        v-if="exemples.length > 0"
        class="accueil-exemples"
        :territoires="exemples"
        :automatique="automatique"
      />

      <footer class="accueil-outro">
        <RouterLink to="/methodologie" class="accueil-methodes">Sources &amp; Méthodes</RouterLink>
        <p class="accueil-teaser">
          Derrière chaque fiche, des données publiques sourcées, datées et reproductibles —
          la preuve, plutôt que la promesse.
        </p>
      </footer>
    </div>

    <div v-if="messagesErreur" class="accueil-erreur">
      <AppIcon :icone="AlertCircle" :taille="28" class="accueil-erreur-icone" aria-hidden="true" />
      <p class="accueil-erreur-texte">{{ messagesErreur }}</p>
      <button type="button" class="bouton-reessayer" @click="recharger">Réessayer</button>
    </div>
  </section>
</template>

<style scoped>
.accueil {
  flex: 1;
  width: 100%;
  background: var(--surface-secondary);
}

.accueil-interieur {
  width: 100%;
  max-width: var(--content-max-width);
  margin-inline: auto;
  padding: var(--space-16) var(--grid-margin-mobile) var(--space-12);
  display: flex;
  flex-direction: column;
  gap: var(--space-16);
}

/* ---- Le héros : la revendication est le moment serif (DESIGN.md §1) ---- */
.accueil-hero {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  max-width: 760px;
}

.accueil-accroche {
  margin: 0;
  font: var(--text-display);
  letter-spacing: var(--text-display-tracking);
  color: var(--text-primary);
}

.accueil-sous-titre {
  margin: 0;
  font: var(--text-body-lg);
  color: var(--text-secondary);
  max-width: 52ch;
}

.accueil-recherche {
  margin-top: var(--space-4);
}

.accueil-produit {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4) var(--space-8);
}

.accueil-carte {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font: var(--text-body);
  font-weight: 600;
  color: var(--accent-primary);
  transition: color 150ms ease-out;
}

.accueil-carte:hover {
  color: var(--accent-hover);
}

.accueil-fraicheur {
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--text-tertiary);
}

.squelette--fraicheur {
  width: 220px;
  height: 0.75rem;
}

/* ---- L'outro : la thèse comme preuve ---- */
.accueil-outro {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  border-top: 1px solid var(--border-subtle);
  padding-top: var(--space-8);
}

.accueil-methodes {
  width: fit-content;
  font: var(--text-body);
  font-weight: 600;
}

.accueil-teaser {
  margin: 0;
  max-width: 52ch;
  font: 400 1.125rem/1.6 var(--font-serif);
  color: var(--text-secondary);
}

/* ---- Erreur ---- */
.accueil-erreur {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-16) var(--space-6);
  text-align: center;
}

.accueil-erreur-icone {
  color: var(--text-tertiary);
}

.accueil-erreur-texte {
  margin: 0;
  color: var(--text-secondary);
  font: var(--text-body-lg);
}

.bouton-reessayer {
  height: 36px;
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-primary);
  color: var(--text-primary);
  font: var(--text-body-sm);
  font-weight: 600;
  box-shadow: var(--shadow-subtle);
  cursor: pointer;
}

.bouton-reessayer:hover {
  background: var(--surface-tertiary);
  border-color: var(--brand-500);
}
</style>
