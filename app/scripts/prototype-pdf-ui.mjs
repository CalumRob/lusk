// THROWAWAY UI host. Normal dev/build servers never inject this mockup.
import { createServer } from 'vite'
import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'

const capture = process.argv.includes('--capture')
const port = capture ? 5201 : 5200
const url = `http://127.0.0.1:${port}/territoire/commune/35238?theme=mobilite&comparaison=epci&pdf-ui-mockup=1&pdf-ui-state=ready`
const server = await createServer({
  plugins: [{
    name: 'throwaway-pdf-ui-host',
    transformIndexHtml(html, context) {
      if (!new URL(context.originalUrl ?? context.path, 'http://localhost').searchParams.has('pdf-ui-mockup')) return html
      return { html, tags: [{ tag: 'script', attrs: { type: 'module' }, children: `import { mountPdfUiMockup } from '/src/fiche/prototype/pdf-prototype/pdfUiMockup.js'; mountPdfUiMockup();`, injectTo: 'body' }] }
    },
  }],
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
})
await server.listen()
console.log(`PDF UI mockup (simulation only): ${url}`)
if (capture) {
  const out = 'E:/Temp/opencode/cahier-pdf-ui-mockup'
  await mkdir(out, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const evidence = {}
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
    const errors = []; page.on('pageerror', error => errors.push(error.message))
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(async () => {
      const { ready } = await import('/src/fiche/prototype/pdf-prototype/rennes.js')
      return ready() && window.pdfUiMockup?.modes().length === 3
    }, null, { timeout: 60000 })
    await page.evaluate(() => document.fonts.ready)
    const section = key => page.locator(`.concept-group[data-section="${key}"]`)
    for (const key of ['aedar-equipment-profile', 'aedar-equipment-explorer']) {
      await section(key).scrollIntoViewIfNeeded()
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      await page.waitForFunction(async () => (await import('/src/fiche/prototype/pdf-prototype/rennes.js')).ready(), null, { timeout: 60000 })
      await section(key).locator(key === 'aedar-equipment-profile' ? '.aedar-waffle-tile' : '.aedar-equipment-explorer-selected').first().waitFor({ state: 'visible', timeout: 60000 })
      await section(key).screenshot({ path: `${out}/desktop-${key}.png`, caret: 'initial' })
    }
    const activeBefore = await page.evaluate(() => window.pdfUiMockup.modes().map(mode => mode.key))
    let downloads = 0; page.on('download', () => { downloads++ })
    const sandbox = section('aedar-equipment-explorer')
    await sandbox.locator('[data-pdf-ui-heading]').screenshot({ path: `${out}/desktop-heading-ready.png`, caret: 'initial' })
    evidence.borderlessAction = await sandbox.locator('[data-pdf-ui-export]').evaluate(button => getComputedStyle(button).borderTopWidth === '0px')
    evidence.verticallyAligned = await sandbox.evaluate(section => {
      const title = section.querySelector('[data-pdf-ui-heading-copy]').getBoundingClientRect()
      const button = section.querySelector('[data-pdf-ui-export]').getBoundingClientRect()
      return Math.abs(title.y + title.height / 2 - button.y - button.height / 2) < 1
    })
    await sandbox.locator('[data-pdf-ui-export]').click()
    evidence.directWithThree = await sandbox.locator('[data-pdf-ui-export]').getAttribute('aria-busy') === 'true'
    await sandbox.locator('[data-pdf-ui-state="done"]').waitFor()
    evidence.successInButton = (await sandbox.locator('[data-pdf-ui-export]').innerText()).includes('PDF généré')
    await page.mouse.move(0, 0)
    await sandbox.screenshot({ path: `${out}/desktop-success.png`, caret: 'initial' })
    await sandbox.locator('[data-pdf-ui-heading]').screenshot({ path: `${out}/desktop-heading-success.png`, caret: 'initial' })
    const inactive = sandbox.locator('.aedar-equipment-explorer-modes button[aria-pressed="false"]')
    while (await inactive.count()) await inactive.first().click()
    const fiveModes = await page.evaluate(() => window.pdfUiMockup.modes().map(mode => mode.key))
    await sandbox.locator('[data-pdf-ui-export]').click()
    const dialog = page.locator('.pdf-ui-dialog')
    await dialog.waitFor({ state: 'visible' })
    evidence.updatedDialogTitle = (await dialog.locator('h2').innerText()) === 'Exporter en PDF'
    evidence.updatedGenerateLabel = (await dialog.locator('[data-pdf-ui-confirm]').innerText()).includes('Générer le PDF')
    const checks = dialog.locator('input[type="checkbox"]')
    const confirm = dialog.locator('[data-pdf-ui-confirm]')
    evidence.disabledWithZero = await confirm.isDisabled()
    for (let index = 0; index < 4; index++) await checks.nth(index).check()
    evidence.disabledWithFour = await confirm.isDisabled()
    await checks.nth(3).uncheck()
    evidence.enabledWithThree = await confirm.isEnabled()
    await dialog.screenshot({ path: `${out}/desktop-mode-choice.png`, caret: 'initial' })
    await page.keyboard.press('Escape')
    evidence.cancelKeepsFive = JSON.stringify(fiveModes) === JSON.stringify(await page.evaluate(() => window.pdfUiMockup.modes().map(mode => mode.key)))
    evidence.cancelRestoresFocus = await sandbox.locator('[data-pdf-ui-export]').evaluate(button => button === document.activeElement)
    await sandbox.locator('[data-pdf-ui-export]').click()
    await dialog.waitFor({ state: 'visible' })
    for (let index = 0; index < 3; index++) await checks.nth(index).check()
    await confirm.click()
    evidence.confirmPrepares = await sandbox.locator('[data-pdf-ui-export]').getAttribute('aria-busy') === 'true'
    await sandbox.locator('[data-pdf-ui-state="done"]').waitFor()
    evidence.confirmKeepsFive = JSON.stringify(fiveModes) === JSON.stringify(await page.evaluate(() => window.pdfUiMockup.modes().map(mode => mode.key)))
    await page.evaluate(() => window.pdfUiMockup.changeScenario('preparing'))
    await sandbox.screenshot({ path: `${out}/desktop-preparing.png`, caret: 'initial' })
    await sandbox.locator('[data-pdf-ui-heading]').screenshot({ path: `${out}/desktop-heading-preparing.png`, caret: 'initial' })
    await page.evaluate(() => window.pdfUiMockup.changeScenario('error'))
    await sandbox.screenshot({ path: `${out}/desktop-error.png`, caret: 'initial' })
    await sandbox.locator('[data-pdf-ui-heading]').screenshot({ path: `${out}/desktop-heading-error.png`, caret: 'initial' })
    evidence.retryInButton = (await sandbox.locator('[data-pdf-ui-export]').innerText()).includes('Réessayer')
    await sandbox.locator('[data-pdf-ui-export]').click()
    evidence.retryPreparesDirectly = await sandbox.locator('[data-pdf-ui-export]').getAttribute('aria-busy') === 'true' && !await dialog.isVisible()
    await page.evaluate(() => window.pdfUiMockup.changeScenario('ready'))
    await page.setViewportSize({ width: 390, height: 844 })
    await sandbox.scrollIntoViewIfNeeded()
    await sandbox.screenshot({ path: `${out}/mobile-sandbox.png`, caret: 'initial' })
    await sandbox.locator('[data-pdf-ui-heading]').screenshot({ path: `${out}/mobile-section-heading.png`, caret: 'initial' })
    await sandbox.locator('[data-pdf-ui-export]').click()
    await dialog.waitFor({ state: 'visible' })
    await dialog.screenshot({ path: `${out}/mobile-mode-choice.png`, caret: 'initial' })
    evidence.mobileNoHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
    evidence.noDownloads = downloads === 0
    evidence.browserErrors = errors
    evidence.initialModes = activeBefore
    await writeFile(`${out}/verification.json`, JSON.stringify(evidence, null, 2))
    console.log(evidence)
    if (Object.entries(evidence).some(([key, value]) => typeof value === 'boolean' && !value) || errors.length) process.exitCode = 1
  } finally { await browser.close(); server.httpServer?.closeAllConnections(); await server.close() }
}
