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
const lignes = computed(() => Math.max(dedans.value.length, dehors.value.length))
function basculer(territoire: Territoire, action: 'ajouter' | 'retirer') {
  emit('choisir', modifierMembres(props.membres, membreTerritoire(territoire), action))
}
</script>

<template>
  <section class="membres-comparaison" aria-label="Membres du groupe comparé">
    <label class="membres-comparaison__recherche-label" :for="rechercheId">Rechercher un territoire</label>
    <input :id="rechercheId" v-model="recherche" type="search" autocomplete="off" aria-label="Rechercher un territoire" placeholder="Nom ou identifiant" />
    <div class="membres-comparaison__table-scroll">
    <table class="membres-comparaison__table">
      <thead><tr><th scope="col">Dans le groupe</th><th scope="col">Hors du groupe</th></tr></thead>
      <tbody>
        <tr v-for="index in lignes" :key="index">
          <td v-if="dedans[index - 1]" class="membres-comparaison__cell">
            <span>{{ dedans[index - 1]!.nom }}<small v-if="dedans[index - 1]!.type === focal.type && dedans[index - 1]!.territoire === focal.territoire">Territoire de la fiche</small></span>
            <button type="button" :aria-label="`Retirer ${dedans[index - 1]!.nom}`" @click="basculer(dedans[index - 1]!, 'retirer')">Retirer</button>
          </td>
          <td v-else></td>
          <td v-if="dehors[index - 1]" class="membres-comparaison__cell">
            <span>{{ dehors[index - 1]!.nom }}</span>
            <button type="button" :aria-label="`Ajouter ${dehors[index - 1]!.nom}`" @click="basculer(dehors[index - 1]!, 'ajouter')">Ajouter</button>
          </td>
          <td v-else></td>
        </tr>
      </tbody>
    </table>
    <p v-if="!filtrables.length" role="status">Aucun territoire correspondant.</p>
    </div>
  </section>
</template>

<style scoped>
.membres-comparaison { display: grid; gap: var(--space-2); min-inline-size: 0; padding-block-start: var(--space-2); color: var(--ink, var(--text-primary)); font: 400 13px/1.35 var(--font-ui); }
.membres-comparaison__recherche-label { display: block; margin-block-end: calc(-1 * var(--space-1)); font-size: 12px; }
.membres-comparaison__table-scroll { max-height: min(36dvh, 324px); min-height: 0; overflow: auto; border: 1px solid color-mix(in oklab, var(--cahier-default) 24%, transparent); }
.membres-comparaison__table { width: 100%; border-collapse: collapse; font: var(--type-figure-label); text-align: left; }
.membres-comparaison__table th, .membres-comparaison__table td { padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--border-subtle); }
.membres-comparaison__table thead { position: sticky; z-index: 1; top: 0; background: var(--paper, #f1f2ec); color: var(--cahier-default); }
.membres-comparaison__table tbody th { color: var(--text-primary); font-weight: 500; overflow-wrap: anywhere; }
.membres-comparaison__cell { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); min-width: 0; }
small { display: block; color: var(--muted, var(--text-secondary)); font-size: .85em; font-weight: 400; }
input { box-sizing: border-box; inline-size: 100%; min-inline-size: 0; min-block-size: 44px; padding: var(--space-2); border: 1px solid var(--red-soft, var(--border-default)); border-radius: 2px; background: var(--paper, var(--surface-primary)); color: inherit; font: inherit; }
.membres-comparaison__table button { flex: 0 0 auto; min-block-size: 44px; padding: var(--space-1) var(--space-2); border: 0; border-radius: 0; background: transparent; color: var(--red, var(--accent-primary)); font: inherit; text-align: start; cursor: pointer; overflow-wrap: anywhere; }
button:hover { text-decoration: underline; }
button:active { background: var(--surface-tertiary); }
button:focus-visible, input:focus-visible { outline: 2px solid var(--red, var(--accent-primary)); outline-offset: 2px; }
</style>
