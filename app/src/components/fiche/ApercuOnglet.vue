<template>
  <!-- C2 construit le vrai contenu ici (stats de base + Programmes & financements). -->
  <article class="apercu-onglet">
    <p class="apercu-onglet-overline">Aperçu</p>
    <p class="apercu-onglet-vide">À venir.</p>
  </article>
</template>

<style scoped>
.apercu-onglet {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.apercu-onglet-overline {
  margin: 0;
  font: var(--text-overline);
  letter-spacing: var(--text-overline-tracking);
  text-transform: uppercase;
  color: var(--brand-500);
}

.apercu-onglet-vide {
  margin: 0;
  color: var(--text-secondary);
}
</style>
