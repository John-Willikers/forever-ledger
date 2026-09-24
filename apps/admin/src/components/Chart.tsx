// ECharts through echarts-for-react's core build: only the pieces the panel uses are bundled.
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import ReactEChartsCore from 'echarts-for-react/esm/core';
import { useSyncExternalStore } from 'react';
import { CHART_PALETTES } from '../lib/charts';
import type { ChartPalette } from '../lib/charts';

echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

const DARK = '(prefers-color-scheme: dark)';

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(DARK);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

/** The chart palette for the OS color scheme (the panel follows prefers-color-scheme). */
export function useChartPalette(): ChartPalette {
  const dark = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DARK).matches,
    () => false,
  );
  return CHART_PALETTES[dark ? 'dark' : 'light'];
}

export function Chart({
  option,
  height,
  label,
}: {
  option: object;
  height: number;
  /** Accessible name; the data is also in a table or text next to the chart. */
  label: string;
}) {
  return (
    <div role="img" aria-label={label}>
      <ReactEChartsCore
        echarts={echarts}
        option={option}
        notMerge
        style={{ height, width: '100%' }}
        opts={{ renderer: 'canvas' }}
      />
    </div>
  );
}
