<script setup lang="ts">
import { computed } from 'vue'

import { MARQUE_LUSK_ERMINE, MARQUE_LUSK_LOCKUP, REMPLISSAGES_MARQUE_LUSK } from './luskBrandMark'
/**
 * LuskBrand — the locked brand lockup (mock/brand/final.html, état
 * verrouillé): the ermine in course + "lusk" in italic Newsreader, ink only.
 * The locked paths and their roles live in `luskBrandMark.ts` - the single
 * runtime owner shared by this lockup, the fiche watermark and the document
 * painter. The wordmark text follows the host link's color (--text-primary).
 *
 * `verticale` (mock/brand/iterations/v8.html - the hero lock-up): the ermine
 * stacks ABOVE the word, the mark reads as a column (hero right column), not
 * the horizontal header lock-up.
 *
 * The ermine box is em-relative to the word and comes from the shared lockup
 * owner: the PDF painter consumes the same `ermineEm`/`ermineVerticaleEm` and
 * the same baseline geometry (`sommetErmineEm`), so the lockup cannot drift
 * between the screen and the document (#1024).
 */
const props = defineProps<{
  verticale?: boolean
}>()

const styleErmine = computed(() => {
  const em = props.verticale
    ? MARQUE_LUSK_LOCKUP.ermineVerticaleEm
    : MARQUE_LUSK_LOCKUP.ermineEm
  // A custom property, not width/height: host variants (the landing hero uses
  // 1.3em + a negative margin) keep their own CSS override.
  return { '--lusk-ermine-em': `${em}em` }
})
</script>

<template>
  <span
    class="lusk-marque"
    :class="{ 'lusk-marque--verticale': verticale }"
  >
    <svg
      class="lusk-marque__ermine"
      :style="styleErmine"
      :viewBox="MARQUE_LUSK_ERMINE.viewBox"
      aria-hidden="true"
      focusable="false"
    >
      <path v-for="chemin in MARQUE_LUSK_ERMINE.chemins" :key="chemin.d" :d="chemin.d" :fill="REMPLISSAGES_MARQUE_LUSK[chemin.role]" />
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
  /* The em-relative box is the shared lockup owner's (`MARQUE_LUSK_LOCKUP`),
     injected as `--lusk-ermine-em`: l'hermine suit la taille du wordmark,
     jamais une taille fixe — la marque garde ses proportions à toute taille
     de texte. A host may still override width/height directly (hero 1.3em). */
  width: var(--lusk-ermine-em);
  height: var(--lusk-ermine-em);
  flex-shrink: 0;
}
</style>
