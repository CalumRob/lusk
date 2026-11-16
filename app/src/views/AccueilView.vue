<script setup lang="ts">
/** #1027: compact introduction, tabbed territory entry and catalogue link.
 * The existing shell wait-set preserves scoped loading/error/retry behavior.
 * Editorial slots are deliberately inert until real texts and figures exist.
 * Approved direction: docs/design/accueil.md; visual approval remains human.
 */
import { ArrowRight } from 'lucide-vue-next'
import { computed, ref } from 'vue'

import AppIcon from '@/components/AppIcon.vue'
import GlobalSearchBar from '@/components/GlobalSearchBar.vue'
import LuskBrand from '@/components/LuskBrand.vue'
import { usePayload } from '@/payload/usePayload'

const { payload, erreur, chargement, recharger } = usePayload({
  attendre: ['territoires', 'run-report'],
})
const territoires = computed(() => payload.value.territoires)
const messagesErreur = computed(() => erreur.value ? 'Impossible de charger les données.' : null)
const ongletActif = ref<'rechercher' | 'parcourir'>('rechercher')
const ongletRechercher = ref<HTMLButtonElement | null>(null)
const ongletParcourir = ref<HTMLButtonElement | null>(null)

function naviguerOnglets(event: KeyboardEvent) {
  let prochain: typeof ongletActif.value
  switch (event.key) {
    case 'ArrowLeft':
    case 'ArrowRight':
      prochain = ongletActif.value === 'rechercher' ? 'parcourir' : 'rechercher'
      break
    case 'Home': prochain = 'rechercher'; break
    case 'End': prochain = 'parcourir'; break
    default: return
  }
  event.preventDefault()
  ongletActif.value = prochain
  ;(prochain === 'rechercher' ? ongletRechercher : ongletParcourir).value?.focus()
}
</script>

<template>
  <section class="accueil" :aria-busy="chargement ? 'true' : 'false'">
    <header class="accueil-hero">
      <div class="accueil-hero-interieur">
        <div class="accueil-hero-tete">
          <h1 class="accueil-accroche">Intelligence territoriale en Bretagne</h1>
          <p class="accueil-sous-titre">
            Accès aux équipements, migrations, occupation des sols, habitat… Lusk propose des données ouvertes et des analyses originales pour comprendre les dynamiques et les tensions des territoires bretons.
          </p>
        </div>
        <div class="accueil-hero-marque" aria-label="Lusk — breton, élan, mouvement">
          <LuskBrand verticale class="accueil-marque" />
        </div>
        <div class="accueil-hero-acces">
          <nav class="accueil-acces" aria-label="Explorer Lusk">
            <div class="accueil-territoires">
              <div class="accueil-onglets" role="tablist" aria-label="Accéder aux territoires" @keydown="naviguerOnglets">
                <button
                  ref="ongletRechercher"
                  id="accueil-onglet-rechercher" type="button" role="tab"
                  :aria-selected="ongletActif === 'rechercher'"
                  :tabindex="ongletActif === 'rechercher' ? 0 : -1"
                  aria-controls="accueil-panneau-rechercher"
                  @click="ongletActif = 'rechercher'"
                >Rechercher</button>
                <button
                  ref="ongletParcourir"
                  id="accueil-onglet-parcourir" type="button" role="tab"
                  :aria-selected="ongletActif === 'parcourir'"
                  :tabindex="ongletActif === 'parcourir' ? 0 : -1"
                  aria-controls="accueil-panneau-parcourir"
                  @click="ongletActif = 'parcourir'"
                >Parcourir</button>
              </div>
              <div
                :hidden="ongletActif !== 'rechercher'"
                id="accueil-panneau-rechercher" class="accueil-panneau"
                role="tabpanel" aria-labelledby="accueil-onglet-rechercher"
              >
                <GlobalSearchBar
                  class="accueil-recherche"
                  :territoires="territoires"
                  :chargement="chargement"
                  :erreur="messagesErreur"
                />
              </div>
              <div
                :hidden="ongletActif !== 'parcourir'"
                id="accueil-panneau-parcourir" class="accueil-panneau accueil-listes"
                role="tabpanel" aria-labelledby="accueil-onglet-parcourir"
              >
                <RouterLink to="/communes">
                  Communes <AppIcon :icone="ArrowRight" :taille="16" aria-hidden="true" />
                </RouterLink>
                <RouterLink to="/epcis">
                  EPCI <AppIcon :icone="ArrowRight" :taille="16" aria-hidden="true" />
                </RouterLink>
                <RouterLink to="/departements">
                  Départements <AppIcon :icone="ArrowRight" :taille="16" aria-hidden="true" />
                </RouterLink>
              </div>
            </div>
            <RouterLink to="/indicateurs" class="accueil-indicateurs">
              Explorer les indicateurs
              <AppIcon :icone="ArrowRight" :taille="16" aria-hidden="true" />
            </RouterLink>
          </nav>
          <!-- Reserve recovery space on every state so retry never shifts the layout. -->
          <div class="accueil-recuperation">
            <div v-if="messagesErreur" class="accueil-erreur">
              <p role="alert">{{ messagesErreur }}</p>
              <button type="button" class="bouton-reessayer" @click="recharger">Réessayer</button>
            </div>
          </div>
        </div>
      </div>
    </header>
    <div class="accueil-interieur">
      <ul class="accueil-editorial" aria-label="Textes à venir">
        <li v-for="emplacement in 3" :key="emplacement" class="accueil-emplacement">
          <div class="accueil-image-provisoire">Figure à venir</div>
          <p class="accueil-a-venir">À venir</p>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.accueil {
  flex: 1;
  width: 100%;
  background: var(--surface-secondary);
}
.accueil-hero {
  background: var(--surface-hero);
  border-bottom: 1px solid var(--border-subtle);
}
.accueil-hero-interieur {
  width: 100%;
  max-width: var(--content-max-width);
  margin-inline: auto;
  padding: var(--space-12) var(--grid-margin-mobile) var(--space-6);
  display: grid;
  /* Zero intrinsic minimum: neither the input nor a long result can grow the column. */
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
  grid-template-areas:
    "tete marque"
    "acces marque";
  column-gap: var(--space-12);
  row-gap: var(--space-5);
  /* #1027 owner revision: both areas start at the top of the composition. A tab
     change grows the access area downward; the brand keeps its anchored place
     instead of re-centring. This is not viewport fixed/sticky. */
  align-items: start;
}
.accueil-hero-tete {
  grid-area: tete;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}
