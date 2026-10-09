<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  open: boolean
  title: string
  kicker?: string
  labelledBy: string
}>()

const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
let suppressCloseEvent = false
let previousRootOverflow = ''

watch(() => props.open, (open) => {
  const element = dialog.value
  if (!element) return
  if (open && !element.open) {
    previousRootOverflow = document.documentElement.style.overflow
    // `hidden` makes <html> the scroll container and breaks the viewport-sticky
    // site header and Cahier margins. `clip` locks without creating one; the
    // native modal dialog makes the rest of the document inert, so don't lock
    // <body> and create another scroll container either.
    document.documentElement.style.overflow = 'clip'
    if (typeof element.showModal === 'function') element.showModal()
    else element.setAttribute('open', '')
  } else if (!open) {
    if (element.open && typeof element.close === 'function') element.close()
    else element.removeAttribute('open')
    restorePageScroll()
  }
}, { flush: 'post' })

function restorePageScroll() {
  document.documentElement.style.overflow = previousRootOverflow
}

onBeforeUnmount(restorePageScroll)

function close() {
  const element = dialog.value
  if (element?.open && typeof element.close === 'function') {
    suppressCloseEvent = true
    element.close()
  }
  emit('close')
}

function onNativeClose() {
  if (suppressCloseEvent) {
    suppressCloseEvent = false
    return
  }
  emit('close')
}
</script>

<template>
  <dialog
    ref="dialog"
    class="cahier-dialog"
    aria-modal="true"
    :aria-labelledby="props.labelledBy"
    @close="onNativeClose"
    @click="(event) => { if (event.target === event.currentTarget) close() }"
  >
    <div class="cahier-dialog__content">
      <h2 class="cahier-dialog__title" :id="props.labelledBy">{{ props.title }}</h2>
      <header class="cahier-dialog__header">
        <slot name="toolbar" />
        <button class="cahier-dialog__close" type="button" aria-label="Fermer la fenêtre" @click="close">×</button>
      </header>
      <slot />
    </div>
  </dialog>
</template>

<style scoped>
.cahier-dialog {
  --dialog-margin-width: 28px;
  width: min(96vw, 1080px);
  max-width: 1080px;
  max-height: min(88dvh, 900px);
  padding: 0;
  overflow: hidden;
  border: 1px solid color-mix(in oklab, var(--cahier-default) 18%, transparent);
  border-radius: 2px;
  background: var(--paper, #f1f2ec);
  color: var(--cahier-default, var(--text-primary));
  box-shadow: 0 24px 72px rgb(18 28 27 / 28%);
}
.cahier-dialog::backdrop { background: rgb(12 20 19 / 54%); backdrop-filter: blur(2px); }
.cahier-dialog__content {
  display: grid;
  align-content: start;
  gap: var(--space-4);
  max-height: min(88dvh, 900px);
  padding: 12px clamp(20px, 4vw, 44px) 24px clamp(32px, 6vw, 60px);
  overflow: hidden;
  text-align: left;
  background-image: linear-gradient(to right, transparent 0, transparent calc(var(--dialog-margin-width) - 1px), color-mix(in oklab, var(--red, #a44f51) 58%, transparent) calc(var(--dialog-margin-width) - 1px), color-mix(in oklab, var(--red, #a44f51) 58%, transparent) var(--dialog-margin-width), transparent var(--dialog-margin-width));
}
.cahier-dialog__header { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: var(--space-3); }
.cahier-dialog__kicker { margin: 0 0 var(--space-2); color: var(--text-secondary); font: var(--type-figure-label); }
.cahier-dialog__title { margin: 0; color: var(--cahier-default, var(--text-primary)); font: var(--text-h3); letter-spacing: var(--text-h3-tracking); }
.cahier-dialog__close { display: grid; width: 28px; height: 28px; flex: 0 0 auto; place-items: center; padding: 0; border: 0; border-radius: 0; background: transparent; color: inherit; font: 400 22px/1 var(--font-figure-label); cursor: pointer; }
.cahier-dialog__close:hover { color: var(--red, var(--cahier-default)); border-color: currentColor; }
.cahier-dialog button:focus-visible, .cahier-dialog input:focus-visible { outline: 2px solid var(--red, var(--accent-primary)); outline-offset: 2px; }
@media (max-width: 760px) { .cahier-dialog__close { order: 2; margin-left: auto; } }
@media (max-width: 520px) { .cahier-dialog { max-height: 94dvh; } .cahier-dialog__content { max-height: 94dvh; } .cahier-dialog__header { align-items: end; } }
</style>
