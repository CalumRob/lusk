/**
 * useMediaQuery — the responsive seam (the legacy app's composable, ported).
 * `correspond` is true when the media query matches; listens to change, no
 * SSR/test noise (window.matchMedia may be absent — then false).
 */
import { onBeforeUnmount, ref } from 'vue'
import type { Ref } from 'vue'

export function useMediaQuery(requete: string): Ref<boolean> {
  const correspond = ref(false)
  let media: MediaQueryList | null = null

  function maj(): void {
    correspond.value = media?.matches ?? false
  }

  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    media = window.matchMedia(requete)
    maj()
    media.addEventListener('change', maj)
  }

  onBeforeUnmount(() => {
    media?.removeEventListener('change', maj)
  })

  return correspond
}
