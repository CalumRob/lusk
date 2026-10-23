import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const tokensCss = readFileSync(join(process.cwd(), 'src', 'styles', 'tokens.css'), 'utf8')

type Clamp = {
  floor: number
  ceiling: number
  rem: number
  vw: number
}

function headingClamp(token: string): Clamp {
  const declaration = tokensCss.match(new RegExp(`${token}\\s*:[^;]*clamp\\(([^)]+)\\)`))
  if (!declaration?.[1]) throw new Error(`Expected ${token} to contain a clamp()`)

  const [floorValue, middleValue, ceilingValue] = declaration[1].split(',').map((part) => part.trim())
  const floor = floorValue?.match(/^([\d.]+)rem$/)
  const middle = middleValue?.match(/^([\d.]+)rem\s*\+\s*([\d.]+)vw$/)
  const ceiling = ceilingValue?.match(/^([\d.]+)rem$/)

  if (!floor || !middle || !ceiling) {
    throw new Error(`${token} must use rem floors/ceilings and a rem + vw middle term`)
  }

  return {
    floor: Number(floor[1]) * 16,
    rem: Number(middle[1]) * 16,
    vw: Number(middle[2]),
    ceiling: Number(ceiling[1]) * 16,
  }
}

function resolve(clamp: Clamp, viewportWidth: number): number {
  return Math.min(clamp.ceiling, Math.max(clamp.floor, clamp.rem + (clamp.vw * viewportWidth) / 100))
}

describe('mobile Cahier type scale', () => {
  it.each(['--text-display', '--text-h1', '--text-page-heading', '--text-cahier-section'])(
    '%s reaches its limits without reversing as the viewport grows',
    (token) => {
      const clamp = headingClamp(token)
      const widths = Array.from({ length: 1500 - 320 + 1 }, (_, index) => 320 + index)
      const sizes = widths.map((width) => resolve(clamp, width))

      // Coefficients are rounded to three or four decimals in the design token.
      expect(Math.abs(resolve(clamp, 360) - clamp.floor)).toBeLessThanOrEqual(0.01)
      expect(Math.abs(resolve(clamp, 1440) - clamp.ceiling)).toBeLessThanOrEqual(0.01)
      expect(sizes).toEqual([...sizes].sort((a, b) => a - b))
    },
  )
})
