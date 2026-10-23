<script setup lang="ts">
import Viewer from 'viewerjs'
import 'viewerjs/dist/viewer.css'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { lockPageScroll } from './pageScrollLock'

export interface CahierMapGalleryImage {
  key: string
  src: string
  alt: string
}

const props = defineProps<{ images: readonly CahierMapGalleryImage[] }>()
const emit = defineEmits<{ unavailable: [key: string] }>()

const gallerySource = ref<HTMLElement | null>(null)
const galleryInstance = shallowRef<Viewer | null>(null)
const galleryImage = ref<HTMLImageElement | null>(null)
const galleryOpened = ref(false)
const galleryAtNaturalSize = ref(false)
const unavailableKeys = ref(new Set<string>())
let galleryPointerStart: { x: number; y: number } | null = null
let galleryIgnoreNextClick = false
let galleryIgnoreResetTimer: ReturnType<typeof setTimeout> | null = null
let releasePageScrollLock: (() => void) | null = null

const availableImages = computed(() => props.images.filter((image) => !unavailableKeys.value.has(image.key)))

function removeGalleryImageClick(): void {
  galleryImage.value?.removeEventListener('click', onGalleryImageClick)
  galleryImage.value?.removeEventListener('pointerdown', onGalleryPointerDown)
  stopGalleryPointerTracking()
  if (galleryIgnoreResetTimer) clearTimeout(galleryIgnoreResetTimer)
  galleryIgnoreResetTimer = null
  galleryIgnoreNextClick = false
  galleryImage.value = null
}

function stopGalleryPointerTracking(): void {
  document.removeEventListener('pointermove', onGalleryPointerMove)
  document.removeEventListener('pointerup', onGalleryPointerUp)
  document.removeEventListener('pointercancel', onGalleryPointerUp)
  galleryPointerStart = null
}

function onGalleryPointerDown(event: PointerEvent): void {
  galleryPointerStart = { x: event.clientX, y: event.clientY }
  galleryIgnoreNextClick = false
  document.addEventListener('pointermove', onGalleryPointerMove)
  document.addEventListener('pointerup', onGalleryPointerUp)
  document.addEventListener('pointercancel', onGalleryPointerUp)
}

function onGalleryPointerMove(event: PointerEvent): void {
  if (!galleryPointerStart) return
  if (Math.hypot(event.clientX - galleryPointerStart.x, event.clientY - galleryPointerStart.y) > 3) {
    galleryIgnoreNextClick = true
  }
}

function onGalleryPointerUp(): void {
  stopGalleryPointerTracking()
  if (!galleryIgnoreNextClick) return
  if (galleryIgnoreResetTimer) clearTimeout(galleryIgnoreResetTimer)
  galleryIgnoreResetTimer = setTimeout(() => {
    galleryIgnoreNextClick = false
    galleryIgnoreResetTimer = null
  }, 0)
}

function onGalleryImageClick(event: MouseEvent): void {
  const gallery = galleryInstance.value
  const image = galleryImage.value
  if (!gallery || !image) return
  if (galleryIgnoreNextClick) {
    galleryIgnoreNextClick = false
    if (galleryIgnoreResetTimer) clearTimeout(galleryIgnoreResetTimer)
    galleryIgnoreResetTimer = null
    return
  }
  if (galleryAtNaturalSize.value) {
    gallery.reset()
    galleryAtNaturalSize.value = false
    image.closest('.viewer-container')?.classList.remove('lusk-map-gallery--zoomed')
    return
  }
  const canvas = image.closest('.viewer-canvas')
  const canvasRect = canvas?.getBoundingClientRect()
  gallery.zoomTo(1, true, {
    x: event.clientX - (canvasRect?.left ?? 0),
    y: event.clientY - (canvasRect?.top ?? 0),
  })
  galleryAtNaturalSize.value = true
  image.closest('.viewer-container')?.classList.add('lusk-map-gallery--zoomed')
}

