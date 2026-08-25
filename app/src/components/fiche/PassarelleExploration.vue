<script setup lang="ts">
/**
 * PassarelleExploration (#409, #468) — l'affordance COMPACTE et unique du
 * handoff fiche → Page d'indicateur : le libellé court « Explorer » + la
 * flèche de navigation (l'iconographie lucide établie de l'app, déjà portée
 * par l'accueil), rendue à l'identique sur chaque site de handoff — la figure
 * compacte et la grille d'OngletTheme, le total annuel de BlocProgrammes.
 *
 * Nouvelle fenêtre (#468) : le handoff change l'axe du visiteur. L'ancre est
 * une VRAIE ancre routée — vue-router résout exactement la RouteLocationRaw
 * d'avant (territoire / niveau / thème intacts) dans un href natif, le
 * milieu-clic et le long-press restent ceux du navigateur (guardEvent laisse
 * _blank au navigateur, jamais un gestionnaire JS) — avec target="_blank" +
 * rel="noopener noreferrer" (le precedent du repo : le lien portail de
 * BlocProgrammes).
 *
 * La couleur vient de la rampe du thème du site hôte via les variables
 * --passarelle-couleur / --passarelle-survol — jamais codée ici.
 */
import { ArrowRight } from 'lucide-vue-next'
import { RouterLink } from 'vue-router'

import AppIcon from '@/components/AppIcon.vue'
import { LIBELLE_HANDOFF } from '@/fiche/explorationHandoff'
import type { RouteLocationRaw } from 'vue-router'

defineProps<{
  /** La route résolue par handoffExploration — l'état d'URL du contrat #409. */
  to: RouteLocationRaw
}>()
</script>

<template>
  <RouterLink
    class="passarelle-exploration"
    :to="to"
    target="_blank"
    rel="noopener noreferrer"
  >
    {{ LIBELLE_HANDOFF }}
    <AppIcon :icone="ArrowRight" :taille="12" aria-hidden="true" />
  </RouterLink>
</template>

<style scoped>
/* L'affordance unique (#468) — discrète, sous la figure qu'elle prolonge ;
   la même typographie caption sur chaque site, la couleur portée par la
   rampe du thème hôte. */
.passarelle-exploration {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  width: fit-content;
  margin-top: var(--space-1);
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  font-weight: 600;
  color: var(--passarelle-couleur, currentColor);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.passarelle-exploration:hover {
  color: var(--passarelle-survol, var(--passarelle-couleur, currentColor));
}
</style>
