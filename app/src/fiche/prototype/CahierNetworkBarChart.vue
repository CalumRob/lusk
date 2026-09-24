<script setup lang="ts">
import type { Component } from 'vue'

import CahierFigureScalar from './CahierFigureScalar.vue'

export interface CahierNetworkBarSegment {
  key: string
  label: string
  value: number | null
  color: string
}

export interface CahierNetworkBarRow {
  key: string
  label: string
  value: string
  numericValue: number | null
  color: string
  tone: 't' | 'b' | 'c' | 'neutral'
  icon?: Component
  segments?: readonly CahierNetworkBarSegment[]
  useSegments?: boolean
  colorValue?: boolean
  markerValue?: number | null
  ariaLabel?: string
}

const props = defineProps<{
  rows: readonly CahierNetworkBarRow[]
  maximum: number
  unit: string
  referenceLabel?: string | null
  activeKey?: string | null
  ariaLabel?: string
}>()

const emit = defineEmits<{
  activate: [key: string, event: Event]
  deactivate: []
}>()

function relativeWidth(value: number | null): string {
  const safeMaximum = Math.max(1, props.maximum)
  return `${Math.max(0, (value ?? 0) / safeMaximum) * 100}%`
}

function rowAriaLabel(row: CahierNetworkBarRow): string {
  return row.ariaLabel ?? `${row.label} : ${row.value} ${props.unit}`
}
</script>

<template>
  <div class="cahier-network-bar-chart" :aria-label="props.ariaLabel">
    <div class="cahier-network-bar-chart__header" aria-hidden="true">
      <span />
      <span />
      <span class="cahier-network-bar-chart__header-meta">
        <span class="cahier-network-bar-chart__unit">{{ props.unit }}</span>
        <span v-if="props.referenceLabel" class="cahier-network-bar-chart__reference-key">
          <i aria-hidden="true" />{{ props.referenceLabel }}
        </span>
      </span>
    </div>
    <div class="cahier-network-bar-chart__rows">
      <button
        v-for="row in props.rows"
        :key="row.key"
        type="button"
        class="cahier-network-bar-row"
          :class="{
          'cahier-network-bar-row--active': props.activeKey === row.key,
          'cahier-network-bar-row--dimmed': props.activeKey !== null && props.activeKey !== undefined && props.activeKey !== row.key,
          [`cahier-network-bar-row--${row.tone}`]: true,
          [`cahier-network-bar-row--${row.key}`]: true,
        }"
        :aria-label="rowAriaLabel(row)"
        @mouseenter="emit('activate', row.key, $event)"
        @focus="emit('activate', row.key, $event)"
        @mouseleave="emit('deactivate')"
        @blur="emit('deactivate')"
      >
        <span class="cahier-network-bar-row__label" :style="{ color: row.color }">
          <component :is="row.icon" v-if="row.icon" :size="16" aria-hidden="true" />
          <span>
            <span class="cahier-network-bar-row__label-main">{{ row.label }}</span>
            <span v-if="row.segments?.length" class="cahier-network-bar-row__segments">
              <span
                v-for="segment in row.segments"
                :key="segment.key"
                :style="{ color: segment.color }"
              >{{ segment.label }}</span>
            </span>
          </span>
        </span>
        <span class="cahier-network-bar-row__track" aria-hidden="true">
          <template v-if="row.useSegments && row.segments?.length">
            <span
              v-for="segment in row.segments"
              :key="segment.key"
              class="cahier-network-bar-row__segment"
              :style="{ width: relativeWidth(segment.value), background: segment.color }"
            />
          </template>
          <span
            v-else
            class="cahier-network-bar-row__fill"
            :style="{ width: relativeWidth(row.numericValue), background: row.color }"
          />
          <span
            v-if="row.markerValue !== null && row.markerValue !== undefined"
            class="cahier-network-bar-row__marker"
            :style="{ left: relativeWidth(row.markerValue) }"
          />
        </span>
        <CahierFigureScalar
          class="cahier-network-bar-row__scalar"
          layout="inline"
          :show-label="false"
          :color-value="row.colorValue ?? true"
          :tone="row.tone"
          :value="row.value"
          :label="row.label"
          :aria-label="rowAriaLabel(row)"
        />
      </button>
    </div>
  </div>
</template>

<style scoped>
.cahier-network-bar-chart {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.cahier-network-bar-chart__header,
.cahier-network-bar-row {
  display: grid;
  grid-template-columns: minmax(152px, .85fr) minmax(120px, 1.35fr) max-content;
  gap: var(--space-2);
  align-items: center;
}

.cahier-network-bar-chart__header {
  min-height: 16px;
  color: var(--cahier-default);
  font: var(--type-figure-label);
}

.cahier-network-bar-chart__unit {
  justify-self: end;
  font-size: 9px;
  letter-spacing: normal;
  white-space: nowrap;
}

.cahier-network-bar-chart__header-meta {
  display: grid;
  justify-items: end;
  gap: 4px;
  min-width: 0;
}

.cahier-network-bar-chart__reference-key {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--cahier-region-emphasis);
  font-size: 9px;
  letter-spacing: normal;
  white-space: nowrap;
}

.cahier-network-bar-chart__reference-key i {
  display: inline-block;
  width: 8px;
  height: 8px;
  border: 1px solid currentColor;
  border-radius: 50%;
  background: var(--paper);
}

.cahier-network-bar-row {
  min-width: 0;
  padding: 10px 0;
  border: 0;
  border-top: 1px solid var(--fine-rule);
  color: var(--cahier-default);
  background: transparent;
  text-align: left;
  cursor: help;
  transition: opacity 150ms ease-out, color 150ms ease-out;
}

.cahier-network-bar-row--dimmed { opacity: .42; }
.cahier-network-bar-row:focus-visible { outline: 2px solid var(--cahier-theme-strong); outline-offset: 3px; }

.cahier-network-bar-row__label {
  display: flex;
  gap: 7px;
  align-items: center;
  min-width: 0;
  font: var(--type-figure-mode);
  line-height: 1.2;
}

.cahier-network-bar-row__label > svg { flex: 0 0 auto; }
.cahier-network-bar-row__label > span { min-width: 0; }
.cahier-network-bar-row__label-main { display: block; overflow-wrap: anywhere; }

.cahier-network-bar-row__segments {
  display: flex;
  flex-wrap: wrap;
  gap: 0 8px;
  margin-top: 3px;
  color: var(--cahier-default);
  font: var(--type-figure-label);
  letter-spacing: normal;
}

.cahier-network-bar-row__segments span + span::before {
  margin-right: 8px;
  color: var(--cahier-default);
  content: '/';
}

.cahier-network-bar-row__track {
  position: relative;
  display: block;
  height: 7px;
  background: color-mix(in srgb, var(--cahier-default) 13%, var(--paper));
}

.cahier-network-bar-row__fill,
.cahier-network-bar-row__segment {
  display: inline-block;
  height: 100%;
  min-width: 2px;
  vertical-align: top;
}

.cahier-network-bar-row__marker {
  position: absolute;
  top: 50%;
  width: 8px;
  height: 8px;
  border: 1px solid var(--cahier-region-emphasis);
  border-radius: 50%;
  background: var(--paper);
  transform: translate(-50%, -50%);
}

.cahier-network-bar-row__scalar :deep(.cahier-figure-scalar-value) {
  justify-content: flex-end;
  font-size: 14px;
  white-space: nowrap;
}

@media (max-width: 760px) {
  .cahier-network-bar-chart__header,
  .cahier-network-bar-row {
    grid-template-columns: minmax(96px, .8fr) minmax(78px, 1fr) max-content;
  }
}
</style>
