<script setup lang="ts">
import type { FamilyDispatch } from '@/indicateurs/familySeam'
import type { ModeleProfil } from '@/indicateurs/explorationModel'
import { formaterNombreFR } from '@/payload/selectors'

const props = defineProps<{ dispatch: Extract<FamilyDispatch, { family: 'list' }>; profil?: ModeleProfil | null }>()
</script>
<template>
  <figure class="family-renderer list-renderer" data-renderer="list" :data-state="dispatch.status" aria-label="Repères en liste">
    <div class="profil-bloc" data-testid="profil-liste">
      <h2>Le profil complet du territoire sélectionné</h2>
      <div v-if="profil && profil.etat === 'complet'" class="profil-lignes">
        <div v-for="ligne in profil.lignes" :key="ligne.detail" class="profil-ligne" :class="{ active: ligne.detail === dispatch.facet.detail }" :data-ligne-profil="ligne.detail">
          <span class="profil-libelle">{{ ligne.label }}</span>
          <span class="profil-valeur">{{ formaterNombreFR(ligne.valeur!, 2) }} <small>{{ ligne.unite }}</small></span>
        </div>
      </div>
      <p v-else-if="profil && profil.message" role="status">{{ profil.message }}</p>
      <p v-else-if="profil && profil.etat === null" role="status">Sélectionnez un territoire pour voir son profil complet.</p>
    </div>
    <figcaption>La comparaison entre territoires ci-dessous est pilotée par la catégorie « {{ dispatch.facet.label }} » ({{ dispatch.facet.unit }}) — elle pilote la médiane, la carte, les extrêmes et le tableau ; le profil complet du territoire reste visible ci-dessus, jamais réduit à un score.</figcaption>
    <slot :dispatch="dispatch" />
  </figure>
</template>
<style scoped>
.list-renderer{padding:24px;background:var(--surface-primary);border:1px solid var(--border-default);border-radius:12px}
.profil-bloc h2{font:var(--text-h3);margin:0 0 12px}
.profil-lignes{display:flex;flex-direction:column}
.profil-ligne{display:flex;justify-content:space-between;gap:16px;padding:8px 4px;border-bottom:1px solid var(--border-subtle)}
.profil-ligne.active{background:var(--indicateur-soft);border-left:3px solid var(--indicateur-accent)}
.profil-libelle{color:var(--text-secondary)}
.profil-valeur{font-weight:600;white-space:nowrap}
.profil-valeur small{font-weight:400;color:var(--text-secondary)}
.list-renderer figcaption{margin-top:12px;color:var(--text-secondary)}
</style>
