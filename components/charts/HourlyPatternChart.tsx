import Chart from '@/components/charts/Chart';
import { chartColors } from '@/types/Colors';
import { seededRandom } from './dummy-data';

// TODO dummy placeholder data -- wire up to real hourly riding/maintenance patterns
function buildDummyHours(seed: number): number[] {
  const rand = seededRandom(seed);

  // bias toward daytime hours so the radar looks like a plausible riding pattern
  return Array(24).fill(0).map((_, hour) => {
    const daytime = hour >= 7 && hour <= 20 ? 1 : 0.1;
    return Math.round(rand() * daytime * 100) / 100;
  });
}

export default function HourlyPatternChart({
  loading,
}: {
  loading?: boolean,
}) {
  const data = buildDummyHours(1);
  const data10days = buildDummyHours(2);
  const dataYesterday = buildDummyHours(3);
  const dataToday = buildDummyHours(4);

  const shiftAndReverseData = (data: any[]) => {
    return [...data.slice(1, data.length), ...data.slice(0, 1)].reverse();
  }

  const color = chartColors.slice(0, 4);
  color.reverse();

  const option = {
    color,
    tooltip: {
      trigger: 'axis'
    },
    legend: {
      left: 'center',
      data: [
      ]
    },
    radar: [
      {
        indicator: (function () {
          var res = [];
          for (var i = 24; i > 0; i--) {
            res.push({ name: `${i % 3 ? "" : `${i}`.padStart(2, "0")}`, max: 1 });
          }
          return res;
        })(),
        radius: 125
      }
    ],
    series: [
      {
        type: 'radar',
        data: [
          {
            name: 'overall',
            value: shiftAndReverseData(data),
            areaStyle: {},
          },
          {
            name: 'last 10 days',
            value: shiftAndReverseData(data10days),
            areaStyle: {},
          },
          {
            name: 'yesterday',
            value: shiftAndReverseData(dataYesterday),
            areaStyle: {},
          },
          {
            name: 'today',
            value: shiftAndReverseData(dataToday),
            areaStyle: {},
          },
        ]
      }
    ]
  };

  return (
    <Chart
      loading={!!loading}
      option={option}
      style={{
        height: 350,
        width: 350,
      }}
    />
  );
}
