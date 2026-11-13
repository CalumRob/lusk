// THROWAWAY: read the real local Cahier against the deployed read-only API.
import { createServer } from 'vite'
import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'

const out = 'E:/Temp/opencode/cahier-rennes-pdf'
await mkdir(out, { recursive: true })
const server = await createServer({ server: { host: '127.0.0.1', port: 5198, strictPort: true } })
await server.listen()
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  page.on('pageerror', error => console.error('PAGE', error.message))
  page.on('response', response => { if (response.status() >= 400) console.log(response.status(), response.url()) })
  await page.goto('http://127.0.0.1:5198/territoire/commune/35238?theme=mobilite&comparaison=epci', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => {
    const element = document.querySelector('.cahier')
    const instance = element?.__vueParentComponent
    return instance?.props?.content?.units?.[0]?.sections?.some(section => section.evidence?.kind === 'aedar-car-overview' && section.evidence.scalars.some(scalar => scalar.value !== null))
  }, { timeout: 90000 })
  await page.waitForFunction(() => {
    const instance = document.querySelector('.cahier')?.__vueParentComponent
    return instance?.props?.comparisonStatus === 'ready'
  }, { timeout: 90000 })
  await page.evaluate(async () => { window.rennesPrototype = await import('/src/fiche/prototype/pdf-prototype/rennes.js') })
  await page.waitForFunction(() => window.rennesPrototype.ready(), null, { timeout: 120000 })
  const downloadPromise = page.waitForEvent('download', { timeout: 90000 })
  const receipt = await page.evaluate(() => window.rennesPrototype.exportRennes())
  const download = await downloadPromise
  await download.saveAs(`${out}/rennes-equipements-epci.pdf`)
  await writeFile(`${out}/snapshot.json`, JSON.stringify(await page.evaluate(() => window.rennesPdfSnapshot), null, 2))
  await writeFile(`${out}/receipt.json`, JSON.stringify(receipt, null, 2))
  console.log('PDF', receipt)
  const capture = await page.evaluate(() => {
    const instance = document.querySelector('.cahier').__vueParentComponent
    return JSON.parse(JSON.stringify({ content: instance.props.content,
      setupKeys: Object.keys(instance.setupState), comparisonStatus: instance.props.comparisonStatus,
      parentName: instance.parent?.type?.__name,
      images: [...document.querySelectorAll('#figure-lecture img')].map(image => ({ url: image.src, loaded: image.complete && image.naturalWidth > 0, width: image.naturalWidth, height: image.naturalHeight })),
    }))
  })
  await writeFile(`${out}/resolved-content.json`, JSON.stringify(capture, null, 2))
  await page.screenshot({ path: `${out}/screen.png`, fullPage: true })
  console.log(JSON.stringify({ sections: capture.content.units[0].sections.map(section => ({ key: section.key, availability: section.availability })), comparisonStatus: capture.comparisonStatus, loadedMaps: capture.images.filter(image => image.loaded).length }, null, 2))
  // Exercise an actual UI selection, not just a label passed to the PDF maker.
  await page.click('.aedar-equipment-explorer-horizon button[value="10"]')
  await page.waitForFunction(() => {
    const explorer = window.rennesPrototype.instances().find(instance => instance.type.__name === 'AedarEquipmentExplorerCahier')
    return explorer.setupState.horizonMinutes === 10
  })
  const changedDownload = page.waitForEvent('download', { timeout: 90000 })
  const changedReceipt = await page.evaluate(() => window.rennesPrototype.exportRennes())
  await (await changedDownload).saveAs(`${out}/rennes-equipements-epci-10min.pdf`)
  await writeFile(`${out}/snapshot-10min.json`, JSON.stringify(await page.evaluate(() => window.rennesPdfSnapshot), null, 2))
  await writeFile(`${out}/receipt-10min.json`, JSON.stringify(changedReceipt, null, 2))
  console.log('Changed-horizon PDF', changedReceipt)
} finally { await browser.close(); await server.close() }