function onGalleryViewed(event: Viewer.ViewedEvent): void {
  removeGalleryImageClick()
  galleryImage.value = event.detail.image
  galleryImage.value.addEventListener('click', onGalleryImageClick)
  galleryImage.value.addEventListener('pointerdown', onGalleryPointerDown)
  galleryAtNaturalSize.value = false
  galleryImage.value.closest('.viewer-container')?.classList.remove('lusk-map-gallery--zoomed')
}

function releaseGalleryPageScrollLock(): void {
  releasePageScrollLock?.()
  releasePageScrollLock = null
}

function onGalleryHidden(): void {
  galleryAtNaturalSize.value = false
  galleryImage.value?.closest('.viewer-container')?.classList.remove('lusk-map-gallery--zoomed')
  removeGalleryImageClick()
  releaseGalleryPageScrollLock()
}

async function imageUnavailable(key: string): Promise<void> {
  unavailableKeys.value = new Set(unavailableKeys.value).add(key)
  emit('unavailable', key)
  await nextTick()
  galleryInstance.value?.update()
}

async function open(key: string): Promise<boolean> {
  const index = availableImages.value.findIndex((image) => image.key === key)
  if (index < 0 || !galleryInstance.value) return false
  galleryOpened.value = true
  await nextTick()
  releasePageScrollLock ??= lockPageScroll()
  galleryInstance.value.update()
  galleryInstance.value.view(index)
  return true
}

defineExpose({ open })

onMounted(() => {
  if (gallerySource.value) {
    galleryInstance.value = new Viewer(gallerySource.value, {
      backdrop: true,
      button: true,
      className: 'lusk-map-gallery',
      fullscreen: false,
      initialCoverage: 0.9,
      maxZoomRatio: 1.2,
      navigation: true,
      navbar: { show: true, size: 'large', visibleItemCount: Math.max(1, props.images.length) },
      rotatable: false,
      scalable: false,
      slideOnWheel: false,
      title: [1, (image) => image.alt],
      toggleOnDblclick: false,
      toolbar: false,
      transition: { move: false, zoom: true },
      viewed: onGalleryViewed,
      hidden: onGalleryHidden,
    })
  }
})

onBeforeUnmount(() => {
  removeGalleryImageClick()
  releasePageScrollLock?.()
  releasePageScrollLock = null
  galleryInstance.value?.destroy()
  galleryInstance.value = null
})
</script>

<template>
  <div ref="gallerySource" class="map-gallery-source" aria-hidden="true">
    <img
      v-for="image in availableImages"
      :key="image.key"
      :src="galleryOpened ? image.src : undefined"
      :alt="image.alt"
      @error="imageUnavailable(image.key)"
    />
  </div>
</template>

<style scoped>
.map-gallery-source {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

:global(body.viewer-open) {
  /* Viewer.js normally hides body overflow; that creates the sticky-breaking
     scroll container that CahierDialog avoids. Keep scrolling locked at html. */
  overflow: visible !important;
}

:global(.lusk-map-gallery.viewer-container) {
  z-index: 2015;
  color: #fff;
  background: #18201f;
}

:global(.lusk-map-gallery .viewer-canvas) { background: #18201f; }
:global(.lusk-map-gallery .viewer-canvas > img) { cursor: zoom-in; touch-action: none; }
:global(.lusk-map-gallery--zoomed .viewer-canvas > img) { cursor: grab; }
:global(.lusk-map-gallery .viewer-footer) { background: linear-gradient(transparent, rgb(24 31 30 / 94%)); }
:global(.lusk-map-gallery .viewer-title) { color: #fff; font: var(--text-caption); }
:global(.lusk-map-gallery .viewer-navbar) { background: rgb(24 31 30 / 86%); }
:global(.lusk-map-gallery .viewer-button) { background-color: rgb(24 31 30 / 72%); }
:global(.lusk-map-gallery .viewer-button:hover),
:global(.lusk-map-gallery .viewer-button:focus) { background-color: rgb(24 31 30 / 96%); }
:global(.lusk-map-gallery .viewer-prev),
:global(.lusk-map-gallery .viewer-next) { background-color: rgb(24 31 30 / 72%); }
:global(.lusk-map-gallery .viewer-prev:hover),
:global(.lusk-map-gallery .viewer-next:hover) { background-color: rgb(24 31 30 / 96%); }
</style>
