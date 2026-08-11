<template>
  <section class="page a-propos">
    <h1 class="a-propos__titre">À propos</h1>
    <p class="a-propos__intro">
      Lusk est un observatoire ouvert des territoires bretons : chaque commune, EPCI et
      département a sa fiche d'identité, construite à partir de données publiques.
    </p>
    <p class="a-propos__attribution">
      Conçu par
      <a
        href="https://calumrobertson.fr"
        target="_blank"
        rel="noopener noreferrer"
      >Calum Robertson</a>
      — Docteur en économie urbaine.
    </p>
  </section>
</template>

<script setup lang="ts">
/**
 * À propos (/a-propos — site-map.md). Shell only (D4): the route must exist
 * and render a minimal, honest shell — what Lusk is, and the person behind
 * it (one line; the footer attribution is the template, principles.md §1).
 * The ThemeTabs per-theme explainers are LATER (site-map.md §Theme
 * subheader): the route stays ready, no placeholder tab logic.
 */
</script>

<style scoped>
.a-propos__titre {
  margin: 0 0 var(--space-4);
  font: var(--text-h1);
  letter-spacing: var(--text-h1-tracking);
}

.a-propos__intro {
  margin: 0 0 var(--space-8);
  color: var(--text-secondary);
  font: var(--text-body-lg);
}

.a-propos__attribution {
  margin: 0;
  color: var(--text-secondary);
  font: 400 0.875rem/1.5 var(--font-serif);
}
</style>
