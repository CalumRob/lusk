<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import type { Territoire } from '@/payload/types'
import type { MembreSelection, SelectionComparaison } from '@/fiche/comparisonContext'
import { membreTerritoire, modifierMembres, rechercherMembres } from '@/fiche/selectionBuilder'

const props = defineProps<{
  focal: Territoire
  territoires: readonly Territoire[]
  membres: readonly MembreSelection[]
}>()
const emit = defineEmits<{ choisir: [selection: SelectionComparaison] }>()
const recherche = ref('')
const rechercheId = useId()
const resultats = computed(() => rechercherMembres(recherche.value, props.focal, props.territoires, props.membres))
const visibles = computed(() => resultats.value.slice(0, 4))
const nom = (membre: MembreSelection) => props.territoires.find((item) =>
  item.type === membre.territory_type && item.territoire === membre.territory_id)?.nom ?? membre.territory_id
function ajouter(territoire: Territoire) {
  emit('choisir', modifierMembres(props.membres, membreTerritoire(territoire), 'ajouter'))
  recherche.value = ''
}
</script>

<template>
  <section class="membres-comparaison" aria-label="Membres du groupe comparé">
    <label class="membres-comparaison__recherche-label" :for="rechercheId">Rechercher un territoire</label>
    <input :id="rechercheId" v-model="recherche" type="search" autocomplete="off" aria-label="Rechercher un territoire" placeholder="Nom ou identifiant" />
    <p v-if="recherche.trim()" role="status">{{ resultats.length ? `${resultats.length} résultat${resultats.length > 1 ? 's' : ''}` : 'Aucun territoire trouvé à ce niveau.' }}<span v-if="resultats.length > visibles.length"> — Précisez la recherche pour voir les suivants.</span></p>
    <ul v-if="visibles.length" class="membres-comparaison__resultats">
      <li v-for="resultat in visibles" :key="resultat.territoire">
        <button type="button" data-testid="ajouter-membre" @click="ajouter(resultat)">Ajouter {{ resultat.nom }}</button>
      </li>
    </ul>
    <table v-if="membres.length" class="membres-comparaison__table">
      <thead><tr><th scope="col">Territoire</th><th scope="col"><span class="sr-only">Action</span></th></tr></thead>
      <tbody>
        <tr v-for="membre in membres" :key="`${membre.territory_type}:${membre.territory_id}`">
          <th scope="row">{{ nom(membre) }}<small v-if="membre.territory_type === focal.type && membre.territory_id === focal.territoire">Territoire de la fiche</small></th>
          <td><button type="button" :aria-label="`Retirer ${nom(membre)}`" @click="emit('choisir', modifierMembres(membres, membre, 'retirer'))">Retirer</button></td>
        </tr>
      </tbody>
    </table>
    <p v-else role="status">Aucun membre : aucune comparaison.</p>
  </section>
</template>

<style scoped>
.membres-comparaison { display: grid; gap: var(--space-2); min-inline-size: 0; padding-block-start: var(--space-2); color: var(--ink, var(--text-primary)); font: 400 13px/1.35 var(--font-ui); }
.membres-comparaison__resultats { display: flex; flex-wrap: wrap; gap: var(--space-1); list-style: none; padding: 0; margin: 0; }
.membres-comparaison__recherche-label { display: block; margin-block-end: calc(-1 * var(--space-1)); font-size: 12px; }
.membres-comparaison__table { width: 100%; border-collapse: collapse; font: var(--type-figure-label); text-align: left; }
.membres-comparaison__table th, .membres-comparaison__table td { padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--border-subtle); }
.membres-comparaison__table thead { background: color-mix(in oklab, var(--cahier-default) 5%, transparent); color: var(--cahier-default); }
.membres-comparaison__table tbody th { color: var(--text-primary); font-weight: 500; overflow-wrap: anywhere; }
small { display: block; color: var(--muted, var(--text-secondary)); font-size: .85em; font-weight: 400; }
input { box-sizing: border-box; inline-size: 100%; min-inline-size: 0; min-block-size: 44px; padding: var(--space-2); border: 1px solid var(--red-soft, var(--border-default)); border-radius: 2px; background: var(--paper, var(--surface-primary)); color: inherit; font: inherit; }
.membres-comparaison__table button, .membres-comparaison__resultats button { min-block-size: 44px; padding: var(--space-1) var(--space-2); border: 0; border-radius: 0; background: transparent; color: var(--red, var(--accent-primary)); font: inherit; text-align: start; cursor: pointer; overflow-wrap: anywhere; }
button:hover { text-decoration: underline; }
button:active { background: var(--surface-tertiary); }
button:focus-visible, input:focus-visible { outline: 2px solid var(--red, var(--accent-primary)); outline-offset: 2px; }
</style>
