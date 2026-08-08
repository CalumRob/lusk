<script setup lang="ts">
/**
 * LuskBrand — the locked brand lockup (mock/brand/final.html, état
 * verrouillé): the ermine in course + "lusk" in italic Newsreader, ink only.
 * The ermine is a locked brand asset: body ink #1B1B19, tail/eye/ear green
 * #57726F (= --brand-500), and the tail carries the ermine's signature black
 * tip (ink #1B1B19) — its colors are hardcoded, never tokenized. The
 * wordmark text follows the host link's color (--text-primary).
 *
 * The tail is the refined S4 silhouette (E2 round 6): the two tiling paths
 * are the de Casteljau split of the S4 outline at x≈27.5 — root green +
 * tip ink, sharing the exact same curve segments. No overlay.
 *
 * `verticale` (mock/brand/iterations/v8.html — the hero lock-up): the ermine
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
    <svg class="lusk-marque__ermine" viewBox="15 95.7 86.4 47" aria-hidden="true" focusable="false">
      <!-- queue : racine verte + pointe encre (tuilées — subdivision de Casteljau de la silhouette S4 à x≈27.5) -->
      <path d="M47.3 109.7 C 40.82 109.53, 33.51 110.13, 27.49 111.59 L27.38 116.18 C 29.35 115.72, 31.42 115.15, 33.5 114.6 C 40.5 112.9, 45 111.3, 47.3 110.6 Z" fill="#57726F" />
      <path d="M27.49 111.59 C 26.27 111.89, 25.1 112.23, 24 112.6 C 20.8 113.8, 19 115.2, 18 116.8 C 20.29 117.52, 23.65 117.04, 27.38 116.18 L27.49 111.59 Z" fill="#1B1B19" />
      <!-- corps -->
      <path d="m96.3 111.1c-1-1.5-1.6-2.5-2.2-3.8-0.7-1.5-2-2.7-2.7-3.2v-0.1c-0.1-1.5-1.4-2.5-2.6-2.2-0.3 0.1-0.7 0.3-1 0.5-1.2-0.6-2.5-1-3.7-0.1-3.3-0.9-6.4-1.9-10.2-2.3-2.3-0.2-5.2-0.4-7.5-0.2-5.2 0.3-9.2 1.5-12.8 3.5-2.7 1.5-5 3.5-6.4 5.4-2 2.7-2.6 4.9-2.9 7.7l-0.2 1.9c-0.5 4-1.8 5.1-2.3 5.6-1.2 1.2-1.3 1.4-1.4 4.9 0 1.6-0.5 5.5 1.8 5.6 2 0 2.9-5.1 4-6.2 0.5-0.5 1.9-0.2 4-0.9 4.3-1.4 6.7-4.9 6.4-9.5-0.1-1.1-0.4-2.6-0.7-3.8 0.9 0.3 2.6 1.3 3.2 3.5 1.6-1.1 4.2-2.5 7.6-3.3 0.2-2.3 1.7-3.6 3.9-3.8-1.1 1.7-2.4 4.7-0.6 6.3 0.9 0.7 4.9 2.6 6.4 3.3 1.1 0.5 2.9 1.4 4 1.1s1.3-1.5 0.5-2.9c-0.5-1-1.7-2.5-2.9-3.7 1.5-1.1 3-1.3 4.9-0.8s3 1.1 5.5 1.5c1.3 0.2 4.2 0.3 5.8-0.2 1.2-0.5 2.9-1.6 2.1-3.8z" fill="#1B1B19" />
      <!-- oreille -->
      <path d="m84.2 106.8s0.7-1.1 1.7-2c0.5-0.5 1-0.4 2.1-0.3-1.6-1.8-4-1.7-3.8 2.3z" fill="#57726F" />
      <!-- œil -->
      <path d="m91.5 109.6c-0.1 0.5-0.6 0.9-1.1 0.8s-0.9-0.6-0.8-1.1 0.6-0.8 1.1-0.7 0.8 0.6 0.8 1z" fill="#57726F" />
    </svg>
    <span class="lusk-marque__mot">lusk</span>
  </span>
</template>

<style scoped>
.lusk-marque {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font: 600 1.375rem/1 var(--font-serif);
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
