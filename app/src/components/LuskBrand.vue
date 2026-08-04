<script setup lang="ts">
/**
 * LuskBrand — the locked brand lockup (mock/brand/final.html, état
 * verrouillé): the ermine in course + "lusk" in italic Newsreader, ink only.
 * The ermine is a locked brand asset: body ink #1B1B19, tail/eye/ear green
 * #57726F (= --brand-500) — its colors are hardcoded, never tokenized. The
 * wordmark text follows the host link's color (--text-primary).
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
      <!-- queue (derrière le corps) -->
      <path d="m47.3 109.7c-11.5 3.4-21.7 10.8-26.8 20.4-0.7 1.4-1.4 3.1-0.6 5.6 0.6 1.5 1.8 2.7 4.1 2.8 4.6 0.2 8.8-3.9 12.2-10.2l0.3-0.5c2-3.7 4.4-7.7 7.9-9.6l0.4-0.3" fill="#57726F" />
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
}

.lusk-marque--verticale {
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
}

.lusk-marque__ermine {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
}

.lusk-marque--verticale .lusk-marque__ermine {
  width: 34px;
  height: 34px;
}
</style>
