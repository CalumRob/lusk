<script setup lang="ts">import type { FamilyDispatch } from '@/indicateurs/familySeam'; defineProps<{ dispatch: FamilyDispatch }>()</script>
<template><div class="family-renderer scalar-family-renderer" data-renderer="scalar"><slot :dispatch="dispatch" /></div></template>
