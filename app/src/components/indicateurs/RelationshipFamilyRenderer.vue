<script setup lang="ts">import type { FamilyDispatch } from '@/indicateurs/familySeam'; defineProps<{ dispatch: FamilyDispatch }>()</script>
<template><div class="family-renderer" data-renderer="relationship" :data-state="dispatch.status" aria-label="Repères de relation"><p>Relation · {{ dispatch.representation.rows.length }} points · {{ dispatch.facet.unit }}</p></div></template>
