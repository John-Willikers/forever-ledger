// The extra ECharts pieces the Dungeons pages draw with (scatter dots, a legend), registered on the shared core
// instance that components/Chart.tsx renders with. Import for its side effect.
import { ScatterChart } from 'echarts/charts';
import { LegendComponent } from 'echarts/components';
import * as echarts from 'echarts/core';

echarts.use([ScatterChart, LegendComponent]);
