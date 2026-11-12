import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

// Self-check sur le serveur vivant : ne démarre, n'arrête et ne modifie aucun serveur.
const origin = process.env.COMPARISON_PREVIEW_ORIGIN ?? 'http://localhost:5174'
const evidence = resolve('../.scratch/comparison-third-pass')
await mkdir(evidence, { recursive: true })
const browser = await chromium.launch({ headless: true })
const reports = []
try {
  for (const width of [1440, 390]) {
    for (const [query, token] of [
      [null, 'EPCI'], ['epci', 'EPCI'], ['densite', 'Densité INSEE'],
      ['bretagne', 'Bretagne'], ['', 'Aucune'], ['commune:35238', '1 membre'],
    ]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } })
      const url = new URL('/territoire/commune/35238?theme=mobilite', origin)
      if (query !== null) url.searchParams.set('comparaison', query)
      await page.goto(url.href, { waitUntil: 'networkidle' })
      const button = page.locator('.page-heading .bouton-comparaison__declencheur').first()
      await button.waitFor()
      assert.equal(await button.locator('.bouton-comparaison__type').innerText(), token)
      assert.match(await button.getAttribute('aria-label') ?? '', /^Comparaison : .+/u)
      assert(!(await button.innerText()).includes('·'))
      const control = await button.evaluate((element) => {
        const heading = element.closest('.page-heading')
        const root = element.closest('.bouton-comparaison')
        const css = getComputedStyle(element)
        const separation = heading.querySelector('.page-heading-theme').getBoundingClientRect().left
          - element.getBoundingClientRect().right
        const withControl = heading.getBoundingClientRect().height
        root.style.display = 'none'
        const withoutControl = heading.getBoundingClientRect().height
        root.style.removeProperty('display')
        return { separation, border: css.borderLeftWidth, radius: css.borderRadius, withControl, withoutControl }
      })
      assert(control.separation >= 12 && control.border === '1px' && control.radius === '2px', JSON.stringify(control))
      assert.equal(control.withControl, control.withoutControl, JSON.stringify(control))
      await button.click()
      const panel = page.locator('.bouton-comparaison__menu')
      for (const option of await panel.locator('[role="menuitemradio"]').all()) {
        await option.hover()
        const geometry = await panel.evaluate((element) => {
          const rect = element.getBoundingClientRect()
          const css = getComputedStyle(element)
          const border = parseFloat(css.borderLeftWidth)
          const padding = parseFloat(css.paddingLeft)
          const range = document.createRange()
          range.selectNodeContents(element)
          const rects = [...range.getClientRects()].filter((box) => box.width)
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
          const textRects = []
          while (walker.nextNode()) {
            if (!walker.currentNode.textContent.trim()) continue
            range.selectNodeContents(walker.currentNode)
            textRects.push(...range.getClientRects())
          }
          return {
            panel: { left: rect.left, right: rect.right, top: rect.top, width: rect.width, height: rect.height,
              clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
              clientHeight: element.clientHeight, scrollHeight: element.scrollHeight,
              border, padding, whiteSpace: css.whiteSpace },
            contents: { left: Math.min(...rects.map((box) => box.left)),
              right: Math.max(...rects.map((box) => box.right)) },
            text: { left: Math.min(...textRects.map((box) => box.left)),
              right: Math.max(...textRects.map((box) => box.right)),
              top: Math.min(...textRects.map((box) => box.top)),
              bottom: Math.max(...textRects.map((box) => box.bottom)) },
            bottom: rect.bottom,
            descendantOverflow: [...element.querySelectorAll('*')].some((node) => node.scrollWidth > node.clientWidth + 1),
          }
        })
        const { panel: box, text, contents } = geometry
        assert(box.left >= 0 && box.right <= width, JSON.stringify(geometry))
        assert.equal(box.scrollWidth, box.clientWidth, JSON.stringify(geometry))
        assert.equal(box.scrollHeight, box.clientHeight, JSON.stringify(geometry))
        assert(!geometry.descendantOverflow, JSON.stringify(geometry))
        assert(contents.left >= box.left + box.border + box.padding - 1
          && contents.right <= box.right - box.border - box.padding + 1, JSON.stringify(geometry))
        assert(text.left >= contents.left && text.right <= contents.right + 1
          && text.top >= box.top + box.border + box.padding
          && text.bottom < geometry.bottom - box.border - box.padding, JSON.stringify(geometry))
        assert(!(await panel.innerText()).includes('·'))
        reports.push({ width, query, token, control, ...geometry })
      }
      if (query === null) await page.screenshot({ path: resolve(evidence, `panel-${width}.png`) })
      await button.press('Escape')
      const marks = await page.locator('.cahier-comparison-value__reference').allTextContents()
      assert(marks.every((text) => !/Médiane|Moyenne|·/.test(text)))
      const figureReferences = await page.locator('.cahier-network-bar-chart__reference-key, .cahier-figure-legend-item[aria-label^="Groupe comparé"]').evaluateAll((elements) =>
        elements.map((element) => ({ text: element.textContent.trim(), aria: element.getAttribute('aria-label'), title: element.getAttribute('title') })))
      assert(figureReferences.every((reference) => reference.text === 'Groupe comparé'
        && reference.aria?.startsWith('Groupe comparé : ') && !reference.title), JSON.stringify(figureReferences))
      const figureTitles = await page.locator('.evidence-figure [title], .map-breakout [title], .aedar-car-overview-scalars [title]').evaluateAll((elements) => elements.map((element) => element.getAttribute('title')))
      assert(figureTitles.every((title) => !/Rennes Métropole|Moyenne de|Médiane des/u.test(title)), JSON.stringify(figureTitles))
      await page.close()
    }
  }
  await writeFile(resolve(evidence, 'geometry.json'), JSON.stringify(reports, null, 2))
  console.log(JSON.stringify(reports.filter((report) => report.query === null), null, 2))
  console.log(`Self-check panneau/contenus : ${reports.length} contrôles verts ; preuves : ${evidence}`)
} finally {
  await browser.close()
}
