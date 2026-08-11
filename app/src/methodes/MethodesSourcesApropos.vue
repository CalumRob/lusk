<script setup lang="ts">
/**
 * L'onglet Sources · À propos de /methodologie (issue #332) : la prose du
 * registre des sources — ce qu'il est (une entrée par source, l'éditeur, le
 * jeu de données, les thèmes alimentés), le contrat de parité des sources
 * documentées (toute source des fiches est documentée, jamais une date
 * inventée), les faits de fraîcheur en direct, et le rôle des onglets de
 * thème. Pas la prose de la page (l'intro reste au-dessus du shell) — la
 * prose de l'onglet.
 */
</script>

<template>
  <section id="sources-a-propos" class="sources-a-propos">
    <h2 class="sources-a-propos__titre">Le registre des sources</h2>

    <div class="sources-a-propos__corps">
      <p>
        Chaque source que les fiches consomment a sa ligne dans le registre : son éditeur, son
        jeu de données, les thèmes qu’elle alimente — et sa fraîcheur, jointe en direct : sa
        version, sa licence, ses dates de référence et de publication.
      </p>
      <p>
        Toute source des fiches a son entrée de registre — une source n’est affichée qu’avec
        sa documentation : un thème n’est pas « construit » tant que ses sources ne sont pas
        documentées ici. Quand la fraîcheur d’une source n’est pas encore connue, sa ligne
        reste rendue, avec des tirets à la place des dates : jamais des dates inventées.
      </p>
      <p>
        Les onglets de thème filtrent la table : une source multi-thèmes (la série historique
        du recensement alimente la Démographie et les Milieux) apparaît sous chacun de ses
        thèmes. L’onglet « Programmes et subventions » documente les sources de l’élément du
        même nom de la fiche.
      </p>
    </div>
  </section>
</template>

<style scoped>
.sources-a-propos {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.sources-a-propos__titre {
  margin: 0;
  font: 600 1.5rem/1.3 var(--font-serif);
  letter-spacing: -0.01em;
  color: var(--text-primary);
}

.sources-a-propos__corps {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.sources-a-propos__corps p {
  margin: 0;
  color: var(--text-secondary);
  font: var(--text-body);
}
</style>
