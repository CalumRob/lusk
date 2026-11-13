// THROWAWAY — reads Vue's dev runtime, not a proposed production API.
// Facts/content come from the existing API-backed Cahier and its resolved props.
import { formatServedRank } from '@/fiche/figureGrammaire'
import { AEDAR_RAMP_MODE_LABELS } from '@/fiche/content/aedarTimeRampFacts'
import { AEDAR_TIME_MODE_COLORS } from '../aedarTimeModeColors'

export function instances() {
  const root = document.querySelector('.cahier')?.__vueParentComponent
  const result = root ? [root] : []
  function visit(node) {
    if (!node || typeof node !== 'object') return
    if (node.component) { result.push(node.component); visit(node.component.subTree) }
    else if (Array.isArray(node.children)) node.children.forEach(visit)
  }
  if (root) visit(root.subTree)
  return result
}
const named = name => instances().filter(instance => instance.type.__name === name)
export function ready() {
  const root = instances()[0]
  const explorer = named('AedarEquipmentExplorerCahier')[0]
  const maps = [...document.querySelectorAll('#figure-lecture .map-viewport img')]
  return root?.props?.comparisonStatus === 'ready'
    && root.props.content.units[0].sections.every(section => section.availability === 'complete')
    && explorer?.setupState.detailStatus === 'ready' && explorer.setupState.comparisonStatus === 'ready'
    && named('CahierBlankMapSlots')[0]?.setupState.legendStatus === 'ready'
    && maps.length === 5 && maps.every(image => image.complete && image.naturalWidth > 0)
}
function palette() {
  const css = getComputedStyle(document.documentElement)
  return Object.fromEntries(['paper', 'ink', 'muted', 'margin'].map(key => [key, css.getPropertyValue(`--editorial-${key}`).trim()]))
}
function rgba(value) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.fillStyle = value; context.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
  return { hex: `#${[r, g, b].map(part => part.toString(16).padStart(2, '0')).join('')}`, alpha: a / 255 }
}
function modeColours() {
  const root = document.querySelector('.cahier')
  return Object.fromEntries(Object.entries(AEDAR_TIME_MODE_COLORS).map(([mode, value]) => {
    const span = document.createElement('span'); span.style.color = value; root.appendChild(span)
    const color = rgba(getComputedStyle(span).color).hex
    span.remove(); return [mode, color]
  }))
}
function svgFromPlot(source) {
  const clone = source.cloneNode(true)
  const copies = [clone, ...clone.querySelectorAll('*')]
  ;[source, ...source.querySelectorAll('*')].forEach((element, index) => {
    const style = getComputedStyle(element)
    const copy = copies[index]
    for (const property of ['fill', 'stroke']) {
      const value = style.getPropertyValue(property)
      if (value === 'none') copy.setAttribute(property, 'none')
      else {
        const color = rgba(value)
        copy.setAttribute(property, color.hex)
        copy.setAttribute(`${property}-opacity`, String(color.alpha * Number(style.getPropertyValue(`${property}-opacity`) || 1)))
      }
    }
    for (const property of ['stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity']) {
      const value = style.getPropertyValue(property)
      if (value && value !== 'none') copy.setAttribute(property, value.replaceAll('px', ''))
    }
    copy.removeAttribute('class'); copy.removeAttribute('style')
  })
  const rect = source.getBoundingClientRect()
  const view = source.viewBox.baseVal
  // Axes are HTML in the actual Cahier renderer. Preserve their placement;
  // do not derive any axis/domain/value in the PDF adapter.
  source.closest('.cahier-figure-plot').querySelectorAll('.cahier-figure-tick-label').forEach(label => {
    const box = label.getBoundingClientRect()
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    node.setAttribute('x', String((box.x + box.width / 2 - rect.x) * view.width / rect.width))
    node.setAttribute('y', String((box.y + box.height * .8 - rect.y) * view.height / rect.height))
    node.setAttribute('font-family', 'Roboto'); node.setAttribute('font-size', '12')
    node.setAttribute('text-anchor', 'middle'); node.setAttribute('fill', palette().muted)
    node.textContent = label.textContent
    clone.appendChild(node)
  })
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(view.width)); clone.setAttribute('height', String(view.height))
  return new XMLSerializer().serializeToString(clone)
}
function waffleVector() {
  const tiles = [...document.querySelectorAll('#figure-lecture .aedar-waffle-tile')]
  const count = 24, cell = 17, gap = 3
  const rects = tiles.map((tile, index) => `<rect x="${index % count * (cell + gap)}" y="${Math.floor(index / count) * (cell + gap)}" width="${cell}" height="${cell}" fill="${rgba(getComputedStyle(tile).backgroundColor).hex}"/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="${Math.ceil(tiles.length / count) * (cell + gap)}">${rects}</svg>`
}

async function mapPng(image) {
  // pdfmake accepts PNG/JPEG, not the page's WebP assets. Decode the exact
  // displayed resource in the reader's browser, retaining its native 900px.
  const response = await fetch(image.src)
  if (!response.ok) throw new Error(`Carte indisponible : ${image.src}`)
  const bitmap = await createImageBitmap(await response.blob())
  const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
  const context = canvas.getContext('2d')
  context.beginPath(); context.arc(canvas.width / 2, canvas.height / 2, canvas.width / 2, 0, 2 * Math.PI); context.clip()
  context.drawImage(bitmap, 0, 0); bitmap.close()
  return canvas.toDataURL('image/png')
}
const num = value => value === null || value === undefined ? 'Indisponible' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)

