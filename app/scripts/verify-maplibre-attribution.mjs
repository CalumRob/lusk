import assert from 'node:assert/strict'
import { Window } from 'happy-dom'

// This isolated check loads the installed, real MapLibre module (not the app's
// globally mocked MapLibre) and runs its AttributionControl with DOM fixtures.
const window = new Window()
for (const key of ['window', 'document', 'DOMParser', 'HTMLElement', 'Element', 'Node']) {
  globalThis[key] = key === 'window' ? window : window[key]
}

const { AttributionControl } = await import('maplibre-gl')
const hostileAndLegitimateAttribution =
  '<a href="https://www.openstreetmap.org/copyright" onclick="alert(1)" onmouseover="alert(2)">© OpenStreetMap</a>' +
  ' | <a href="https://example.org/credits">Tile provider</a>'

const map = {
  style: {
    stylesheet: { owner: 'fixture', id: 'local-fixture' },
    tileManagers: {
      fixture: { used: true, usedForTerrain: false, getSource: () => ({ attribution: hostileAndLegitimateAttribution }) },
    },
  },
  on() {},
  off() {},
  _getUIString: (key) => key,
  getCanvasContainer: () => ({ offsetWidth: 900 }),
}

const control = new AttributionControl({ compact: false, customAttribution: '' })
const controlElement = control.onAdd(map)
const rendered = controlElement.querySelector('.maplibregl-ctrl-attrib-inner')
assert.ok(rendered, 'the real MapLibre attribution control renders its attribution container')
assert.equal(rendered.querySelectorAll('[onclick], [onmouseover]').length, 0,
  'consecutive hostile event-handler attributes are removed by the attribution sanitizer')
assert.equal(rendered.querySelector('a[href="https://www.openstreetmap.org/copyright"]')?.textContent, '© OpenStreetMap',
  'required OSM attribution link and text survive sanitization')
assert.equal(rendered.querySelector('a[href="https://example.org/credits"]')?.textContent, 'Tile provider',
  'legitimate provider attribution link survives sanitization')
assert.equal(rendered.querySelectorAll('a').length, 2, 'sanitizer retains both legitimate attribution links')

control.onRemove()
window.happyDOM.abort()
console.log('PASS real MapLibre AttributionControl DOM sanitization and attribution retention (6.4.1)')
