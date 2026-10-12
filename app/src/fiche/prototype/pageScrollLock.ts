let activeLocks = 0
let previousRootOverflow = ''

/**
 * Prevent background document scrolling without making the root a scroll
 * container, which would break viewport-sticky elements behind a modal.
 */
export function lockPageScroll(): () => void {
  const root = document.documentElement
  if (activeLocks === 0) {
    previousRootOverflow = root.style.overflow
    root.style.overflow = 'clip'
  }

  activeLocks += 1
  let released = false

  return () => {
    if (released) return
    released = true
    activeLocks -= 1

    if (activeLocks === 0) {
      root.style.overflow = previousRootOverflow
      previousRootOverflow = ''
    }
  }
}
