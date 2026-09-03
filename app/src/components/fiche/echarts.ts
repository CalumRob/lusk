/**
 * The ECharts seam for the story charts (issue #51).
 *
 * GraphiqueSoldes (Démographie) and GraphiqueDistributionMobilite import this
 * module with a dynamic import() so the whole ECharts tree (~212 kB gzip)
 * loads only when a chart mounts — the landing/shell bundle never pays for
 * it. The tree-shaken registration (core + the components both charts need +
 * the canvas and SVG renderers) lives here, next to the imports, so the components
 * stay thin consumers of a ready-made echarts.
 */
import { BarChart, LineChart, ScatterChart } from 'echarts/charts'
import { AxisPointerComponent, GridComponent, MarkLineComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers'

echarts.use([
  LineChart,
  ScatterChart,
  BarChart,
  GridComponent,
  MarkLineComponent,
  TooltipComponent,
  AxisPointerComponent,
  CanvasRenderer,
  SVGRenderer,
])

export { echarts }
