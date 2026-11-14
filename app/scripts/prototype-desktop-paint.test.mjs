import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cornerRadii, borderPattern } from '../src/fiche/prototype/pdf-prototype/paintGeometry.js'

test('legend first swatch rounds only its outside corners', () => {
  const style = { borderRadius: '4px 0px 0px 4px', borderTopLeftRadius: '4px', borderTopRightRadius: '0px', borderBottomRightRadius: '0px', borderBottomLeftRadius: '4px' }
  assert.deepEqual(cornerRadii(style, 90, 8, 1), [[4, 4], [0, 0], [0, 0], [4, 4]])
})
test('legend last swatch rounds only its outside corners', () => {
  const style = { borderRadius: '0px 4px 4px 0px', borderTopLeftRadius: '0px', borderTopRightRadius: '4px', borderBottomRightRadius: '4px', borderBottomLeftRadius: '0px' }
  assert.deepEqual(cornerRadii(style, 90, 8, 1), [[0, 0], [4, 4], [4, 4], [0, 0]])
})
test('comparison dash border does not become a solid legend line', () => {
  assert.ok(borderPattern('dashed', 2).length > 0)
  assert.deepEqual(borderPattern('solid', 2), [])
})
