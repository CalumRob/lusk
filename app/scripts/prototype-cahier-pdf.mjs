// THROWAWAY: local fixture harness; not a production PDF endpoint.
import { createServer } from 'vite'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const output = 'E:/Temp/opencode/cahier-pdf-prototype'
await mkdir(output, { recursive: true })
const server = await createServer({ server: { host: '127.0.0.1', port: 5198, strictPort: true } })
await server.listen()
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  page.on('pageerror', error => console.error(error))
  await page.goto('http://127.0.0.1:5198/prototype-cahier-pdf.html')
  await page.waitForFunction(() => window.prototypeReady === true)
  await page.screenshot({ path: resolve(output, 'browser.png'), fullPage: true })
  const metrics = []
  for (const comparison of ['visible', 'none']) {
    await page.selectOption('#comparison', comparison)
    const downloadPromise = page.waitForEvent('download')
    await page.click('#export')
    const download = await downloadPromise
    await download.saveAs(resolve(output, `cahier-${comparison}.pdf`))
    await page.waitForFunction(() => !document.querySelector('#export').disabled)
    metrics.push({ comparison, result: await page.locator('#result').innerText() })
    await writeFile(resolve(output, `snapshot-${comparison}.json`), JSON.stringify(await page.evaluate(() => window.prototypeSnapshot), null, 2))
  }
  await writeFile(resolve(output, 'snapshot.json'), JSON.stringify(await page.evaluate(() => window.prototypeSnapshot), null, 2))
  console.log(`PDFs and screenshot: ${output}`)
  await writeFile(resolve(output, 'metrics.json'), JSON.stringify(metrics, null, 2))
  console.log(metrics)
} finally {
  await browser.close()
  await server.close()
}
