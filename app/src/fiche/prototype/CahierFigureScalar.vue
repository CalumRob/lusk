<script setup lang="ts">
import type { Component } from 'vue'

withDefaults(
  defineProps<{
    value: string
    label: string
    icon?: Component
    tone?: string
    extreme?: boolean
    /** Color the value when the scalar represents a declared mode or series. */
    colorValue?: boolean
    /** Keep the semantic label for assistive technology while omitting it visually. */
    showLabel?: boolean
    /** The same scalar brick can sit beside its label in a narrative row. */
    layout?: 'stacked' | 'inline'
    ariaLabel?: string
  }>(),
  {
    tone: 'neutral',
    extreme: false,
    colorValue: false,
    showLabel: true,
    layout: 'stacked',
    ariaLabel: undefined,
  },
)
</script>

<template>
  <div
    class="cahier-figure-scalar"
    :class="{
      'cahier-figure-scalar--extreme': extreme,
      'cahier-figure-scalar--colored': colorValue,
      [`cahier-figure-scalar--${tone}`]: colorValue,
      'cahier-figure-scalar--inline': layout === 'inline',
    }"
    role="img"
    :aria-label="ariaLabel"
  >
    <span class="cahier-figure-scalar-value">
      <component
        :is="icon"
        v-if="icon && layout === 'stacked'"
        class="cahier-figure-scalar-icon"
        :class="`cahier-figure-scalar-icon--${tone}`"
        :size="15"
        :stroke-width="2.2"
        aria-hidden="true"
      />
      <strong>{{ value }}</strong>
    </span>
    <span v-if="showLabel" class="cahier-figure-scalar-label">
      <component
        :is="icon"
        v-if="icon && layout === 'inline'"
        class="cahier-figure-scalar-icon"
        :class="`cahier-figure-scalar-icon--${tone}`"
        :size="15"
        :stroke-width="2.2"
        aria-hidden="true"
      />
      {{ label }}
    </span>
    <span v-if="$slots.reference" class="cahier-figure-scalar-reference">
      <slot name="reference" />
    </span>
  </div>
</template>

<style src="./cahierFigure.css"></style>
