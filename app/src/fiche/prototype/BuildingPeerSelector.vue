<script setup lang="ts">
import { computed, ref, watch } from 'vue'

export interface PeerTerritory { type: 'commune' | 'epci' | 'departement' | 'region'; id: string; name: string }

const props = defineProps<{
  territories: readonly PeerTerritory[]
  catalogStatus: 'loading' | 'ready' | 'error'
  comparisonStatus: 'idle' | 'loading' | 'ready' | 'error'
  selected: readonly PeerTerritory[] | null
}>()
const emit = defineEmits<{ select: [territories: PeerTerritory[]]; clear: [] }>()
const search = ref('')
const chosen = ref<PeerTerritory[]>([])
watch(() => props.selected, (value) => { chosen.value = value ? [...value] : [] }, { immediate: true })
const matches = computed(() => {
  const query = search.value.trim().toLocaleLowerCase('fr-FR')
  return query.length < 2 ? [] : props.territories.filter((item) =>
    !chosen.value.some((peer) => peer.type === item.type && peer.id === item.id)
    && `${item.name} ${item.id}`.toLocaleLowerCase('fr-FR').includes(query)).slice(0, 20)
})
function add(item: PeerTerritory): void { chosen.value = [...chosen.value, item]; search.value = '' }
function remove(item: PeerTerritory): void {
  chosen.value = chosen.value.filter((peer) => peer.type !== item.type || peer.id !== item.id)
}
</script>

<template>
  <div class="building-peers">
    <label for="building-peer-search">Choisir les territoires du groupe comparé</label>
    <p class="building-peers__hint">Le territoire affiché n’est ni ajouté ni retiré automatiquement. Les communes communes à plusieurs territoires ne sont comptées qu’une fois.</p>
    <p v-if="catalogStatus === 'loading'" role="status">Chargement des territoires…</p>
    <p v-else-if="catalogStatus === 'error'" role="alert">La liste des territoires est indisponible. Réessayez en rechargeant la page.</p>
    <template v-else>
      <input id="building-peer-search" v-model="search" type="search" autocomplete="off" placeholder="Rechercher un territoire" />
      <ul v-if="matches.length" class="building-peers__results" aria-label="Résultats de recherche">
        <li v-for="item in matches" :key="`${item.type}:${item.id}`">
          <button type="button" @click="add(item)">Ajouter {{ item.name }} ({{ item.type }})</button>
        </li>
      </ul>
      <p v-else-if="search.trim().length >= 2" role="status">Aucun autre territoire trouvé.</p>
      <ul v-if="chosen.length" class="building-peers__chosen" aria-label="Territoires choisis">
        <li v-for="item in chosen" :key="`${item.type}:${item.id}`">
          {{ item.name }} ({{ item.type }})
          <button type="button" :aria-label="`Retirer ${item.name} du groupe`" @click="remove(item)">Retirer</button>
        </li>
      </ul>
      <div class="building-peers__actions">
        <button type="button" :disabled="!chosen.length" @click="emit('select', [...chosen])">Comparer ces territoires</button>
        <button v-if="selected" type="button" @click="emit('clear')">Revenir à la comparaison initiale</button>
      </div>
    </template>
    <p v-if="comparisonStatus === 'loading'" role="status">Calcul du groupe comparé…</p>
    <p v-else-if="comparisonStatus === 'error'" role="alert">La comparaison n’a pas pu être chargée. Réessayez avec le bouton « Comparer ces territoires ».</p>
    <p v-else-if="comparisonStatus === 'ready'" role="status">Comparaison actualisée. Si moins de deux communes disposent de données, aucune courbe de comparaison n’est affichée.</p>
  </div>
</template>

<style scoped>
.building-peers { max-width: 44rem; padding: var(--space-4); background: var(--surface-tertiary); border: 1px solid var(--border-default); border-radius: var(--radius-md); }
.building-peers label { display: block; font-weight: 700; }
.building-peers__hint { font-size: var(--text-body-sm); }
.building-peers input { width: 100%; min-height: 44px; padding: var(--space-2); border: 1px solid var(--border-default); border-radius: var(--radius-sm); background: var(--surface-primary); color: var(--text-primary); }
.building-peers ul { list-style: none; margin: var(--space-2) 0; padding: 0; max-height: 14rem; overflow: auto; }
.building-peers li { display: flex; align-items: center; gap: var(--space-2); justify-content: space-between; padding: var(--space-1) 0; }
.building-peers button { min-height: 44px; padding: var(--space-2) var(--space-3); color: var(--text-primary); background: var(--surface-primary); border: 1px solid var(--border-default); border-radius: var(--radius-sm); cursor: pointer; }
.building-peers button:hover { background: var(--brand-100); }
.building-peers button:focus-visible, .building-peers input:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
.building-peers button:disabled { cursor: not-allowed; opacity: .55; }
.building-peers__actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
</style>
