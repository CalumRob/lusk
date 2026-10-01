<script setup lang="ts">
import { computed } from 'vue'
import type { FamilyDispatch } from '@/indicateurs/familySeam'
import type { ModeleProfil } from '@/indicateurs/explorationModel'
import { formaterValeur } from '@/payload/selectors'

const props = defineProps<{ dispatch: Extract<FamilyDispatch, { family: 'list' }>; profil?: ModeleProfil | null }>()

// Le profil reste visible dès qu'une catégorie porte une valeur — complet ou
// incomplet (#439, PRD « keeps the complete profile visible ») : les lignes
// DISPONIBLES se rendent toujours, et l'incomplétude est dite à côté, en
// nommant les catégories sans valeur — jamais le message seul à la place des
// données réelles.
const afficheLignes = computed(() => props.profil?.etat === 'complet' || props.profil?.etat === 'incomplet')
const lignesVisibles = computed(() => (props.profil?.lignes ?? []).filter((ligne) => ligne.valeur !== null))
const categoriesManquantes = computed(() => props.profil?.etat === 'incomplet' ? props.profil.lignes.filter((ligne) => ligne.valeur === null).map((ligne) => ligne.label) : [])
</script>
<template>
  <figure class="family-renderer list-renderer editorial-figure" data-renderer="list" :data-state="dispatch.status" aria-label="Repères en liste">
    <div class="profil-bloc" data-testid="profil-liste">
      <h2 class="editorial-section-heading">Le profil complet du territoire sélectionné</h2>
      <div v-if="afficheLignes && lignesVisibles.length" class="profil-lignes" role="img" :aria-label="`Profil de ${profil!.nom} sur ${profil!.lignes.length} catégories déclarées`">
        <div v-for="ligne in lignesVisibles" :key="ligne.detail" class="profil-ligne" :class="{ active: ligne.detail === dispatch.facet.detail }" :data-ligne-profil="ligne.detail">
          <span class="profil-libelle">{{ ligne.label }}</span>
          <span class="profil-valeur">{{ formaterValeur({ value: ligne.valeur!, unit: ligne.unite }) }} <small>{{ ligne.unite }}</small></span>
        </div>
      </div>
      <p v-if="categoriesManquantes.length" class="profil-note" role="note">Profil incomplet — sans valeur publiée à ce niveau : {{ categoriesManquantes.join(', ') }}.</p>
      <p v-else-if="profil && profil.etat === 'absent'" role="status">{{ profil.message }}</p>
      <p v-else-if="!profil || profil.etat === null" role="status">Sélectionnez un territoire pour voir son profil complet.</p>
    </div>
     <figcaption class="editorial-provenance">La comparaison entre territoires ci-dessous est pilotée par la catégorie « {{ dispatch.facet.label }} » ({{ dispatch.facet.unit }}) — elle pilote la médiane, la carte, les extrêmes et le tableau ; le profil complet du territoire reste visible ci-dessus, jamais réduit à un score.</figcaption>
    <slot :dispatch="dispatch" />
  </figure>
</template>
<style scoped>
.list-renderer{margin:0}
.profil-lignes{display:flex;flex-direction:column}
.profil-ligne{display:flex;justify-content:space-between;gap:16px;padding:8px 4px;border-bottom:1px solid var(--border-subtle)}
.profil-ligne.active{background:var(--indicateur-soft);font-weight:600}
.profil-libelle{color:var(--editorial-muted)}
.profil-valeur{font:var(--text-numeric);white-space:nowrap}
.profil-valeur small{font-weight:400;color:var(--text-secondary)}
.profil-note{margin:12px 0 0;padding:8px 12px;border-top:2px solid var(--indicateur-accent);background:var(--indicateur-soft);color:var(--text-secondary)}
.list-renderer figcaption{margin-top:12px;color:var(--text-secondary)}
</style>
