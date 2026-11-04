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
const visibles = computed(() => resultats.value.slice(0, 20))
const nom = (membre: MembreSelection) => props.territoires.find((item) =>
  item.type === membre.territory_type && item.territoire === membre.territory_id)?.nom ?? membre.territory_id
function ajouter(territoire: Territoire) {
  emit('choisir', modifierMembres(props.membres, membreTerritoire(territoire), 'ajouter'))
  recherche.value = ''
}
</script>

<template>
  <section class="membres-comparaison" aria-label="Membres du groupe comparé">
    <h3>Membres du groupe</h3>
    <ul v-if="membres.length" class="membres-comparaison__liste">
      <li v-for="membre in membres" :key="`${membre.territory_type}:${membre.territory_id}`">
        <span>{{ nom(membre) }}<small v-if="membre.territory_type === focal.type && membre.territory_id === focal.territoire">Territoire de la fiche</small></span>
        <button type="button" :aria-label="`Retirer ${nom(membre)}`" @click="emit('choisir', modifierMembres(membres, membre, 'retirer'))">Retirer</button>
      </li>
    </ul>
    <p v-else role="status">Aucun membre : aucune comparaison.</p>
    <label :for="rechercheId">Ajouter un territoire du même niveau</label>
    <input :id="rechercheId" v-model="recherche" type="search" autocomplete="off" placeholder="Nom ou identifiant" />
    <p v-if="recherche.trim()" role="status">{{ resultats.length ? `${resultats.length} résultat${resultats.length > 1 ? 's' : ''}` : 'Aucun territoire trouvé à ce niveau.' }}<span v-if="resultats.length > visibles.length"> — Précisez la recherche pour voir les suivants.</span></p>
    <ul v-if="visibles.length" class="membres-comparaison__liste">
      <li v-for="resultat in visibles" :key="resultat.territoire">
        <button type="button" data-testid="ajouter-membre" @click="ajouter(resultat)">Ajouter {{ resultat.nom }}</button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.membres-comparaison { min-inline-size: 0; border-top: 1px solid var(--red-soft, var(--border-subtle)); padding-block: var(--space-3); color: var(--ink, var(--text-primary)); font: 400 14px/1.4 var(--font-ui); }
h3 { margin: 0 0 var(--space-3); font: 600 11px/1.3 var(--font-ui); letter-spacing: 0.06em; text-transform: uppercase; }
.membres-comparaison__liste { list-style: none; padding: 0; margin: 0 0 var(--space-3); }
li { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); border-bottom: 1px solid var(--red-soft, var(--border-subtle)); }
li span { min-inline-size: 0; }
small { display: block; color: var(--muted, var(--text-secondary)); }
label { display: block; margin-block-end: var(--space-2); }
input { box-sizing: border-box; inline-size: 100%; min-inline-size: 0; min-block-size: 44px; padding: var(--space-2); border: 1px solid var(--red-soft, var(--border-default)); border-radius: 2px; background: var(--paper, var(--surface-primary)); color: inherit; font: inherit; }
button { min-block-size: 44px; padding: var(--space-2); border: 0; border-radius: 2px; background: transparent; color: var(--red, var(--accent-primary)); font: inherit; text-align: start; cursor: pointer; overflow-wrap: anywhere; }
button:hover { text-decoration: underline; }
button:active { background: var(--surface-tertiary); }
button:focus-visible, input:focus-visible { outline: 2px solid var(--red, var(--accent-primary)); outline-offset: 2px; }
</style>
