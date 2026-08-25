<script setup lang="ts">
import { computed } from 'vue'
import type { FamilyDispatch } from '@/indicateurs/familySeam'
import type { ModeleSignature, ModeleEnsembleComparaison } from '@/indicateurs/explorationModel'
import { formaterValeur } from '@/payload/selectors'
import { couleurDpe } from '@/fiche/couleursDpe'

const props = defineProps<{ dispatch: Extract<FamilyDispatch, { family: 'distribution' }>; signature?: ModeleSignature | null; ensemble?: ModeleEnsembleComparaison | null }>()

// La hauteur des barres se dérive du MAXIMUM RÉEL des deux profils (#474) —
// signature du territoire ET ensemble de comparaison partagent LA MÊME
// échelle : l'œil compare des hauteurs comparables, jamais deux règles.
const hauteurMax = computed(() => Math.max(
  ...(props.signature?.barres ?? []).map((barre) => barre.valeur ?? 0),
  ...(props.ensemble?.barres ?? []).map((barre) => barre.valeur ?? 0),
  0,
))
function hauteurDe(valeur: number | null): string {
  if (valeur === null || hauteurMax.value <= 0) return '2px'
  return `${Math.max(2, (valeur / hauteurMax.value) * 100)}%`
}
// Les détails DPE portent leurs couleurs officielles A→G (ADR-0023, la seule
// dérogation de palette sanctionnée) — le MÊME mécanisme que le renderer de
// composition : lookup sur le détail, repli silencieux sinon. Le dégradé du
// thème n'habille jamais les étiquettes DPE.
function styleBarre(detail: string, valeur: number | null): Record<string, string> {
  const style: Record<string, string> = { height: hauteurDe(valeur) }
  const officielle = couleurDpe(detail)
  if (officielle) style.background = officielle
  return style
}
</script>
<template>
  <figure class="family-renderer distribution-renderer" data-renderer="distribution" :data-state="dispatch.status" aria-label="Repères de distribution">
    <div class="signature-bloc" data-testid="signature-distribution">
      <h2>La signature du territoire sélectionné</h2>
      <div v-if="signature && signature.etat === 'complet'" class="signature-barres" role="img" :aria-label="`Distribution complète de ${signature.nom} sur ${signature.barres.length} détails déclarés`">
        <div v-for="barre in signature.barres" :key="barre.detail" class="signature-barre" :data-detail="barre.detail">
          <span class="signature-valeur">{{ formaterValeur({ value: barre.valeur!, unit: signature.unite }) }}{{ signature.unite ? ` ${signature.unite}` : '' }}</span>
          <span class="signature-hauteur"><span class="barre" :style="styleBarre(barre.detail, barre.valeur)" /></span>
          <span class="signature-libelle">{{ barre.label }}</span>
        </div>
      </div>
      <p v-else-if="signature && signature.message" role="status">{{ signature.message }}</p>
      <p v-else role="status">Sélectionnez un territoire pour voir sa signature complète.</p>
    </div>
    <!-- L'ensemble de comparaison (#474) : le profil agrégé du périmètre actif
         face auquel la signature se lit. Une vue d'ensemble étiquetée — JAMAIS
         un autre territoire : pas de nom, pas de lien-fiche, pas de rang. -->
    <div v-if="ensemble" class="ensemble-bloc" data-testid="ensemble-comparaison" :data-portee="ensemble.porteeLabel" :data-avec-donnees="ensemble.nTerritoires" :data-sans-donnees="ensemble.nSansDonnee">
      <h2>L’ensemble de comparaison</h2>
      <p class="ensemble-portee">{{ ensemble.porteeLabel }} · moyenne des parts publiées de {{ ensemble.nTerritoires }} territoires sur {{ ensemble.nTerritoires + ensemble.nSansDonnee }} à ce niveau{{ ensemble.nSansDonnee > 0 ? ` (${ensemble.nSansDonnee} sans données)` : '' }}</p>
      <div v-if="ensemble.nTerritoires > 0" class="signature-barres" role="img" :aria-label="`Profil agrégé de l’ensemble de comparaison (${ensemble.porteeLabel}) sur ${ensemble.barres.length} détails déclarés`">
        <div v-for="barre in ensemble.barres" :key="barre.detail" class="signature-barre" :data-detail="barre.detail">
          <span class="signature-valeur">{{ formaterValeur({ value: barre.valeur, unit: ensemble.unite }) }}{{ ensemble.unite ? ` ${ensemble.unite}` : '' }}</span>
          <span class="signature-hauteur"><span class="barre barre--ensemble" :style="styleBarre(barre.detail, barre.valeur)" /></span>
          <span class="signature-libelle">{{ barre.label }}</span>
        </div>
      </div>
      <p v-else role="status">Aucune donnée publiée dans cet ensemble à ce niveau.</p>
    </div>
    <figcaption>La comparaison entre territoires ci-dessous est pilotée par « {{ dispatch.facet.label }} » ({{ dispatch.facet.unit }}) — elle pilote la carte, les extrêmes et le tableau ; l’ensemble de comparaison est une vue d’ensemble du périmètre actif, jamais un autre territoire ; la signature n’est jamais comparée détail par détail.</figcaption>
    <slot :dispatch="dispatch" />
  </figure>
</template>
<style scoped>
.distribution-renderer{padding:24px;background:var(--surface-primary);border:1px solid var(--border-default);border-radius:12px}
.signature-bloc h2,.ensemble-bloc h2{font:var(--text-h3);margin:0 0 12px}
.signature-barres{display:flex;align-items:end;gap:12px;border-bottom:2px solid var(--indicateur-line);padding-bottom:0}
.signature-barre{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center}
.signature-valeur{font-size:.8rem;color:var(--text-secondary)}
.signature-hauteur{display:flex;align-items:end;height:120px;width:100%}
.barre{width:100%;background:var(--indicateur-accent);border-radius:4px 4px 0 0}
.barre--ensemble{opacity:.55}
.signature-libelle{font-size:.85rem;color:var(--text-secondary);margin-bottom:6px}
.ensemble-bloc{margin-top:20px;padding-top:16px;border-top:1px solid var(--border-subtle)}
.ensemble-portee{margin:-6px 0 12px;color:var(--text-secondary)}
.distribution-renderer figcaption{margin-top:12px;color:var(--text-secondary)}
@media(max-width:700px){.signature-barres{gap:6px}}
</style>
