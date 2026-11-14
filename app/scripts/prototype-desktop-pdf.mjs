// THROWAWAY desktop-layout/selectable-text PDF experiment.
import { createServer } from 'vite'
import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
const out = 'E:/Temp/opencode/cahier-desktop-pdf'
await mkdir(out, { recursive: true })
const server = await createServer({ optimizeDeps: { include: ['jspdf', 'svg2pdf.js'] }, server: { host: '127.0.0.1', port: 5198, strictPort: true } })
await server.listen()
const browser = await chromium.launch({ headless: true })
let page
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  page.on('pageerror', error => console.error(error.message))
  page.on('response', response => { if (response.status() >= 400) console.error(response.status(), response.url()) })
  await page.goto('http://127.0.0.1:5198/territoire/commune/35238?theme=mobilite&comparaison=epci', { waitUntil: 'domcontentloaded' })
  await page.evaluate(async () => { window.rennesPrototype = await import('/src/fiche/prototype/pdf-prototype/rennes.js') })
  await page.waitForFunction(() => window.rennesPrototype.ready(), null, { timeout: 60000 })
  const inventory = await page.evaluate(async () => {
    await document.fonts.ready
    const elements = [...document.querySelectorAll('#figure-lecture *, .en-tete .lusk-marque, .en-tete .lusk-marque *')]
    const fonts = [...new Map(elements.filter(element => element.getClientRects().length).map(element => {
      const style = getComputedStyle(element)
      const spec = { family: style.fontFamily.split(',')[0].replaceAll(/["']/g, '').trim(), weight: Number(style.fontWeight), style: style.fontStyle, size: style.fontSize }
      return [JSON.stringify([spec.family, spec.weight, spec.style]), spec]
    })).values()]
    const loadedFaces = [...document.fonts].filter(face => face.status === 'loaded').map(face => ({ family: face.family.replaceAll(/["']/g, '').trim(), style: face.style, weight: face.weight }))
    return { fonts, loadedFaces, width: document.querySelector('#figure-lecture .page-main').getBoundingClientRect().width,
      sections: [...document.querySelectorAll('#figure-lecture .concept-group')].map(element => ({ key: element.dataset.section, height: element.getBoundingClientRect().height })) }
  })
  await writeFile(`${out}/inventory.json`, JSON.stringify(inventory, null, 2))
  await page.locator('.en-tete .lusk-marque').screenshot({ path: `${out}/site-brand.png` })
  console.log(inventory)
  if (!process.argv.includes('--inventory')) {
    execFileSync('python', ['scripts/prototype-pdf-fonts.py', `${out}/inventory.json`], { stdio: 'inherit' })
    await page.evaluate(async () => { window.desktopPdf = await import('/src/fiche/prototype/pdf-prototype/desktop.js') })
    const publicUrl = new URL(page.url())
    publicUrl.host = new URL(server.config.server.proxy['/api'].target).host
    publicUrl.port = new URL(server.config.server.proxy['/api'].target).port
    publicUrl.protocol = new URL(server.config.server.proxy['/api'].target).protocol
    await page.evaluate(url => { window.desktopPublicPageUrl = url }, publicUrl.href)
    const pending = page.waitForEvent('download', { timeout: 120000 })
    const receipt = await page.evaluate(() => window.desktopPdf.exportDesktop())
    await (await pending).saveAs(`${out}/rennes-desktop-epci.pdf`)
    await writeFile(`${out}/receipt.json`, JSON.stringify(receipt, null, 2))
    console.log(receipt)
  }
} catch (error) {
  if (page && !page.isClosed()) await writeFile(`${out}/failure.txt`, await page.locator('body').innerText())
  throw error
} finally { await browser.close(); server.httpServer?.closeAllConnections(); await server.close() }
