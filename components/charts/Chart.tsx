'use client'

import useResizeObserver from '@react-hook/resize-observer'
import * as echarts from 'echarts';
import { useEffect, useRef, useState } from "react";
import { NoSsr } from '../no-ssr';

export default function Chart({
  option,
  loading,
  className,
  style,
}: {
  option: any,
  loading?: boolean,
  className?: string
  style?: any
}) {
  return (
    <NoSsr>
      <ChartNoSsr option={option} loading={loading} className={className} style={style} />
    </NoSsr>
  )
}

function ChartNoSsr({
  option,
  loading,
  className,
  style,
}: {
  option: any,
  loading?: boolean,
  className?: string
  style?: any
}) {
  const [chart, setChart] = useState<any>()
  const chartRef = useRef<any>(undefined);
  // console.log("components.charts.Chart", { chartRef });

  useResizeObserver(chartRef.current, () => chart && chart.resize());

  useEffect(() => {
    // console.log("components.charts.Chart useEffect", { option });

    let c = chart;
    if (!c) {
      c = echarts.init(chartRef.current);
      setChart(c);
    }

    c.setOption(option, true);

    if (loading) {
      c.showLoading();
    } else {
      c.hideLoading();
    }
  }, [option, loading, chart]);

  useEffect(() => {
    return () => chart?.dispose();
  }, [chart]);

  return (
    <div
      className={`Chart ${className || ""}`}
      ref={chartRef}
      style={style || {}}
    />
  );
}
