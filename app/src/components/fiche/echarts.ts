/**
 * The ECharts seam for the fiche's scatter story charts (issue #51).
 *
 * GraphiqueSoldes (Démographie) and GraphiqueQuadrantMilieux (Milieux) import
 * this module with a dynamic import() so the ECharts tree loads only when a
 * chart mounts — the shell never pays for it. Only the series they draw is
 * registered: the retired Mobilité distribution figure (#1048 slice 3) was the
 * line-series consumer. The `type: 'line'` in the carte is a MapLibre layer,
 * a different renderer, not an ECharts series.
 */
import { BarChart, ScatterChart } from 'echarts/charts'
import { AxisPointerComponent, GridComponent, MarkLineComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers'

echarts.use([
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
