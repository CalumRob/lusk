<script setup lang="ts">
/**
 * L'accueil — the landing (layouts.md §1 + site-map.md). The visitor's
 * decision path: brand → claim → prove → entice → trust. The hero opens with
 * the LuskBrand lockup and the title « lusk · Intelligence territoriale en
 * Bretagne » (mock/brand/iterations/v8.html — the brand moment, DESIGN.md §1);
 * the GlobalSearchBar is the way into any fiche; the freshness line makes the
 * "alive" promise literal (ligneFraicheur from the run report); the outro
 * closes with the thesis-as-evidence teaser and Sources & Méthodes.
 *
 * The hero is its own full-bleed band on --surface-hero, separated vertically
 * from the plain page surface by the band edge + border (DESIGN.md §7) — the
 * two zones never blur together. The carousel was removed (#204): the landing
 * is hero → outro, with no random draw.
 *
 * States (ui-elements.md): skeleton while the payload loads; typed
 * PayloadError with a Retry button; honest static-rhythm freshness fallback.
 * The search bar needs the reference table.
 */
import { AlertCircle, ArrowRight, Map } from 'lucide-vue-next'
import { computed } from 'vue'

import AppIcon from '@/components/AppIcon.vue'
import GlobalSearchBar from '@/components/GlobalSearchBar.vue'
import LuskBrand from '@/components/LuskBrand.vue'
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
</script>

<template>
  <section class="accueil" :aria-busy="chargement ? 'true' : 'false'">
    <header class="accueil-hero">
      <div class="accueil-hero-interieur">
        <div class="accueil-hero-contenu">
          <p class="accueil-accroche">
            Intelligence territoriale en Bretagne
          </p>
          <p class="accueil-sous-titre">
            Lusk transforme les données publiques éparses de la Bretagne en intelligence
            territoriale — pour chaque commune, EPCI et département, une fiche d'identité
            lisible, sourcée et datée.
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
        </div>

        <div class="accueil-hero-marque" aria-label="Lusk — breton, élan, mouvement">
          <LuskBrand verticale class="accueil-marque" />
          <span class="accueil-marque-caption">/'lysk/ · breton · élan, mouvement</span>
        </div>
      </div>
    </header>

    <div class="accueil-interieur">
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

/* ---- La bande du héros : son propre fond de marque (--surface-hero, DESIGN.md
   §7), pleine largeur — la bande se termine par un liseré, puis la zone de
   contenu reprend le fond de page : les deux zones ne se confondent pas. ---- */
.accueil-hero {
  background: var(--surface-hero);
  border-bottom: 1px solid var(--border-subtle);
}

.accueil-hero-interieur {
  width: 100%;
  max-width: var(--content-max-width);
  margin-inline: auto;
  padding: var(--space-16) var(--grid-margin-mobile) var(--space-20);
  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  gap: var(--space-12);
  align-items: center;
}

.accueil-hero-contenu {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  max-width: 760px;
}

/* La signature du héros (mock/landing.html) reste une atmosphère discrète :
   grand mot serif pâle, puis sa légende sous-jacente. */
.accueil-hero-marque {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  text-align: center;
  user-select: none;
}

.accueil-hero-marque :deep(.lusk-marque) {
  font: 600 clamp(4.5rem, 9vw, 7.5rem)/0.9 var(--font-serif);
  font-style: italic;
  letter-spacing: -0.02em;
  color: color-mix(in oklab, var(--brand-200) 55%, var(--surface-secondary));
  /* L'ermine vient se poser sur le mot : le gap interne (--space-2) saute,
     et la marge négative de l'ermine fait remonter le mot sous lui. */
  gap: 0;
}

.accueil-hero-marque :deep(.lusk-marque__ermine) {
  /* em sur la taille du mot (clamp) : l'hermine suit le texte — les
     proportions de la colonne tiennent quand le mot réduit sur mobile (#204). */
  width: 1.3em;
  height: 1.3em;
  margin-bottom: -0.467em;
}

.accueil-marque-caption {
  font: var(--text-caption);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}

@media (max-width: 767.98px) {
  .accueil-hero-interieur {
    grid-template-columns: 1fr;
    gap: var(--space-10);
  }
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
