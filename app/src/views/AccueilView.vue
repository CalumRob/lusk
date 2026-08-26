<script setup lang="ts">
/**
 * L'accueil — the landing (#410 — la bascule atomique). The visitor chooses
 * between TWO equal primary calls to action: territory-first (the
 * GlobalSearchBar, deliberately territory-only — PRD #398 story 42) and
 * indicator-first (« Explorer les indicateurs » → /indicateurs). The hero
 * opens with the LuskBrand lockup and the title « lusk · Intelligence
 * territoriale en Bretagne » (mock/brand/iterations/v8.html — the brand
 * moment, DESIGN.md §1); the freshness line makes the "alive" promise literal
 * (ligneFraicheur from the run report) and leads to Sources; the outro closes
 * with the thesis-as-evidence teaser and Sources.
 *
 * La carte n'est plus proposée (#410) : épargnée par ruling produit
 * (2026-08-26) comme outil personnel du PO, mais SANS AUCUN lien depuis
 * l'accueil.
 *
 * The hero is its own full-bleed band on --surface-hero, separated vertically
 * from the plain page surface by the band edge + border (DESIGN.md §7) — the
 * two zones never blur together. The carousel was removed (#204): the landing
 * is hero → outro, with no random draw.
 *
 * States (ui-elements.md): the wait-set gate (#300) — the hero renders as
 * soon as territoires + run-report have settled (the search usable after one
 * round-trip); the theme tables, programmes and vintages stream in the
 * background and never gate the first paint. Typed PayloadError with a Retry
 * button when the wait-set fails; honest static-rhythm freshness fallback
 * until the run report lands.
 */
import { AlertCircle, ArrowRight } from 'lucide-vue-next'
import { computed } from 'vue'

import AppIcon from '@/components/AppIcon.vue'
import GlobalSearchBar from '@/components/GlobalSearchBar.vue'
import LuskBrand from '@/components/LuskBrand.vue'
import { ligneFraicheur } from '@/payload/selectors'
import type { Territoire } from '@/payload/types'
import { usePayload } from '@/payload/usePayload'

const { payload, erreur, chargement, recharger } = usePayload({
  attendre: ['territoires', 'run-report'],
})

const territoires = computed<Territoire[]>(() => payload.value.territoires)

const fraicheur = computed(() => {
  if (erreur.value) return 'Données actualisées chaque semaine'
  return ligneFraicheur(payload.value)
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

          <!-- Les deux portes d'entrée (#410) : le territoire d'abord (la
               recherche, délibérément territoires-seule) et les indicateurs à
               égalité — deux chemins primaires, jamais une hiérarchie. -->
          <nav class="accueil-portes" aria-label="Les deux chemins d’exploration">
            <div class="porte porte--territoires">
              <h2 class="porte-titre">Territoires</h2>
              <p class="porte-texte">
                La fiche d'identité de chaque commune, EPCI et département de Bretagne.
              </p>
              <GlobalSearchBar
                class="porte-recherche"
                :territoires="territoires"
                :chargement="chargement"
                :erreur="messagesErreur"
              />
            </div>
            <RouterLink to="/indicateurs" class="porte porte--indicateurs">
              <h2 class="porte-titre">Indicateurs</h2>
              <p class="porte-texte">
                Chaque indicateur publié, lu à travers tous les territoires comparables.
              </p>
              <span class="porte-action">
                Explorer les indicateurs
                <AppIcon :icone="ArrowRight" :taille="16" aria-hidden="true" />
              </span>
            </RouterLink>
          </nav>

          <div class="accueil-produit">
            <RouterLink
              v-if="fraicheur"
              to="/sources"
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
        <RouterLink to="/sources" class="accueil-sources">Sources</RouterLink>
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

/* ---- Les deux portes d'entrée (#410) : deux chemins primaires de même
   poids — la recherche (territoires) et le catalogue (indicateurs). ---- */
.accueil-portes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-6);
  margin-top: var(--space-4);
}

.porte {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-6);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--surface-primary);
}

.porte-titre {
  margin: 0;
  font: 600 1.375rem/1.3 var(--font-serif);
  color: var(--text-primary);
}

.porte-texte {
  margin: 0;
  font: var(--text-body-sm);
  color: var(--text-secondary);
  max-width: 46ch;
}

.porte-recherche {
  margin-top: auto;
}

/* La porte indicateurs est un lien-bloc entier — même poids visuel que la
   porte territoires, l'action explicite en bas (aligné sur la recherche). */
.porte--indicateurs {
  color: inherit;
  text-decoration: none;
  transition: border-color 150ms ease-out;
}

.porte--indicateurs:hover {
  border-color: var(--brand-500);
}

.porte-action {
  margin-top: auto;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font: var(--text-body);
  font-weight: 600;
  color: var(--accent-primary);
}

.porte--indicateurs:hover .porte-action {
  color: var(--accent-hover);
}

@media (max-width: 767.98px) {
  .accueil-portes {
    grid-template-columns: 1fr;
  }
}

.accueil-produit {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4) var(--space-8);
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

.accueil-sources {
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
