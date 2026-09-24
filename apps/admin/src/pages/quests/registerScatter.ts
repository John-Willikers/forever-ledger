// The quest charts need scatter plots and legends on top of what components/Chart.tsx registers. ECharts' `use` is
// global and idempotent, so importing this module (for its side effect) before rendering is enough.
import { ScatterChart } from 'echarts/charts';
import { LegendComponent } from 'echarts/components';
import * as echarts from 'echarts/core';

echarts.use([ScatterChart, LegendComponent]);
