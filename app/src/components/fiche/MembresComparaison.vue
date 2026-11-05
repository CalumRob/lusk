<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import type { Territoire } from '@/payload/types'
import type { MembreSelection, SelectionComparaison } from '@/fiche/comparisonContext'
import { membreTerritoire, modifierMembres } from '@/fiche/selectionBuilder'

const props = defineProps<{
  focal: Territoire
  territoires: readonly Territoire[]
  membres: readonly MembreSelection[]
}>()
const emit = defineEmits<{ choisir: [selection: SelectionComparaison] }>()
const recherche = ref('')
const rechercheId = useId()
const eligible = computed(() => props.territoires.filter((item) => item.type === props.focal.type))
const normaliser = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr').trim()
const filtrables = computed(() => {
  const query = normaliser(recherche.value)
  return query ? eligible.value.filter((item) =>
    normaliser(item.nom).includes(query) || item.territoire.toLocaleLowerCase('fr').includes(query)) : eligible.value
})
const dedans = computed(() => filtrables.value.filter((item) =>
  props.membres.some((member) => member.territory_type === item.type && member.territory_id === item.territoire)))
const dehors = computed(() => filtrables.value.filter((item) =>
  !props.membres.some((member) => member.territory_type === item.type && member.territory_id === item.territoire)))
function basculer(territoire: Territoire, action: 'ajouter' | 'retirer') {
  emit('choisir', modifierMembres(props.membres, membreTerritoire(territoire), action))
}
</script>

<template>
  <section class="membres-comparaison" aria-label="Membres du groupe comparé">
    <label class="membres-comparaison__recherche-label" :for="rechercheId">Rechercher un territoire</label>
    <input :id="rechercheId" v-model="recherche" type="search" autocomplete="off" aria-label="Rechercher un territoire" placeholder="Nom ou identifiant" />
    <div class="membres-comparaison__colonnes">
      <section class="membres-comparaison__colonne membres-comparaison__colonne--dedans" aria-label="Dans le groupe">
        <h3>Dans le groupe</h3>
        <ul>
          <li v-for="territoire in dedans" :key="`${territoire.type}:${territoire.territoire}`">
            <span>{{ territoire.nom }}<small v-if="territoire.type === focal.type && territoire.territoire === focal.territoire">Territoire de la fiche</small></span>
            <button type="button" :aria-label="`Retirer ${territoire.nom}`" @click="basculer(territoire, 'retirer')">Retirer</button>
          </li>
          <li v-if="!dedans.length" class="membres-comparaison__vide">Aucun membre dans le groupe.</li>
        </ul>
      </section>
      <section class="membres-comparaison__colonne membres-comparaison__colonne--dehors" aria-label="Hors du groupe">
        <h3>Hors du groupe</h3>
        <ul>
          <li v-for="territoire in dehors" :key="`${territoire.type}:${territoire.territoire}`">
            <span>{{ territoire.nom }}</span>
            <button type="button" :aria-label="`Ajouter ${territoire.nom}`" @click="basculer(territoire, 'ajouter')">Ajouter</button>
          </li>
          <li v-if="!dehors.length" class="membres-comparaison__vide">Aucun autre territoire correspondant.</li>
        </ul>
      </section>
    </div>
    <p v-if="!filtrables.length" role="status">Aucun territoire correspondant.</p>
  </section>
</template>

<style scoped>
.membres-comparaison { display: grid; gap: var(--space-2); min-inline-size: 0; padding-block-start: var(--space-2); color: var(--ink, var(--text-primary)); font: 400 13px/1.35 var(--font-ui); }
.membres-comparaison__recherche-label { display: block; margin-block-end: calc(-1 * var(--space-1)); font-size: 12px; }
.membres-comparaison__colonnes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); min-height: 0; }
.membres-comparaison__colonne { display: grid; grid-template-rows: auto minmax(0, 1fr); min-width: 0; max-height: min(36dvh, 324px); border: 1px solid color-mix(in oklab, var(--cahier-default) 24%, transparent); }
.membres-comparaison__colonne h3 { position: sticky; z-index: 1; top: 0; margin: 0; padding: var(--space-2) var(--space-3); background: var(--paper, #f1f2ec); color: var(--cahier-default); font: var(--type-figure-label); }
.membres-comparaison__colonne ul { min-height: 0; overflow-y: auto; overscroll-behavior: contain; margin: 0; padding: 0; list-style: none; }
.membres-comparaison__colonne li { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); min-width: 0; padding-inline: var(--space-3); border-bottom: 1px solid var(--border-subtle); font: var(--type-figure-label); }
.membres-comparaison__colonne li > span { min-width: 0; padding-block: var(--space-2); overflow-wrap: anywhere; }
.membres-comparaison__vide { padding-block: var(--space-2); color: var(--muted, var(--text-secondary)); }
small { display: block; color: var(--muted, var(--text-secondary)); font-size: .85em; font-weight: 400; }
input { box-sizing: border-box; inline-size: 100%; min-inline-size: 0; min-block-size: 44px; padding: var(--space-2); border: 1px solid var(--red-soft, var(--border-default)); border-radius: 2px; background: var(--paper, var(--surface-primary)); color: inherit; font: inherit; }
.membres-comparaison__colonne button { flex: 0 0 auto; min-block-size: 44px; padding: var(--space-1) var(--space-2); border: 0; border-radius: 0; font: inherit; text-align: start; cursor: pointer; overflow-wrap: anywhere; }
.membres-comparaison__colonne--dedans button { background: transparent; color: var(--muted, var(--text-secondary)); }
.membres-comparaison__colonne--dehors button { background: color-mix(in oklab, var(--brand-200) 24%, transparent); color: var(--brand-600); }
.membres-comparaison__colonne--dehors button:hover { background: color-mix(in oklab, var(--brand-200) 40%, transparent); }
button:hover { text-decoration: underline; }
button:active { background: var(--surface-tertiary); }
button:focus-visible, input:focus-visible { outline: 2px solid var(--red, var(--accent-primary)); outline-offset: 2px; }
</style>
