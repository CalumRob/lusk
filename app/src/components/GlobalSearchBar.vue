<script setup lang="ts">
/**
 * GlobalSearchBar — the way into any fiche (ui-elements.md §Search).
 * A single, untitled search box (#64): the input + results dropdown, no tabs
 * row — the placeholder carries the affordance. It searches the territoires
 * reference table (payload.territoires) by name and opens
 * /territoire/:type/:id.
 *
 * States (ui-elements.md): rest / focus / typing (debounced) / loading
 * (spinner) / empty ("Aucun résultat trouvé.") / error (muted text + icon).
 * Keyboard: arrows move the active option (aria-activedescendant), Enter
 * opens it, Escape closes, Tab exits to the page (WAI-ARIA combobox pattern).
 *
 * Props: territoires (the reference table, from the host's loaded payload),
 * chargement + erreur (optional host-driven payload states). Emits: select
 * with the opened Territoire — the host hook (C1: close the mobile drawer).
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { CircleAlert, Loader2, Search, SearchX, X } from 'lucide-vue-next'

import type { Territoire } from '../payload/types'
import { libelleType, rechercherTerritoires } from '../search/recherche'

const props = withDefaults(
  defineProps<{
    territoires: Territoire[]
    chargement?: boolean
    erreur?: string | null
  }>(),
  { chargement: false, erreur: null },
)

const emit = defineEmits<{
  select: [territoire: Territoire]
}>()

const router = useRouter()

const DUREE_DEBOUNCE = 250

const requete = ref('')
const debouncee = ref('')
const enAttente = ref(false)
const focusDansChamp = ref(false)
const actif = ref(-1)

let minuteur: ReturnType<typeof setTimeout> | null = null

const resultats = computed(() => rechercherTerritoires(props.territoires, debouncee.value))
const chargementVisuel = computed(() => enAttente.value || props.chargement)
const ouvert = computed(
  () => focusDansChamp.value && (debouncee.value.trim() !== '' || props.erreur !== null),
)

watch(requete, (nouvelle) => {
  if (minuteur) clearTimeout(minuteur)
  actif.value = -1
  if (nouvelle === '') {
    enAttente.value = false
    debouncee.value = ''
    return
  }
  enAttente.value = true
  minuteur = setTimeout(() => {
    debouncee.value = nouvelle
    enAttente.value = false
  }, DUREE_DEBOUNCE)
})

onBeforeUnmount(() => {
  if (minuteur) clearTimeout(minuteur)
})

function descendre() {
  if (resultats.value.length === 0) return
  actif.value = (actif.value + 1) % resultats.value.length
  faireDefiler(actif.value)
}

function monter() {
  if (resultats.value.length === 0) return
  if (actif.value < 0) {
    actif.value = resultats.value.length - 1
  } else {
    actif.value = (actif.value - 1 + resultats.value.length) % resultats.value.length
  }
  faireDefiler(actif.value)
}

function faireDefiler(index: number) {
  void nextTick(() => {
    document.getElementById(`gsb-option-${index}`)?.scrollIntoView({ block: 'nearest' })
  })
}

function surKeydown(e: KeyboardEvent) {
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      descendre()
      break
    case 'ArrowUp':
      e.preventDefault()
      monter()
      break
    case 'Enter':
      e.preventDefault()
      ouvrirActif()
      break
    case 'Escape':
      e.preventDefault()
      fermer()
      break
    case 'Tab':
      fermer()
      break
  }
}

function ouvrirActif() {
  if (resultats.value.length === 0) return
  const cible = actif.value >= 0 ? resultats.value[actif.value] : resultats.value[0]
  activer(cible)
}

function surSelection(t: Territoire) {
  // RouterLink carries the navigation; the row action just hooks the host.
  emit('select', t)
  reinitialiser()
}

function activer(t: Territoire) {
  emit('select', t)
  reinitialiser()
  void router.push({ name: 'territoire', params: { type: t.type, id: t.territoire } })
}

function reinitialiser() {
  if (minuteur) clearTimeout(minuteur)
  minuteur = null
  requete.value = ''
  debouncee.value = ''
  enAttente.value = false
  actif.value = -1
  focusDansChamp.value = false
}

function effacer() {
  requete.value = ''
}

function fermer() {
  focusDansChamp.value = false
  actif.value = -1
}

function surFocusout(e: FocusEvent) {
  const cible = e.currentTarget as Node | null
  const prochain = e.relatedTarget as Node | null
  if (prochain === null || !cible?.contains(prochain)) fermer()
}
</script>

<template>
  <div class="global-search" @focusout="surFocusout">
    <div class="global-search__bar">
      <Search class="global-search__icone" aria-hidden="true" />
      <input
        v-model="requete"
        class="global-search__champ"
        type="text"
        role="combobox"
        :aria-expanded="ouvert"
        aria-autocomplete="list"
        aria-controls="gsb-resultats"
        :aria-activedescendant="actif >= 0 ? `gsb-option-${actif}` : undefined"
        aria-label="Rechercher un territoire par son nom"
        placeholder="Rechercher un territoire…"
        @focus="focusDansChamp = true"
        @keydown="surKeydown"
      />
      <Loader2 v-if="chargementVisuel" class="global-search__spinner" aria-hidden="true" />
      <button
        v-else-if="requete"
        type="button"
        class="global-search__effacer"
        aria-label="Effacer la recherche"
        @click="effacer"
      >
        <X aria-hidden="true" />
      </button>
    </div>

    <div
      v-if="ouvert"
      id="gsb-panel"
      class="global-search__dropdown"
      @mousedown.prevent
    >
      <div
        v-if="resultats.length > 0"
        id="gsb-resultats"
        class="global-search__resultats"
        role="listbox"
        aria-label="Résultats"
      >
        <RouterLink
          v-for="(resultat, i) in resultats"
          :id="`gsb-option-${i}`"
          :key="resultat.territoire"
          role="option"
          :aria-selected="actif === i"
          class="global-search__option"
          :class="{ 'is-actif': actif === i }"
          :to="{ name: 'territoire', params: { type: resultat.type, id: resultat.territoire } }"
          @click="surSelection(resultat)"
        >
          <span class="global-search__nom">{{ resultat.nom }}</span>
          <span class="global-search__chip">{{ libelleType(resultat.type) }}</span>
          <span class="global-search__action">Voir la page</span>
        </RouterLink>
      </div>
      <p v-else-if="props.erreur" class="global-search__etat global-search__etat--erreur">
        <CircleAlert aria-hidden="true" />
        <span>{{ props.erreur }}</span>
      </p>
      <p v-else class="global-search__etat">
        <SearchX aria-hidden="true" />
        <span>Aucun résultat trouvé.</span>
      </p>
    </div>
  </div>
</template>

<style scoped>
.global-search {
  position: relative;
  width: 100%;
  max-width: 560px;
}

/* ---- Input bar ---- */
.global-search__bar {
  position: relative;
  display: flex;
  align-items: center;
  min-height: 48px;
  background: var(--surface-primary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-subtle);
  transition: border-color 120ms ease-out, box-shadow 120ms ease-out;
}

