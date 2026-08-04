<script setup lang="ts">
/**
 * AppHeader (DESIGN.md §5 + site-map.md §Navigation): sticky 60px chrome,
 * Lusk wordmark (serif → /) — the sole home affordance (#61) — centered nav
 * Carte · Données · Méthodes with a 2px underline on the active route,
 * Contact → calumrobertson.fr (external). No locale toggle (French-only v1).
 *
 * F3 (#53) + #61: search works everywhere, but the header's always-open
 * compact bar collapses into a « Rechercher » button; clicking it expands
 * the GlobalSearchBar in an overlay below the 60px header (dismiss on
 * outside click / Escape, managed focus). The landing hero and the drawer
 * keep their always-open search. Selecting a result closes the overlay and
 * the mobile drawer.
 *
 * Mobile (<768px): full-screen drawer — transform-only, scroll-lock, focus
 * trap, Escape closes. Données is a small disclosure dropdown to the three
 * lists (site-map.md: « may be a small dropdown »).
 */
import { ChevronDown, ExternalLink, Menu, Search, X } from 'lucide-vue-next'
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import AppIcon from '@/components/AppIcon.vue'
import GlobalSearchBar from '@/components/GlobalSearchBar.vue'
import LuskBrand from '@/components/LuskBrand.vue'
import { usePayload } from '@/payload/usePayload'
import type { Territoire } from '@/payload/types'

const route = useRoute()

const { payload, erreur, chargement } = usePayload()

const territoires = computed<Territoire[]>(() => payload.value?.territoires ?? [])

const messageErreur = computed(() => (erreur.value ? 'Impossible de charger les territoires.' : null))

const SOUS_LIENS_DONNEES = [
  { label: 'Les communes', chemin: '/communes' },
  { label: 'Les EPCI', chemin: '/epcis' },
  { label: 'Les départements', chemin: '/departements' },
] as const

const LIENS_TIROIR = [
  { label: 'Carte', chemin: '/carte' },
  { label: 'Données', chemin: '/communes' },
  { label: 'Méthodes', chemin: '/methodologie' },
] as const

function correspond(prefixes: readonly string[], chemin: string): boolean {
  return prefixes.some(
    (p) => p === '/' ? chemin === '/' : chemin === p || chemin.startsWith(`${p}/`),
  )
}

const carteActif = computed(() => correspond(['/carte'], route.path))
const methodesActif = computed(() => correspond(['/methodologie'], route.path))
const donneesActif = computed(() =>
  correspond(['/communes', '/epcis', '/departements', '/territoire'], route.path),
)

const liensSimples = computed(() => [
  { label: 'Carte', chemin: '/carte', actif: carteActif.value },
])

/* ---- Menu Données (disclosure) ---- */
const donneesOuvert = ref(false)
const conteneurDonnees = ref<HTMLElement | null>(null)

function fermerDonneesHors(ev: Event): void {
  if (conteneurDonnees.value && !conteneurDonnees.value.contains(ev.target as Node)) {
    donneesOuvert.value = false
  }
}

watch(donneesOuvert, (ouvert) => {
  if (ouvert) document.addEventListener('pointerdown', fermerDonneesHors, true)
  else document.removeEventListener('pointerdown', fermerDonneesHors, true)
})

/* ---- Recherche (#61): the « Rechercher » button expands the search in an
   overlay below the 60px header. Managed focus: into the input on open,
   back to the button on close. Escape and outside clicks dismiss. */
const rechercheOuverte = ref(false)
const boutonRecherche = ref<HTMLButtonElement | null>(null)
const panneauRecherche = ref<HTMLElement | null>(null)
const conteneurRecherche = ref<HTMLElement | null>(null)

async function ouvrirRecherche(): Promise<void> {
  rechercheOuverte.value = true
  await nextTick()
  panneauRecherche.value?.querySelector<HTMLInputElement>('input[role="combobox"]')?.focus()
}

function fermerRecherche(rendreFocus = true): void {
  if (!rechercheOuverte.value) return
  rechercheOuverte.value = false
  if (rendreFocus) boutonRecherche.value?.focus()
}

function fermerRechercheHors(ev: Event): void {
  if (conteneurRecherche.value && !conteneurRecherche.value.contains(ev.target as Node)) {
    fermerRecherche()
  }
}

