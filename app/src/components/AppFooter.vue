<template>
  <!-- #1027: shared navigation only; factual provenance stays on data surfaces. -->
  <footer class="pied">
    <div class="pied-interieur">
      <nav class="pied-liens" aria-label="Liens du pied de page">
        <RouterLink to="/sources">Sources</RouterLink>
        <RouterLink to="/a-propos">À propos</RouterLink>
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
