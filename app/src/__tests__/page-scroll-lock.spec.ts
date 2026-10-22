import { afterEach, describe, expect, it } from 'vitest'

import { lockPageScroll } from '@/fiche/prototype/pageScrollLock'

const root = document.documentElement
const previousOverflow = root.style.overflow

afterEach(() => {
  root.style.overflow = previousOverflow
})

describe('lockPageScroll', () => {
  it('uses root overflow clip until every modal releases its lock', () => {
    const releaseFirst = lockPageScroll()
    const releaseSecond = lockPageScroll()

    expect(root.style.overflow).toBe('clip')

    releaseFirst()
    expect(root.style.overflow).toBe('clip')

    releaseSecond()
    expect(root.style.overflow).toBe(previousOverflow)
  })

  it('makes each release idempotent', () => {
    const release = lockPageScroll()

    release()
    release()

    expect(root.style.overflow).toBe(previousOverflow)
  })
})