function surToucheRecherche(ev: KeyboardEvent): void {
  if (ev.key === 'Escape') {
    ev.preventDefault()
    fermerRecherche()
  }
}

watch(rechercheOuverte, (estOuverte) => {
  if (estOuverte) {
    document.addEventListener('pointerdown', fermerRechercheHors, true)
    document.addEventListener('keydown', surToucheRecherche, true)
  } else {
    document.removeEventListener('pointerdown', fermerRechercheHors, true)
    document.removeEventListener('keydown', surToucheRecherche, true)
  }
})

/* ---- Tiroir mobile (drawer) ---- */
const ouvert = ref(false)
const boutonMenu = ref<HTMLButtonElement | null>(null)
const tiroir = ref<HTMLElement | null>(null)
let elementPrecedent: HTMLElement | null = null

function focusablesTiroir(): HTMLElement[] {
  const el = tiroir.value
  if (!el) return []
  return Array.from(el.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'))
}

async function ouvrir(): Promise<void> {
  ouvert.value = true
  elementPrecedent = boutonMenu.value
  document.body.classList.add('tiroir-verrouille')
  await nextTick()
  focusablesTiroir()[0]?.focus()
}

function fermer(rendreFocus = true): void {
  ouvert.value = false
  document.body.classList.remove('tiroir-verrouille')
  if (rendreFocus) elementPrecedent?.focus()
}

function surToucheTiroir(ev: KeyboardEvent): void {
  if (ev.key === 'Escape') {
    ev.preventDefault()
    fermer()
    return
  }
  if (ev.key !== 'Tab') return
  const focusables = focusablesTiroir()
  if (focusables.length === 0) return
  const premier = focusables[0]
  const dernier = focusables[focusables.length - 1]
  const actif = document.activeElement
  if (ev.shiftKey && actif === premier) {
    ev.preventDefault()
    dernier.focus()
  } else if (!ev.shiftKey && actif === dernier) {
    ev.preventDefault()
    premier.focus()
  }
}

watch(ouvert, (estOuvert) => {
  if (estOuvert) document.addEventListener('keydown', surToucheTiroir, true)
  else document.removeEventListener('keydown', surToucheTiroir, true)
})

onUnmounted(() => {
  document.removeEventListener('keydown', surToucheTiroir, true)
  document.removeEventListener('pointerdown', fermerDonneesHors, true)
  document.removeEventListener('pointerdown', fermerRechercheHors, true)
  document.removeEventListener('keydown', surToucheRecherche, true)
  document.body.classList.remove('tiroir-verrouille')
})
</script>

<template>
  <header class="en-tete">
    <div class="en-tete-interieur">
      <RouterLink to="/" class="en-tete-marque" aria-label="lusk — Accueil">
        <LuskBrand />
      </RouterLink>

      <nav class="nav-bureau" aria-label="Navigation principale">
        <RouterLink
          v-for="lien in liensSimples"
          :key="lien.chemin"
          :to="lien.chemin"
          class="nav-lien"
          :class="{ 'nav-lien--actif': lien.actif }"
        >{{ lien.label }}</RouterLink>

        <div ref="conteneurDonnees" class="nav-item" :class="{ 'nav-item--actif': donneesActif }">
          <button
            type="button"
            class="nav-lien"
            :class="{ 'nav-lien--actif': donneesActif }"
            :aria-expanded="donneesOuvert ? 'true' : 'false'"
            aria-haspopup="true"
            @click="donneesOuvert = !donneesOuvert"
            @keydown.escape="donneesOuvert = false"
          >
            Données
            <AppIcon
              :icone="ChevronDown"
              :taille="16"
              class="nav-fleche"
              :class="{ 'nav-fleche--ouvert': donneesOuvert }"
            />
          </button>
          <ul v-show="donneesOuvert" class="sous-nav">
            <li v-for="sous in SOUS_LIENS_DONNEES" :key="sous.chemin">
              <RouterLink
                :to="sous.chemin"
                class="sous-nav-lien"
                @click="donneesOuvert = false"
              >{{ sous.label }}</RouterLink>
            </li>
          </ul>
        </div>

        <RouterLink
          to="/methodologie"
          class="nav-lien"
          :class="{ 'nav-lien--actif': methodesActif }"
        >Méthodes</RouterLink>
      </nav>

      <div ref="conteneurRecherche" class="en-tete-recherche">
        <button
          ref="boutonRecherche"
          type="button"
          class="bouton-recherche"
          :aria-expanded="rechercheOuverte ? 'true' : 'false'"
          aria-controls="recherche-superposee"
          @click="rechercheOuverte ? fermerRecherche() : ouvrirRecherche()"
        >
          <AppIcon :icone="Search" :taille="18" />
          Rechercher
        </button>

        <div
          v-if="rechercheOuverte"
          id="recherche-superposee"
          ref="panneauRecherche"
          class="recherche-superposee"
        >
          <div class="recherche-superposee-interieur">
            <GlobalSearchBar
              class="recherche-superposee-barre"
              :territoires="territoires"
              :chargement="chargement"
              :erreur="messageErreur"
              @select="fermerRecherche(); fermer()"
            />
          </div>
        </div>
      </div>

      <a
        class="bouton-contact"
        href="https://calumrobertson.fr"
        target="_blank"
        rel="noopener noreferrer"
      >
        Contact
        <AppIcon :icone="ExternalLink" :taille="16" />
      </a>

      <button
        ref="boutonMenu"
        type="button"
        class="bouton-menu"
        :aria-expanded="ouvert ? 'true' : 'false'"
        aria-controls="menu-mobile"
        aria-label="Menu"
        @click="ouvert ? fermer() : ouvrir()"
      >
        <AppIcon :icone="Menu" :taille="24" />
      </button>
    </div>

    <div
      id="menu-mobile"
      ref="tiroir"
      class="tiroir"
      :class="{ 'tiroir--ouvert': ouvert }"
      :aria-hidden="ouvert ? 'false' : 'true'"
    >
      <div class="tiroir-tete">
        <RouterLink to="/" class="en-tete-marque" @click="fermer()">
          <LuskBrand />
        </RouterLink>
        <button
          type="button"
          class="tiroir-fermer"
          aria-label="Fermer le menu"
          @click="fermer()"
        >
          <AppIcon :icone="X" :taille="24" />
        </button>
      </div>
      <div class="tiroir-recherche">
        <GlobalSearchBar
          :territoires="territoires"
          :chargement="chargement"
          :erreur="messageErreur"
          @select="fermer()"
        />
      </div>
      <nav class="nav-tiroir" aria-label="Navigation principale">
        <RouterLink
          v-for="lien in LIENS_TIROIR"
          :key="lien.chemin"
          :to="lien.chemin"
          class="tiroir-lien"
          @click="fermer()"
        >{{ lien.label }}</RouterLink>
        <RouterLink
          v-for="sous in SOUS_LIENS_DONNEES"
          :key="sous.chemin"
          :to="sous.chemin"
          class="tiroir-lien tiroir-lien--sous"
          @click="fermer()"
        >{{ sous.label }}</RouterLink>
        <a
          class="tiroir-lien"
          href="https://calumrobertson.fr"
          target="_blank"
          rel="noopener noreferrer"
          @click="fermer()"
        >Contact</a>
      </nav>
    </div>
  </header>
</template>

<style scoped>
.en-tete {
  position: sticky;
  top: 0;
  z-index: var(--z-header);
  height: var(--header-height);
  background: var(--surface-chrome);
  -webkit-backdrop-filter: blur(var(--blur-chrome));
  backdrop-filter: blur(var(--blur-chrome));
  border-bottom: 1px solid var(--border-subtle);
}

.en-tete-interieur {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-6);
  height: 100%;
  max-width: var(--header-max-width);
  margin-inline: auto;
  padding: 0 var(--space-6);
}

