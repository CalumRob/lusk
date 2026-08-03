<script setup lang="ts">
/**
 * AppHeader (DESIGN.md §5 + site-map.md §Navigation): sticky 60px chrome,
 * Lusk wordmark (serif → /), centered nav Accueil · Carte · Données ·
 * Méthodes with a 2px underline on the active route, Contact →
 * calumrobertson.fr (external). No locale toggle (French-only v1).
 *
 * Mobile (<768px): full-screen drawer — transform-only, scroll-lock, focus
 * trap, Escape closes. Données is a small disclosure dropdown to the three
 * lists (site-map.md: « may be a small dropdown »).
 */
import { ChevronDown, ExternalLink, Menu, X } from 'lucide-vue-next'
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import AppIcon from '@/components/AppIcon.vue'

const route = useRoute()

const SOUS_LIENS_DONNEES = [
  { label: 'Les communes', chemin: '/communes' },
  { label: 'Les EPCI', chemin: '/epcis' },
  { label: 'Les départements', chemin: '/departements' },
] as const

const LIENS_TIROIR = [
  { label: 'Accueil', chemin: '/' },
  { label: 'Carte', chemin: '/carte' },
  { label: 'Données', chemin: '/communes' },
  { label: 'Méthodes', chemin: '/methodologie' },
] as const

function correspond(prefixes: readonly string[], chemin: string): boolean {
  return prefixes.some(
    (p) => p === '/' ? chemin === '/' : chemin === p || chemin.startsWith(`${p}/`),
  )
}

const accueilActif = computed(() => route.path === '/')
const carteActif = computed(() => correspond(['/carte'], route.path))
const methodesActif = computed(() => correspond(['/methodologie'], route.path))
const donneesActif = computed(() =>
  correspond(['/communes', '/epcis', '/departements', '/territoire'], route.path),
)

const liensSimples = computed(() => [
  { label: 'Accueil', chemin: '/', actif: accueilActif.value },
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
  document.body.classList.remove('tiroir-verrouille')
})
</script>

<template>
  <header class="en-tete">
    <div class="en-tete-interieur">
      <RouterLink to="/" class="en-tete-marque">Lusk</RouterLink>

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
        <RouterLink to="/" class="en-tete-marque" @click="fermer()">Lusk</RouterLink>
        <button
          type="button"
          class="tiroir-fermer"
          aria-label="Fermer le menu"
          @click="fermer()"
        >
          <AppIcon :icone="X" :taille="24" />
        </button>
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
  font: 600 1.25rem/1 var(--font-serif);
  color: var(--text-primary);
  letter-spacing: -0.01em;
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
  margin-left: auto;
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
