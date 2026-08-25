<script setup lang="ts">
/**
 * Une ligne de résultat de la recherche (#409) — le fragment PARTAGÉ des trois
 * sites d'appel de la barre globale : le groupe « Territoires » du mode groupé,
 * le groupe « Indicateurs », et la liste plate du mode territoire-only (héros,
 * carte #283). Une entrée Territoire mène à la fiche (ou zoome la carte en
 * mode sans navigation) ; une entrée Indicateur mène à SA Page d'indicateur.
 *
 * La ligne est purement présentationnelle : l'id plat (gsb-option-N — la liste
 * que le clavier traverse) et l'action de clic sont portés par HÉRITAGE
 * d'attributs depuis l'appelant, qui garde l'item dans sa portée.
 */
import { computed } from 'vue'

import type { Territoire } from '../payload/types'
import { libelleType } from '../search/recherche'
import type { EntreeRechercheIndicateur } from '../search/recherche'

const props = defineProps<{
  /** La moitié de la liste plate que la ligne rend. */
  genre: 'territoire' | 'indicateur'
  /** Le résultat Territoire — requis quand genre='territoire'. */
  resultat?: Territoire
  /** L'entrée du catalogue — requise quand genre='indicateur'. */
  entree?: EntreeRechercheIndicateur
  /** L'état actif du clavier (aria-selected + la classe is-actif). */
  actif: boolean
  /** Mode sans navigation (#283) : les territoires deviennent des boutons. */
  sansNavigation?: boolean
}>()

/** La racine : un bouton pour le zoom carte, un lien sinon. */
const racine = computed(() =>
  props.genre === 'territoire' && props.sansNavigation ? 'button' : 'router-link',
)

/** La cible du lien — jamais défini sous un bouton (l'attribut to ne se rend pas). */
const cible = computed(() => {
  if (props.genre === 'indicateur') return props.entree?.href
  return props.sansNavigation
    ? undefined
    : props.resultat && {
        name: 'territoire',
        params: { type: props.resultat.type, id: props.resultat.territoire },
      }
})
</script>

<template>
  <component
    :is="racine"
    role="option"
    :aria-selected="actif ? 'true' : 'false'"
    class="global-search__option"
    :class="{
      'is-actif': actif,
      'global-search__option--indicateur': genre === 'indicateur',
    }"
    :type="racine === 'button' ? 'button' : undefined"
    :to="cible"
  >
    <template v-if="genre === 'territoire' && resultat">
      <span class="global-search__nom">{{ resultat.nom }}</span>
      <span class="global-search__chip">{{ libelleType(resultat.type) }}</span>
      <span class="global-search__action">
        {{ sansNavigation ? 'Sur la carte' : 'Voir la page' }}
      </span>
    </template>
    <template v-else-if="entree">
      <span class="global-search__nom">{{ entree.label }}</span>
      <span class="global-search__chip">{{ entree.themeLabel }}</span>
      <span class="global-search__action">Voir l’indicateur</span>
    </template>
  </component>
</template>

<style scoped>
/* Les styles des lignes voyagent AVEC le fragment — les trois sites d'appel
   les partagent, le parent n'en garde aucune copie. */
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

/* Le mode sans navigation (#283) : les résultats sont des boutons — la carte
   zoome sur l'entité au lieu d'ouvrir la fiche. Même look que la ligne lien. */
button.global-search__option {
  width: 100%;
  border: 0;
  background: transparent;
  font: var(--text-body);
  text-align: start;
  cursor: pointer;
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
</style>
