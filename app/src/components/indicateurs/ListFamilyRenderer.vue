<script setup lang="ts">import type { FamilyDispatch } from '@/indicateurs/familySeam'; defineProps<{ dispatch: Extract<FamilyDispatch, { family: 'list' }> }>()</script>
<template><div class="family-renderer" data-renderer="list" :data-state="dispatch.status" aria-label="Repères en liste"><p>Liste · {{ dispatch.representation.rows.length }} entrées · {{ dispatch.facet.unit }}</p></div></template>
