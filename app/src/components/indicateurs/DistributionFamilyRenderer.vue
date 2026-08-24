<script setup lang="ts">
import { computed } from 'vue'
import type { FamilyDispatch } from '@/indicateurs/familySeam'
import type { ModeleSignature } from '@/indicateurs/explorationModel'
import { formaterNombreFR } from '@/payload/selectors'

const props = defineProps<{ dispatch: Extract<FamilyDispatch, { family: 'distribution' }>; signature?: ModeleSignature | null }>()

// La hauteur des barres se dérive du MAXIMUM RÉEL de la signature du
// territoire (#440) — jamais un bornage brut sur une plage de pixels fixe.
const hauteurMax = computed(() => Math.max(...(props.signature?.barres ?? []).map((barre) => barre.valeur ?? 0), 0))
function hauteurDe(valeur: number | null): string {
  if (valeur === null || hauteurMax.value <= 0) return '2px'
  return `${Math.max(2, (valeur / hauteurMax.value) * 100)}%`
}
</script>
<template>
  <figure class="family-renderer distribution-renderer" data-renderer="distribution" :data-state="dispatch.status" aria-label="Repères de distribution">
    <div class="signature-bloc" data-testid="signature-distribution">
      <h2>La signature du territoire sélectionné</h2>
      <div v-if="signature && signature.etat === 'complet'" class="signature-barres" role="img" :aria-label="`Distribution complète de ${signature.nom} sur ${signature.barres.length} modalités déclarées`">
        <div v-for="barre in signature.barres" :key="barre.detail" class="signature-barre" :data-detail="barre.detail">
          <span class="signature-valeur">{{ formaterNombreFR(barre.valeur!, 2) }}{{ signature.unite ? ` ${signature.unite}` : '' }}</span>
          <span class="signature-hauteur"><span class="barre" :style="{ height: hauteurDe(barre.valeur) }" /></span>
          <span class="signature-libelle">{{ barre.label }}</span>
        </div>
      </div>
      <p v-else-if="signature && signature.message" role="status">{{ signature.message }}</p>
      <p v-else role="status">Sélectionnez un territoire pour voir sa signature complète.</p>
    </div>
    <figcaption>La comparaison entre territoires ci-dessous est pilotée par « {{ dispatch.facet.label }} » ({{ dispatch.facet.unit }}) — elle pilote la médiane, la carte, les extrêmes et le tableau ; la signature n’est jamais comparée étiquette par étiquette.</figcaption>
    <slot :dispatch="dispatch" />
  </figure>
</template>
<style scoped>
.distribution-renderer{padding:24px;background:var(--surface-primary);border:1px solid var(--border-default);border-radius:12px}
.signature-bloc h2{font:var(--text-h3);margin:0 0 12px}
.signature-barres{display:flex;align-items:end;gap:12px;border-bottom:2px solid var(--indicateur-line);padding-bottom:0}
.signature-barre{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center}
.signature-valeur{font-size:.8rem;color:var(--text-secondary)}
.signature-hauteur{display:flex;align-items:end;height:120px;width:100%}
.barre{width:100%;background:var(--indicateur-accent);border-radius:4px 4px 0 0}
.signature-libelle{font-size:.85rem;color:var(--text-secondary);margin-bottom:6px}
.distribution-renderer figcaption{margin-top:12px;color:var(--text-secondary)}
@media(max-width:700px){.signature-barres{gap:6px}}
</style>
