import { describe, expect, it } from 'vitest'

import { isUserScrollKey } from '@/fiche/navigationIntent'

function keyEvent(key: string, target: EventTarget, options: { composing?: boolean; prevented?: boolean } = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  Object.defineProperty(event, 'target', { value: target })
  Object.defineProperty(event, 'composedPath', { value: () => [target] })
  if (options.composing) Object.defineProperty(event, 'isComposing', { value: true })
  if (options.prevented) event.preventDefault()
  return event
}

describe('isUserScrollKey - #1010 navigation intent', () => {
  it('does not treat editable controls or IME composition as scroll intent', () => {
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    const select = document.createElement('select')
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    const combobox = document.createElement('div')
    combobox.setAttribute('role', 'combobox')
    const nested = document.createElement('span')
    editable.appendChild(nested)

    for (const target of [input, textarea, select, editable, combobox, nested]) {
      expect(isUserScrollKey(keyEvent(' ', target))).toBe(false)
      expect(isUserScrollKey(keyEvent('ArrowDown', target))).toBe(false)
    }
    expect(isUserScrollKey(keyEvent(' ', document.body, { composing: true }))).toBe(false)
    expect(isUserScrollKey(keyEvent('PageDown', document.body, { composing: true }))).toBe(false)
  })

  it('keeps non-editable navigation keys as scroll intent and ignores other keys / prevented defaults', () => {
    expect(isUserScrollKey(keyEvent(' ', document.body))).toBe(true)
    expect(isUserScrollKey(keyEvent('PageDown', document.body))).toBe(true)
    expect(isUserScrollKey(keyEvent('ArrowUp', document.body))).toBe(true)
    expect(isUserScrollKey(keyEvent('Home', document.body))).toBe(true)
    expect(isUserScrollKey(keyEvent('End', document.body))).toBe(true)
    expect(isUserScrollKey(keyEvent('a', document.body))).toBe(false)
    expect(isUserScrollKey(keyEvent(' ', document.body, { prevented: true }))).toBe(false)
  })
})
