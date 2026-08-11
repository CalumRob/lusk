<script setup lang="ts">
/**
 * L'onglet Méthodes · À propos de /methodologie (issue #332) : la prose du
 * registre des indicateurs — ce qu'il documente par thème construit (chaque
 * indicateur : ce qu'il mesure, son unité, sa source ; chaque Story : ce
 * qu'elle lit, ses lectures), le contrat des clés (les clés du registre sont
 * celles des fiches), et la règle de publication (une Story en pause est
 * documentée, jamais publiée). Pas la prose de la page (l'intro reste au-
 * dessus du shell) — la prose de l'onglet.
 */
</script>

<template>
  <section id="methodes-a-propos" class="methodes-a-propos">
    <h2 class="methodes-a-propos__titre">Le registre des indicateurs</h2>

    <div class="methodes-a-propos__corps">
      <p>
        Pour chaque thème construit, le registre documente la définition éditoriale de chacun
        de ses indicateurs — ce qu’il mesure, son unité, sa source — puis ce que racontent ses
        Stories et comment elles se lisent.
      </p>
      <p>
        Les clés des indicateurs sont les clés utilisées dans les fiches : un indicateur porte
        le même nom ici et sur sa fiche. Une Story « en pause » est documentée comme note
        Méthodes, jamais publiée. Un thème n’est pas « construit » tant que ses indicateurs et
        ses Stories ne sont pas documentés ici — il n’est publié qu’avec sa documentation.
      </p>
      <p>
        Les onglets de thème naviguent les blocs ; l’onglet « Programmes et subventions »
        documente l’élément du même nom de la fiche.
      </p>
    </div>
  </section>
</template>

<style scoped>
.methodes-a-propos {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.methodes-a-propos__titre {
  margin: 0;
  font: 600 1.5rem/1.3 var(--font-serif);
  letter-spacing: -0.01em;
  color: var(--text-primary);
}

.methodes-a-propos__corps {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.methodes-a-propos__corps p {
  margin: 0;
  color: var(--text-secondary);
  font: var(--text-body);
}
</style>
