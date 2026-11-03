<script setup lang="ts">
/**
 * CahierComparisonNote — la note de nommage EN LECTURE SEULE sous une figure
 * du Cahier (#768/#860, post-#870) : « Groupe comparé : <statistique en un
 * mot + portée résolue> ». Le rôle de SÉLECTEUR par figure est retiré : la
 * Sélection de comparaison appartient au contrôle d'en-tête de la fiche
 * (PuceSelectionComparaison) ; la figure garde sa marque de pair et sa note
 * comme libellés en lecture seule de la portée active.
 */
defineProps<{
  /** Libellé complet de la note (statistique + portée résolue), publié par l'API. */
  label: string | null
}>()
</script>

<template>
  <p
    v-if="label"
    class="cahier-comparison-note"
    role="note"
  >
    <strong class="cahier-comparison-note__label">Groupe comparé</strong> : {{ label }}
  </p>
</template>

<style scoped>
.cahier-comparison-note {
  max-width: 42rem;
  margin: var(--space-2) auto 0;
  color: var(--cahier-default);
  font: var(--type-figure-comparison);
  line-height: 1.3;
  letter-spacing: normal;
  text-align: center;
  overflow-wrap: anywhere;
}

.cahier-comparison-note__label {
  color: var(--color-figure-reference);
}
</style>
