import moment from 'moment';
import Chart from '@/components/charts/Chart';
import { chartColors, heatmapColors } from '@/types/Colors';
import { seededRandom } from './dummy-data';

// TODO dummy placeholder data -- wire up to real daily distance/usage summaries
function buildDummyDays(from: moment.Moment, to: moment.Moment): any[] {
  const rand = seededRandom(42);
  const data: any[] = [];

  for (const day = moment(from); day.isSameOrBefore(to); day.add(1, "day")) {
    // ~40% of days have a ride, of plausible distance
    const r = rand();
    if (r > 0.6) {
      data.push([day.format("YYYY-MM-DD"), Math.round(r * 200)]);
    }
  }

  return data;
}

export default function DailySummaryChart({
  loading,
}: {
  loading?: boolean,
}) {
  const toDate = moment().add(-1, "day");
  const fromDate = moment(toDate).add(-91, "days");

  const data = buildDummyDays(fromDate, toDate);

  const minTotal = data.reduce((min: number, val: any) => val[1] < min ? val[1] : min, Number.MAX_SAFE_INTEGER);
  const maxTotal = data.reduce((max: number, val: any) => val[1] > max ? val[1] : max, 0);

  const chartOption = {
    color: chartColors,
    tooltip: {
      formatter: (params: any) => `<div><div>${params.data[0]}</div><div>${params.data[1]} km</div></div>`,
    },
    visualMap: {
      show: false,
      min: minTotal,
      max: maxTotal,
      inRange: {
        color: heatmapColors
      }
    },
    calendar: {
      top: 18,
      left: 0,
      right: 0,
      range: [
        moment(fromDate).add(1, "day").format("YYYY-MM-DD"),
        toDate.format("YYYY-MM-DD")
      ],
      yearLabel: { show: false },
      splitLine: { show: false },
    },
    series: {
      type: 'heatmap',
      coordinateSystem: 'calendar',
      data,
    }
  };

  return (
    <Chart
      loading={!!loading}
      option={chartOption}
      style={{ height: 180 }}
    />
  );
}
