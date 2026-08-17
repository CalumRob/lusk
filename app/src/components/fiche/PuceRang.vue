<script setup lang="ts">
/**
 * PuceRang — la puce de rang partagée (issue #371, parent #367) : le glyphe de
 * direction (▲ / ▼, purement visuel, aria-hidden) + le rang formaté, le tout
 * portant la phrase complète (« 3e/41 de l'EPCI — plus = mieux ») dans
 * l'aria-label ET le title. Le glyph n'est JAMAIS exposé sans texte accessible :
 * la puce prend `role="img"` + `aria-label` (le nom accessible fiable, un span
 * générique nu avec aria-label ne l'étant pas) — la phrase ne se résume jamais
 * au seul glyphe.
 *
 * Consommée par IndicatorFigure et FigureOffreCyclable (et tout autre
 * consommateur de puce) : le markup + le CSS ne sont dupliqués nulle part.
 */
import type { PuceRangDirection } from '@/fiche/figureGrammaire'

defineProps<{
  /** La puce de rang directionnelle (glyphe + rang + phrase accessible). */
  puce: PuceRangDirection
}>()
</script>

<template>
  <span class="puce-rang" role="img" :aria-label="puce.phrase" :title="puce.phrase">
    <span class="puce-rang-glyphe" aria-hidden="true">{{ puce.glyphe + ' ' }}</span>
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

/* Le glyphe de direction — purement visuel, l'aria-label porte la phrase. */
.puce-rang-glyphe {
  margin-right: 0.3em;
  font-weight: 700;
}

.puce-rang-texte {
  white-space: nowrap;
}
</style>
