// Small, independently checkable geometry seam for the throwaway DOM adapter.
export function cornerRadii(style, width, height, scale) {
  const length = (value, size) => value.endsWith('%') ? parseFloat(value) / 100 * size : (parseFloat(value) || 0) * scale
  const radii = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map(corner => {
    const [x, y = x] = style[`border${corner}Radius`].trim().split(/\s+/)
    return [length(x, width), length(y, height)]
  })
  const ratio = (size, sum) => sum ? size / sum : 1
  const factor = Math.min(1, ratio(width, radii[0][0] + radii[1][0]), ratio(width, radii[3][0] + radii[2][0]),
    ratio(height, radii[0][1] + radii[3][1]), ratio(height, radii[1][1] + radii[2][1]))
  return radii.map(radius => radius.map(value => value * factor))
}

export function borderPattern(style, width) {
  return style === 'dashed' ? [3 * width, 2 * width] : style === 'dotted' ? [width, width] : []
}

export function boxPath({ x, y, w, h }, [tl, tr, br, bl]) {
  const k = .5522847498307936
  return [
    { op: 'm', c: [x + tl[0], y] }, { op: 'l', c: [x + w - tr[0], y] },
    { op: 'c', c: [x + w - tr[0] * (1 - k), y, x + w, y + tr[1] * (1 - k), x + w, y + tr[1]] },
    { op: 'l', c: [x + w, y + h - br[1]] },
    { op: 'c', c: [x + w, y + h - br[1] * (1 - k), x + w - br[0] * (1 - k), y + h, x + w - br[0], y + h] },
    { op: 'l', c: [x + bl[0], y + h] },
    { op: 'c', c: [x + bl[0] * (1 - k), y + h, x, y + h - bl[1] * (1 - k), x, y + h - bl[1]] },
    { op: 'l', c: [x, y + tl[1]] },
    { op: 'c', c: [x, y + tl[1] * (1 - k), x + tl[0] * (1 - k), y, x + tl[0], y] },
    { op: 'h', c: [] },
  ]
}
