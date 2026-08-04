<script setup lang="ts">
/**
 * Les communes (/communes) — the communes link directory (site-map.md §Data
 * lists, layouts.md §4, ui-elements.md §Table): nom | code | EPCI | actions,
 * searchable, with the département chips and the EPCI filter. The shared
 * ListeTerritoires renders it from this config — the page is a filterable
 * link directory to the fiches, no KPI columns (decision 2026-08-03).
 */
import ListeTerritoires from '@/components/ListeTerritoires.vue'
import type { ConfigListe } from '@/listes/listes'

const config: ConfigListe = {
  type: 'commune',
  titre: 'Les communes',
  placeholderRecherche: 'Rechercher une commune',
  colonnes: [
    { cle: 'nom', libelle: 'Nom', triable: true },
    { cle: 'code', libelle: 'Code', triable: true },
    { cle: 'epci', libelle: 'EPCI', triable: true },
  ],
  libelleVide: 'Aucune commune.',
  filtreDepartement: true,
  filtreEpci: true,
}
</script>

<template>
  <ListeTerritoires :config="config" />
</template>
