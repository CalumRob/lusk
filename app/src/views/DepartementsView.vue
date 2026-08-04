<script setup lang="ts">
/**
 * Les départements (/departements) — the départements link directory
 * (site-map.md §Data lists, layouts.md §4): 22 · 29 · 35 · 56, nom | code |
 * actions, searchable. No filters — four rows, every one shown. The shared
 * ListeTerritoires renders it from this config — no KPI columns, no
 * computation (decision 2026-08-03).
 */
import ListeTerritoires from '@/components/ListeTerritoires.vue'
import type { ConfigListe } from '@/listes/listes'

const config: ConfigListe = {
  type: 'departement',
  titre: 'Les départements',
  placeholderRecherche: 'Rechercher un département',
  colonnes: [
    { cle: 'nom', libelle: 'Nom', triable: true },
    { cle: 'code', libelle: 'Code', triable: true },
  ],
  libelleVide: 'Aucun département.',
  filtreDepartement: false,
  filtreEpci: false,
}
</script>

<template>
  <ListeTerritoires :config="config" />
</template>
