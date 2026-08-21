<script setup lang="ts">import type { FamilyDispatch } from '@/indicateurs/familySeam'; defineProps<{ dispatch: FamilyDispatch }>()</script>
<template><div class="family-renderer" data-renderer="pyramid" :data-state="dispatch.status" aria-label="Repères en pyramide"><p>Pyramide · {{ dispatch.representation.rows.length }} parts · {{ dispatch.facet.unit }}</p></div></template>