export async function exportRennes() {
  const exportStart = performance.now()
  if (!ready()) throw new Error('La page ou sa comparaison ne sont pas entièrement prêtes.')
  await document.fonts.ready
  const root = instances()[0]
  const explorer = named('AedarEquipmentExplorerCahier')[0]
  const waffle = named('AedarEquipmentWaffleCahier')[0]
  const ramps = named('AccessRampFigureCahier')
  const quantile = named('AedarEquipmentQuantileFigureCahier')[0]
  const chapter = root.props.content.units[0]
  // Capture all resolved semantics and local UI selections synchronously before
  // any asset/import await. Subsequent selection changes cannot mutate this PDF.
  const snapshot = JSON.parse(JSON.stringify({
    territory: root.props.content.territory, theme: root.props.content.label, chapter,
    sources: root.props.content.sourceRegister.filter(source => chapter.sections.some(section => section.provenance.includes(source.id))),
    comparison: root.setupState.controleComparaison,
    status: root.props.comparisonStatus,
    // The root's model starts null: each child has an effective local default.
    // Capture the effective rendered value, never label the PDF "null minutes".
    horizon: explorer.setupState.horizonMinutes,
    profileHorizon: waffle.setupState.horizonMinutes,
    palette: palette(), modeColours: modeColours(),
    selectedModes: root.setupState.aedarAccessSelectedModes,
    comparisonVisible: root.setupState.aedarAccessComparisonVisible,
    carLegend: named('CahierBlankMapSlots')[0].setupState.carMapLegend,
    profile: waffle.setupState.profile,
    explorer: { typequ: explorer.setupState.selectedTypequ, label: explorer.setupState.selectedTypeFigureLabel,
      fact: explorer.setupState.selectedFact, comparison: explorer.setupState.activeComparison,
      volumeRamp: explorer.setupState.volumeRamp, distribution: quantile.setupState.figure,
      detailStatus: explorer.setupState.detailStatus, comparisonStatus: explorer.setupState.comparisonStatus },
    rampFigures: ramps.map(instance => ({ data: instance.props.timeRamp,
      yTitle: instance.props.timeRamp.yAxis.label, xTitle: instance.props.timeRamp.xAxis.label })),
    exportedAt: new Date().toISOString(),
    pageUrl: window.location.href,
  }))
  const chapterElement = document.querySelector('#figure-lecture')
  const imageElements = [...chapterElement.querySelectorAll('.map-viewport img')]
  const vectors = [...chapterElement.querySelectorAll('.cahier-figure-plot > svg')].map(svgFromPlot)
  const waffleSvg = waffleVector()
  const imageUrls = imageElements.map(image => image.src)
  const pngs = await Promise.all(imageElements.map(mapPng))
  snapshot.mapAssets = imageUrls
  const [{ default: pdfMake }, { default: fonts }] = await Promise.all([import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts')])
  pdfMake.addVirtualFileSystem(fonts)
  const start = performance.now()
  const definition = buildPdf(snapshot, { vectors, waffleSvg, pngs })
  const blob = await pdfMake.createPdf(definition).getBlob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a'); link.href = url; link.download = 'rennes-equipements-epci.pdf'; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
  window.rennesPdfSnapshot = snapshot
  window.rennesPdfReceipt = { bytes: blob.size, generationMs: performance.now() - start, totalExportMs: performance.now() - exportStart, vectors: vectors.length, maps: pngs.length }
  return window.rennesPdfReceipt
}

function buildPdf(snapshot, assets) {
  const p = snapshot.palette
  const section = key => snapshot.chapter.sections.find(item => item.key === key)
  const overview = section('aedar-car-overview').evidence
  const loss = section('aedar-diversity-loss').evidence
  const access = section('aedar-access').evidence
  const profile = section('aedar-equipment-profile').evidence
  const explorer = section('aedar-equipment-explorer').evidence
  const title = (text, pageBreak = true) => ({ text, fontSize: 20, bold: true, margin: [0, 0, 0, 14], ...(pageBreak ? { pageBreak: 'before' } : {}) })
  const heading = text => ({ text, fontSize: 12, bold: true, margin: [0, 10, 0, 8] })
  const note = text => ({ text, fontSize: 8, color: p.muted, margin: [0, 5, 0, 9], lineHeight: 1.2 })
  const prose = blocks => (blocks ?? []).map(block => ({ text: block.map(segment => ({ text: segment.value, bold: segment.kind.includes('emphasis'), ...(segment.kind === 'link' ? { link: segment.href, decoration: 'underline' } : {}) })), fontSize: 9.5, lineHeight: 1.25, margin: [0, 0, 0, 9] }))
  const table = (headers, rows, widths) => ({ table: { headerRows: 1, widths: widths ?? headers.map(() => '*'), body: [headers.map(text => ({ text, bold: true })), ...rows] }, layout: 'lightHorizontalLines', fontSize: 9, margin: [0, 8, 0, 10] })
  const legend = (legend, width = 450) => !legend ? note('Légende indisponible — aucune échelle inventée.') : ({ stack: [
    ...(legend.title ? [note(legend.title)] : []),
    { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="25">${legend.colors.map((color, index) => `<rect x="${index * width / legend.colors.length}" y="0" width="${width / legend.colors.length}" height="8" fill="${color}"/>`).join('')}${legend.tickLabels.map((label, index) => `<text x="${index * width / (legend.tickLabels.length - 1)}" y="22" font-family="Roboto" font-size="8" text-anchor="${index === 0 ? 'start' : index === legend.tickLabels.length - 1 ? 'end' : 'middle'}" fill="${p.muted}">${label.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</text>`).join('')}</svg>`, width },
    ...(legend.note ? [note(legend.note)] : []),
  ], margin: [0, 7, 0, 8] })
  const activeModes = snapshot.selectedModes.map(mode => AEDAR_RAMP_MODE_LABELS[mode]).join(' · ')
  const chartLegend = () => ({ stack: [
    { text: snapshot.selectedModes.flatMap((mode, index) => [{ text: `${index ? '   ' : ''}■ `, color: snapshot.modeColours[mode] }, { text: AEDAR_RAMP_MODE_LABELS[mode], color: p.ink }]), fontSize: 8, margin: [0, 4, 0, 4] },
    note(`Traits pleins : ${snapshot.territory.name}. Pointillés / barres pâles : ${overview.comparisonLabel}.`),
  ] })
  const chart = (index, yTitle, width = 450) => [note(yTitle), { svg: assets.vectors[index], width, margin: [0, 0, 0, 0] }]
  const body = [
    note('ESSAI D’EXPORT PDF · DONNÉES RÉELLES · MAQUETTE NON VALIDÉE'),
    title(`${snapshot.territory.name}\n${snapshot.chapter.label}`, false),
    ...prose(snapshot.chapter.introduction),
    heading(section('aedar-car-overview').label),
    heading(overview.scalarFigureTitle),
    table(['Mesure', 'Rennes', 'Groupe comparé', 'Rang'], overview.scalars.map(scalar => [
      `${scalar.label}\n${scalar.unit}`, num(scalar.value), num(scalar.reference?.value),
      formatServedRank({ position: scalar.rank, size: scalar.rankSize, ties: scalar.rankTies }) ?? '—',
    ]), ['*', 70, 80, 43]),
    note(overview.comparisonLabel),
    title(overview.mapFigureTitle.map(segment => segment.value).join('')),
    { image: assets.pngs[0], width: 280, alignment: 'center', margin: [0, 0, 0, 4] },
    legend(snapshot.carLegend),
    ...prose(overview.prose),
    title(section('aedar-diversity-loss').label),
    ...prose(loss.introduction),
    ...[0, 2].map(start => ({ columns: loss.maps.slice(start, start + 2).map((map, offset) => ({ stack: [
      { text: map.label, bold: true, fontSize: 10, margin: [0, 0, 0, 4] },
      { image: assets.pngs[start + offset + 1], width: 175 },
    ] })), columnGap: 16, margin: [0, 4, 0, 9] })),
    legend(loss.legend),
    note('La lecture des modes et les précautions de comparaison sont reprises en fin de document.'),
    title(section('aedar-access').label),
    ...prose(access.sectionProse),
    ...access.ramps.flatMap((ramp, index) => [heading(ramp.figureTitle), ...chart(index, ramp.yAxis.label, 420)]),
    chartLegend(),
    title(section('aedar-equipment-profile').label),
    heading(`${profile.figureTitle} · ${snapshot.profileHorizon} minutes`),
    { svg: assets.waffleSvg, width: 450, margin: [0, 8, 0, 12] },
    table(['Premier mode d’accès', 'Types d’équipements'], snapshot.profile.buckets.map(bucket => [bucket.label, String(bucket.count)])),
    ...prose(profile.prose),
    note(`Horizon capturé : ${snapshot.profileHorizon} minutes. Seuil : ${new Intl.NumberFormat('fr-FR', { style: 'percent' }).format(profile.threshold)} des adresses. Les fenêtres de détail fermées ne sont pas exportées. La sélection de cases s’effectue sur le site.`),
    title(section('aedar-equipment-explorer').label),
    ...prose(explorer.introduction),
    heading(`${snapshot.explorer.label} · ${snapshot.explorer.typequ}`),
    heading(explorer.volumeFigureTitle),
    ...chart(2, explorer.volumeYAxisTitle),
    chartLegend(),
    note(`Équipement et modes capturés depuis l’état du lecteur, pas réinitialisés par le PDF. Horizon de la distribution : ${snapshot.horizon} minutes.`),
    title(`${explorer.distributionFigureTitle}\n${snapshot.explorer.label}`),
    note(`${snapshot.horizon} minutes · ${explorer.distributionDescription}`),
    ...chart(3, explorer.distributionYAxisTitle),
    chartLegend(),
    table(['Statistique', ...snapshot.selectedModes.map(mode => AEDAR_RAMP_MODE_LABELS[mode])], snapshot.explorer.distribution.categories.map((category, index) => [category.label, ...snapshot.selectedModes.map(mode => num(snapshot.explorer.distribution.series.find(series => series.key === mode)?.values[index]))])),
    note(`Les valeurs du tableau sont celles de Rennes. Les références du groupe comparé sont représentées par les barres pâles, comme sur la page.`),
    title('Sources et état de l’export'),
    ...snapshot.sources.flatMap(source => [heading(source.source), note(`Version : ${source.version} · Date d’observation : ${source.referenceDate ?? 'non précisée'} · Publication : ${source.publicationDate ?? 'non précisée'}`)]),
    ...[overview.source, access.source].filter(Boolean).flatMap(source => [{ text: `${source.label} · ${source.version}`, link: source.url, fontSize: 10, margin: [0, 8, 0, 3] }, note(source.credit ?? '')]),
    note(`Capture : ${snapshot.exportedAt}\nTerritoire : ${snapshot.territory.type}/${snapshot.territory.code}\nComparaison : ${overview.comparisonLabel}\nÉquipement : ${snapshot.explorer.typequ} · Horizon : ${snapshot.horizon} minutes\nModes affichés : ${activeModes}`),
    note(`Identité des faits AEDAR : ${explorer.contentVersion}\nRéférence territoriale : ${explorer.referenceContentVersion}`),
    heading('Lire les cartes et comparer les modes'),
    ...loss.comparisonGroups.flatMap(group => prose(group.prompt)),
    heading('Limites de cette maquette'),
    note('Typographie PDF provisoire (Roboto). Mise en page distincte de l’écran, débuts de sujets explicites. Cartes WebP converties en PNG à leur résolution native ; les courbes, barres et tuiles restent vectorielles. Infobulles et dialogues fermés exclus. Les cartes sont celles de Rennes, pas des cartes de différence avec l’EPCI. Les références de comparaison ne sont pas recalculées par l’exporteur.'),
  ]
  return {
    pageSize: 'A4', pageMargins: [60, 82, 60, 83], defaultStyle: { font: 'Roboto', fontSize: 9.5, color: p.ink },
    info: { title: `Rennes — ${snapshot.chapter.label} — comparaison EPCI`, author: 'Lusk · prototype PDF', subject: overview.comparisonLabel },
    background: (_page, size) => ({ canvas: [{ type: 'rect', x: 0, y: 0, w: size.width, h: size.height, color: p.paper }, { type: 'line', x1: 42, y1: 78, x2: 42, y2: size.height - 76, lineColor: p.margin, lineWidth: .7 }] }),
    header: { margin: [60, 25, 60, 0], stack: [{ columns: [{ text: 'Lusk', fontSize: 18, bold: true }, { text: `${snapshot.territory.name} · ${snapshot.theme}`, fontSize: 9, alignment: 'right', margin: [0, 7, 0, 0] }] }, { text: snapshot.chapter.label, fontSize: 8, color: p.muted, margin: [0, 5, 0, 0] }] },
    footer: (page, total) => ({ margin: [60, 10, 60, 0], stack: [
      { text: overview.comparisonLabel, fontSize: 8, margin: [0, 0, 0, 5] },
      { columns: [{ text: `ESSAI PDF · ${snapshot.exportedAt.slice(0, 10)} · Équipement : ${snapshot.explorer.typequ} · ${snapshot.horizon} min`, fontSize: 7, color: p.muted }, { text: `${page} / ${total}`, alignment: 'right', fontSize: 8, color: p.margin }] },
    ] }),
    content: body,
  }
}