.en-tete-marque {
  display: inline-flex;
  align-items: center;
  text-decoration: none;
}

/* F3 (#53) + #61: the search collapses into the « Rechercher » button,
   right-aligned before Contact; the expanded bar overlays below the header. */
.en-tete-recherche {
  margin-left: auto;
  flex-shrink: 0;
}

.bouton-recherche {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: 40px;
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-primary);
  color: var(--text-primary);
  font: var(--text-body-sm);
  font-weight: 600;
  box-shadow: var(--shadow-subtle);
  cursor: pointer;
  transition: background-color 120ms ease-out, border-color 120ms ease-out;
}

.bouton-recherche:hover,
.bouton-recherche[aria-expanded='true'] {
  background: var(--surface-tertiary);
  border-color: var(--brand-500);
}

.recherche-superposee {
  position: fixed;
  top: var(--header-height);
  left: 0;
  right: 0;
  z-index: var(--z-header);
  padding: var(--space-4) 0;
  background: var(--surface-elevated);
  border-bottom: 1px solid var(--border-default);
  box-shadow: var(--shadow-prominent);
  animation: recherche-apparition 200ms ease-in-out;
}

.recherche-superposee-interieur {
  max-width: var(--header-max-width);
  margin-inline: auto;
  padding: 0 var(--space-6);
  display: flex;
  justify-content: flex-end;
}

