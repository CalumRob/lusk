<script setup lang="ts">
import { MARQUE_LUSK_ERMINE } from './luskBrandMark'
/**
 * LuskBrand — the locked brand lockup (mock/brand/final.html, état
 * verrouillé): the ermine in course + "lusk" in italic Newsreader, ink only.
 * The locked paths and their fills live in `luskBrandMark.ts` - single
 * owner shared by this lockup and the document painter. The wordmark text
 * follows the host link's color (--text-primary).
 *
 * `verticale` (mock/brand/iterations/v8.html - the hero lock-up): the ermine
 * stacks ABOVE the word, the mark reads as a column (hero right column), not
 * the horizontal header lock-up.
 */
defineProps<{
  verticale?: boolean
}>()
</script>

<template>
  <span
    class="lusk-marque"
    :class="{ 'lusk-marque--verticale': verticale }"
  >
    <svg class="lusk-marque__ermine" :viewBox="MARQUE_LUSK_ERMINE.viewBox" aria-hidden="true" focusable="false">
      <path v-for="chemin in MARQUE_LUSK_ERMINE.chemins" :key="chemin.d" :d="chemin.d" :fill="chemin.fill" />
    </svg>
    <span class="lusk-marque__mot">lusk</span>
  </span>
</template>

<style scoped>
.lusk-marque {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font: 600 1.375rem/1 var(--font-wordmark);
  font-style: italic;
  letter-spacing: -0.01em;
  color: var(--text-primary);
  transition: color 150ms ease-out;
}

.lusk-marque--verticale {
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
}

.lusk-marque__ermine {
  /* em relatif au mot : l'hermine suit la taille du wordmark, jamais une
     taille fixe — la marque garde ses proportions à toute taille de texte. */
  width: 1.18em;
  height: 1.18em;
  flex-shrink: 0;
}

.lusk-marque--verticale .lusk-marque__ermine {
  width: 1.55em;
  height: 1.55em;
}
</style>
