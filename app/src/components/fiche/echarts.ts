/**
 * The ECharts seam for the story charts (issue #51).
 *
 * GraphiqueSoldes (Démographie), GraphiqueQuadrantMilieux and the line/scatter
 * figures import this module with a dynamic import() so the whole ECharts tree
 * loads only when a chart mounts — the landing/shell bundle never pays for it.
 * The tree-shaken registration lives here, next to the imports, so the
 * components stay thin consumers of a ready-made echarts. The retired Mobilité
 * snapshot figure (#1048 slice 3) no longer consumes this seam.
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