@keyframes recherche-apparition {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.nav-bureau {
  position: absolute;
  left: 50%;
  top: 0;
  display: flex;
  align-items: center;
  gap: var(--space-6);
  height: 100%;
  transform: translateX(-50%);
}

.nav-lien {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  height: 100%;
  padding: 0 var(--space-1);
  border: 0;
  background: none;
  color: var(--text-secondary);
  font: var(--text-body-sm);
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}

/* The 2px active underline — transform-only (DESIGN.md §6). */
.nav-lien::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: var(--brand-500);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 200ms ease-in-out;
}

.nav-lien--actif {
  color: var(--text-primary);
}

.nav-lien--actif::after {
  transform: scaleX(1);
}

.nav-item {
  position: relative;
  height: 100%;
}

.nav-fleche {
  color: var(--text-tertiary);
  transition: transform 200ms ease-in-out;
}

.nav-fleche--ouvert {
  transform: rotate(180deg);
}

.sous-nav {
  position: absolute;
  top: calc(100% - 2px);
  left: 50%;
  transform: translateX(-50%);
  min-width: 200px;
  margin: 0;
  padding: var(--space-2);
  list-style: none;
  background: var(--surface-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-prominent);
}

.sous-nav-lien {
  display: block;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font: var(--text-body-sm);
}

.sous-nav-lien:hover {
  background: var(--surface-tertiary);
}

.bouton-contact {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: 36px;
  padding: 0 var(--space-4);
  border-radius: var(--radius-md);
  background: var(--brand-600);
  color: #ffffff;
  font: var(--text-body-sm);
  font-weight: 600;
  transition: background-color 150ms ease-out;
}

.bouton-contact:hover {
  background: var(--brand-700);
  color: #ffffff;
}

.bouton-menu {
  display: none;
  margin-left: auto;
  width: 44px;
  height: 44px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-primary);
  cursor: pointer;
}

/* Mobile < 768px: the drawer replaces the centered nav + Contact. */
@media (max-width: 767.98px) {
  .nav-bureau {
    display: none;
  }

  .en-tete-recherche {
    display: none;
  }

  .bouton-contact {
    display: none;
  }

  .bouton-menu {
    display: inline-flex;
  }
}

.tiroir {
  position: fixed;
  inset: 0;
  z-index: var(--z-drawer);
  display: flex;
  flex-direction: column;
  background: var(--surface-elevated);
  transform: translateX(100%);
  visibility: hidden;
  transition:
    transform 300ms cubic-bezier(0.16, 1, 0.3, 1),
    visibility 0s linear 300ms;
}

.tiroir--ouvert {
  transform: translateX(0);
  visibility: visible;
  transition: transform 300ms cubic-bezier(0.16, 1, 0.3, 1);
}

@media (min-width: 768px) {
  .tiroir {
    display: none;
  }
}

.tiroir-tete {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--header-height);
  padding: 0 var(--space-6);
  border-bottom: 1px solid var(--border-subtle);
}

.tiroir-fermer {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-primary);
  cursor: pointer;
}

.tiroir-recherche {
  padding: var(--space-4) var(--space-6) var(--space-2);
}

.nav-tiroir {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-6);
  overflow-y: auto;
}

.tiroir-lien {
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font: var(--text-body-lg);
  font-weight: 500;
}

.tiroir-lien--sous {
  padding-left: var(--space-10);
  font: var(--text-body);
  color: var(--text-secondary);
}

.tiroir-lien:hover {
  background: var(--surface-tertiary);
}
</style>
