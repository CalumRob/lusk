/**
 * The ECharts seam for the story charts (issue #51).
 *
 * GraphiqueSoldes (Démographie) and GraphiqueDistributionMobilite import this
 * module with a dynamic import() so the whole ECharts tree (~212 kB gzip)
 * loads only when a chart mounts — the landing/shell bundle never pays for
 * it. The tree-shaken registration (core + the components both charts need +
 * the canvas renderer) lives here, next to the imports, so the components
 * stay thin consumers of a ready-made echarts.
 */
import { LineChart, ScatterChart } from 'echarts/charts'
import { GridComponent, MarkLineComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  LineChart,
  ScatterChart,
  GridComponent,
  MarkLineComponent,
  TooltipComponent,
  CanvasRenderer,
])

export { echarts }
