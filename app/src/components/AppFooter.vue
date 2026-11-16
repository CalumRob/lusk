<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

// #1027 spacing experiment: only the homepage tightens the footer separation,
// because its compact editorial row otherwise pools all viewport slack below.
const route = useRoute()
const surAccueil = computed(() => route.name === 'accueil')
</script>

<template>
  <!-- #1027: shared navigation only; factual provenance stays on data surfaces. -->
  <footer class="pied" :class="{ 'pied--accueil': surAccueil }">
    <div class="pied-interieur">
      <nav class="pied-liens" aria-label="Liens du pied de page">
        <a
          href="https://calumrobertson.fr"
          target="_blank"
          rel="noopener noreferrer"
        >calumrobertson.fr</a>
      </nav>
    </div>
  </footer>
</template>

<style scoped>
.pied {
  border-top: 1px solid var(--border-subtle);
  background: var(--surface-primary);
  margin-top: var(--space-16);
}

/* Homepage only: give the free space back to the gap above the mini-pages,
   so the row is not glued to the access area nor stranded above the footer.
   Other surfaces keep the shared 64px separation. */
.pied--accueil {
  margin-top: calc(var(--space-8) + var(--space-1));
}

.pied-interieur {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-width: var(--content-max-width);
  margin-inline: auto;
  padding: var(--space-8) var(--grid-margin-mobile);
}

.pied-liens {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-6);
  font: var(--text-body-sm);
}

.pied-liens a {
  color: var(--text-secondary);
}

.pied-liens a:hover {
  color: var(--accent-hover);
}
</style>
