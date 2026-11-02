import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

// Isolated browser fixture: real installed MapLibre, local GeoJSON/style only,
// no product API, deployed tile service, or live attribution content.
const packageRoot = resolve('node_modules/maplibre-gl')
const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/dist/maplibre-gl.css"></head>
<body><div id="map" style="width:800px;height:500px"></div><script type="module">
import { Map, NavigationControl } from '/dist/maplibre-gl.mjs';
const map = new Map({container:'map',center:[-2.5,48.5],zoom:6,style:{version:8,sources:{fixture:{type:'vector',url:location.origin+'/fixture/tiles.json'}},layers:[{id:'fixture-fill',type:'fill',source:'fixture','source-layer':'fixture',paint:{'fill-color':'#3b806e','fill-opacity':0.7}}]}});
map.addControl(new NavigationControl());
window.proof = {map, loaded: new Promise((resolve,reject)=>{map.once('load',resolve);map.once('error',e=>reject(e.error))})};
</script></body></html>`
const server = createHttpServer((req, res) => {
  if (req.url === '/') { res.writeHead(200, {'content-type':'text/html'}); res.end(html); return }
  if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return }
  if (req.url === '/fixture/tiles.json') {
    res.writeHead(200, {'content-type':'application/json'})
    res.end(JSON.stringify({tilejson:'3.0.0',name:'isolated tile fixture',scheme:'xyz',tiles:[`http://127.0.0.1:${server.address().port}/fixture/tiles/{z}/{x}/{y}.pbf`],minzoom:0,maxzoom:14,
      attribution:'<a href="https://www.openstreetmap.org/copyright" onclick="alert(1)" onmouseover="alert(2)">© OpenStreetMap</a> | <a href="https://example.org/credits">Tile provider</a>',
      vector_layers:[{id:'fixture',fields:{}}]}))
    return
  }
  if (/^\/fixture\/tiles\/\d+\/\d+\/\d+\.pbf$/.test(req.url ?? '')) {
    // Minimal valid Mapbox Vector Tile with one empty `fixture` layer.
    res.writeHead(200, {'content-type':'application/x-protobuf'})
    res.end(Buffer.from([0x1a,0x0e,0x0a,0x07,0x66,0x69,0x78,0x74,0x75,0x72,0x65,0x28,0x80,0x20,0x78,0x02]))
    return
  }
  if (req.url?.startsWith('/dist/')) {
    const name = req.url.slice('/dist/'.length)
    if (!/^[\w.-]+$/.test(name)) { res.writeHead(400); res.end(); return }
    const ext = name.endsWith('.css') ? 'text/css' : 'text/javascript'
    void readFile(resolve(packageRoot, 'dist', name)).then((content) => {
      res.writeHead(200, {'content-type':ext}); res.end(content)
    }, () => { res.writeHead(404); res.end() })
    return
  }
  res.writeHead(404); res.end()
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address()
let browser
try {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
    'C:/Program Files/Google/Chrome/Application/chrome.exe'
  browser = await chromium.launch({headless:true, executablePath, args:['--use-gl=angle','--use-angle=swiftshader']})
  const page = await browser.newPage({viewport:{width:1000,height:700}})
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('request', (request) => {
    assert.match(request.url(), /^http:\/\/127\.0\.0\.1:/, `unexpected external request ${request.url()}`)
  })
  await page.goto(`http://127.0.0.1:${port}/`)
  await page.waitForFunction(() => window.proof !== undefined, { timeout: 10000 }).catch(() => {})
  if (!await page.evaluate(() => Boolean(window.proof))) throw new Error(`MapLibre fixture bootstrap failed: ${errors.join(' | ')}`)
  await page.evaluate(() => window.proof.loaded)
  const initial = await page.evaluate(() => {
    const attr = document.querySelector('.maplibregl-ctrl-attrib-inner')
    return {text:attr?.textContent, handlers:attr?.querySelectorAll('[onclick],[onmouseover]').length,
      links:[...attr.querySelectorAll('a')].map(a=>({href:a.getAttribute('href'),text:a.textContent})),
      canvas:!!document.querySelector('.maplibregl-canvas'), zoom:window.proof.map.getZoom()}
  })
  assert.equal(initial.handlers, 0, 'real map attribution DOM has no hostile event attributes')
  assert.ok(initial.links.some(link=>link.href==='https://www.openstreetmap.org/copyright' && link.text==='© OpenStreetMap'))
  assert.ok(initial.links.some(link=>link.href==='https://example.org/credits' && link.text==='Tile provider'))
  assert.equal(initial.canvas, true, 'real MapLibre rendered its map canvas')
  await page.evaluate(() => { window.proof.map.zoomTo(8, {duration:0}); window.proof.map.resize() })
  assert.equal(await page.evaluate(() => window.proof.map.getZoom()), 8, 'real map supports zoom and resize')
  await page.screenshot({path:'E:/Temp/opencode/882-maplibre-browser.png', fullPage:true})
  await page.evaluate(() => window.proof.map.remove())
  assert.equal(await page.locator('.maplibregl-canvas').count(), 0, 'map cleanup removes the canvas')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({pass:true, maplibre:'6.4.1', browser:await browser.version(), initial, screenshot:'E:/Temp/opencode/882-maplibre-browser.png', errors}))
} finally {
  await browser?.close()
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}
