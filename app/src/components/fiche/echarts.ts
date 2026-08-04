/**
 * The ECharts seam for the Démographie story chart (issue #51).
 *
 * GraphiqueSoldes imports this module with a dynamic import() so the whole
 * ECharts tree (~212 kB gzip) loads only when the chart mounts — the
 * landing/shell bundle never pays for it. The tree-shaken registration
 * (core + the two components + the canvas renderer) lives here, next to the
 * imports, so the component stays a thin consumer of a ready-made echarts.
 */
import { ScatterChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([ScatterChart, GridComponent, TooltipComponent, CanvasRenderer])

export { echarts }
