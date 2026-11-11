<script setup lang="ts">
/**
 * PuceRang — la puce de rang partagée (issue #371, parent #367) : le rang formaté
 * seul est visible. La phrase complète (« 3e/41 de l'EPCI — plus = mieux »)
 * reste dans l'aria-label ET le title, où l'explication directionnelle est conservée.
 * Le rang visible n'est JAMAIS exposé sans texte accessible :
 * la puce prend `role="img"` + `aria-label` (le nom accessible fiable, un span
 * générique nu avec aria-label ne l'étant pas) — la phrase ne se résume jamais
 * au seul rang affiché.
 *
 * Consommée par IndicatorFigure et FigureOffreCyclable (et tout autre
 * consommateur de puce) : le markup + le CSS ne sont dupliqués nulle part.
 */
import type { PuceRangDirection } from '@/fiche/figureGrammaire'

defineProps<{
  /** La puce de rang visible (rang seul) et sa phrase accessible directionnelle. */
  puce: PuceRangDirection
  /** La puce est déjà incluse dans le nom accessible de son repère parent. */
  decorative?: boolean
}>()
</script>

<template>
  <span class="puce-rang" :role="decorative ? undefined : 'img'" :aria-label="decorative ? undefined : puce.phraseAria" :aria-hidden="decorative ? 'true' : undefined" :title="decorative ? undefined : puce.phrase">
    <span class="puce-rang-texte">{{ puce.rang }}</span>
  </span>
</template>

<style scoped>
.puce-rang {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  margin: var(--space-1) 0 0;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-full);
  background: var(--couleur-soft, var(--surface-tertiary));
  color: var(--couleur-strong, var(--brand-700));
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
}

/* Le texte visible contient uniquement l'ordinal; l'explication directionnelle reste accessible. */
.puce-rang-texte {
  white-space: normal;
}
</style>