.accueil-hero-acces {
  grid-area: acces;
  min-width: 0;
}
.accueil-accroche {
  margin: 0;
  font: var(--text-h3);
  color: var(--text-primary);
}
.accueil-sous-titre {
  margin: 0;
  font: var(--text-body-lg);
  color: var(--text-secondary);
  max-width: 52ch;
}
.accueil-acces {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-4);
  width: 100%;
  min-width: 0;
  margin-top: var(--space-2);
}
.accueil-recherche {
  width: 100%;
  min-width: 0;
}
.accueil-territoires {
  width: 100%;
  max-width: 560px;
  min-width: 0;
}
.accueil-onglets {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-bottom: var(--space-4);
  border-bottom: 1px solid var(--border-default);
}
.accueil-onglets button {
  min-width: 0;
  min-height: var(--space-12);
  padding: var(--space-2);
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  font: var(--text-body-sm);
  color: var(--text-secondary);
  cursor: pointer;
}
.accueil-onglets button[aria-selected="true"] {
  border-bottom-color: var(--accent-primary);
  color: var(--text-primary);
  font-weight: 600;
}
.accueil-onglets button:hover { background: var(--surface-tertiary); }
.accueil-onglets button:active { background: var(--surface-primary); }
/* #1027 owner revision: natural panel heights; browsing intentionally expands
   the page. The search dropdown remains out of flow in every search state. */
.accueil-panneau[hidden] { display: none; }
.accueil-listes {
  display: flex;
  flex-direction: column;
  font: var(--text-body);
}
.accueil-listes a {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  min-height: var(--space-12);
  padding: var(--space-2) var(--space-3);
  text-decoration: none;
}
.accueil-listes a:not(:last-child) {
  border-bottom: 1px solid var(--border-default);
}
.accueil-listes a:hover {
  background: var(--surface-tertiary);
  color: var(--accent-hover);
}
.accueil-listes a:active { background: var(--surface-primary); }
.accueil-listes a:focus-visible {
  outline: var(--focus-ring);
  outline-offset: -2px;
}
.accueil-indicateurs {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font: var(--text-body);
}
.accueil-recuperation {
  min-height: var(--space-20);
}
.accueil-erreur {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-4);
  font: var(--text-body-sm);
  color: var(--status-error);
}
.accueil-erreur p { margin: 0; }
.bouton-reessayer {
  padding: var(--space-2) 0;
  border: 0;
  background: transparent;
  color: var(--accent-primary);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}
.bouton-reessayer:hover { color: var(--accent-hover); }
.accueil-hero-marque {
  /* Occupy the named brand area explicitly. Auto-placement put this block in
     the first row only, stretching the intro row and opening the blank gap
     above the tabs that the owner reported. */
  grid-area: marque;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  /* Constant offset from the anchored grid start — independent of panel height. */
  padding-top: var(--space-6);
  text-align: center;
  user-select: none;
}
.accueil-hero-marque :deep(.lusk-marque) {
  /* Owner density revision: +20% on every stop; the ermine keeps its em ratio. */
  font: 600 clamp(5.4rem, 10.8vw, 9rem)/0.9 var(--font-wordmark);
  font-style: italic;
  letter-spacing: -0.02em;
  color: color-mix(in oklab, var(--brand-200) 55%, var(--surface-secondary));
  gap: 0;
}
.accueil-hero-marque :deep(.lusk-marque__ermine) {
  width: 1.3em;
  height: 1.3em;
  margin-bottom: -0.467em;
}
.accueil-interieur {
  width: 100%;
  max-width: var(--content-max-width);
  margin-inline: auto;
  padding: var(--space-10) var(--grid-margin-mobile) var(--space-6);
}
.accueil-editorial {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--grid-gutter);
  list-style: none;
  padding: 0;
  margin: 0;
}
.accueil-emplacement { min-width: 0; }
.accueil-image-provisoire {
  aspect-ratio: 3 / 2;
  display: grid;
  place-items: center;
  background: var(--surface-tertiary);
  border: 1px dashed var(--border-default);
  font: var(--text-body-sm);
  color: var(--text-secondary);
}
.accueil-a-venir {
  margin: var(--space-4) 0 0;
  font: var(--text-h3);
  color: var(--text-secondary);
}
@media (max-width: 767.98px) {
  .accueil-hero-interieur {
    grid-template-columns: minmax(0, 1fr);
    /* The brand sits BEFORE the expanding access area, so tab changes can never
       move it in the single-column flow either. Document order stays readable. */
    grid-template-areas: "tete" "marque" "acces";
    column-gap: 0;
    row-gap: var(--space-6);
    padding-top: var(--space-8);
    padding-bottom: var(--space-8);
  }
  .accueil-hero-marque { padding-top: 0; }
  .accueil-editorial { grid-template-columns: minmax(0, 1fr); }
}
</style>
