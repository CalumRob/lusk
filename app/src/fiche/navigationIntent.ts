/**
 * #1010 — the one keyboard test for navigation-scroll intent.
 *
 * A Space/Home/End/arrow key is a scroll request only when it is not consumed
 * by an editable control (comparison search, builder input, select, textarea or
 * contenteditable) and not part of an IME composition. The chapter intent and
 * the Cahier reveal both use this seam, so a reader typing in a comparison
 * control never cancels a pending fragment arrival.
 */
const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' '])

function isEditable(node: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(node instanceof HTMLElement)) return false
  if (node.isContentEditable) return true
  return Boolean(node.closest(
    'input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"], [role="searchbox"]',
  ))
}

export function isUserScrollKey(event: KeyboardEvent): boolean {
  if (event.isComposing || event.keyCode === 229) return false
  if (!SCROLL_KEYS.has(event.key)) return false
  if (event.defaultPrevented) return false
  if (isEditable(event.target)) return false
  const path = event.composedPath?.() ?? []
  return !path.some((node) => isEditable(node))
}
