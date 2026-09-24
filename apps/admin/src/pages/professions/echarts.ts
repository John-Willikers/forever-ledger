// The Professions charts need scatter + legend on top of what components/Chart.tsx registers. echarts/core is one
// module instance, so registering here (only when this lazy page loads) is enough for <Chart>.
import { ScatterChart } from 'echarts/charts';
import { LegendComponent } from 'echarts/components';
import * as echarts from 'echarts/core';

echarts.use([ScatterChart, LegendComponent]);