.global-search__bar:focus-within {
  border-color: var(--brand-500);
  box-shadow: 0 0 0 2px var(--brand-500);
}

.global-search__icone {
  width: 1.125rem;
  height: 1.125rem;
  margin-left: var(--space-3);
  color: var(--text-secondary);
  flex-shrink: 0;
}

.global-search__champ {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  font: var(--text-body);
  color: var(--text-primary);
  padding: var(--space-2) var(--space-3);
  outline: none;
}

.global-search__champ::placeholder {
  color: var(--text-tertiary);
}

.global-search__spinner {
  width: 1rem;
  height: 1rem;
  margin-inline: var(--space-3);
  color: var(--text-tertiary);
  flex-shrink: 0;
  animation: gsb-rotation 0.8s linear infinite;
}

@keyframes gsb-rotation {
  to {
    transform: rotate(360deg);
  }
}

.global-search__effacer {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  margin-inline: var(--space-2);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background-color 120ms ease-out, color 120ms ease-out;
}

.global-search__effacer:hover {
  background: var(--surface-tertiary);
  color: var(--text-primary);
}

.global-search__effacer svg {
  width: 1rem;
  height: 1rem;
}

/* ---- Dropdown ---- */
.global-search__dropdown {
  position: absolute;
  top: calc(100% + var(--space-2));
  left: 0;
  right: 0;
  z-index: var(--z-popover);
  background: var(--surface-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-prominent);
  max-height: 320px;
  overflow-y: auto;
  animation: gsb-apparition 200ms ease-in-out;
}

@keyframes gsb-apparition {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.global-search__resultats {
  padding: var(--space-1);
}

.global-search__option {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  text-decoration: none;
  transition: background-color 120ms ease-out;
}

.global-search__option:hover,
.global-search__option.is-actif {
  background: var(--surface-tertiary);
}

.global-search__nom {
  font: var(--text-body);
  font-weight: 600;
}

.global-search__chip {
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  padding: 2px var(--space-2);
  border-radius: var(--radius-full);
  background: var(--surface-tertiary);
  color: var(--text-secondary);
  white-space: nowrap;
}

.global-search__action {
  margin-left: auto;
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--accent-primary);
  white-space: nowrap;
}

.global-search__option:hover .global-search__action {
  color: var(--accent-hover);
}

/* ---- Empty / error states ---- */
.global-search__etat {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-4);
  font: var(--text-body-sm);
  color: var(--text-secondary);
}

.global-search__etat--erreur {
  color: var(--status-error);
}

.global-search__etat svg {
  width: 1rem;
  height: 1rem;
  flex-shrink: 0;
}
</style>
