import Chart from '@/components/charts/Chart';
import { chartColors } from '@/types/Colors';

// TODO dummy placeholder data -- wire up to real per-vehicle distance/usage reports
const data = {
  today: 42,
  yesterday: 87,
  last10days: 63,
  overall: 58,
};

export default function DailyGauge({
  loading,
}: {
  loading?: boolean,
}) {
  const maxData = Math.max(...Object.values(data));

  const gaugeData = [
    {
      value: data.overall,
      name: 'Historical',
      title: {
        offsetCenter: ['0%', '-52%']
      },
      detail: {
        valueAnimation: true,
        offsetCenter: ['0%', '-40%']
      }
    },
    {
      value: data.last10days,
      name: 'Prev 10 days',
      title: {
        offsetCenter: ['0%', '-24%']
      },
      detail: {
        valueAnimation: true,
        offsetCenter: ['0%', '-11%']
      }
    },
    {
      value: data.yesterday,
      name: 'Yesterday',
      title: {
        offsetCenter: ['0%', '4%']
      },
      detail: {
        valueAnimation: true,
        offsetCenter: ['0%', '17%']
      }
    },
    {
      value: data.today,
      name: 'Today',
      title: {
        offsetCenter: ['0%', '32%']
      },
      detail: {
        valueAnimation: true,
        offsetCenter: ['0%', '45%']
      }
    }
  ];

  const color = chartColors.slice(0, 4);
  color.reverse();

  const option = {
    color,
    series: [
      {
        type: 'gauge',
        startAngle: 90,
        endAngle: -270,
        max: maxData + 1,
        pointer: {
          show: false
        },
        progress: {
          show: true,
          overlap: false,
          roundCap: true,
          clip: false,
          itemStyle: {
            borderWidth: 1,
            borderColor: '#464646'
          }
        },
        axisLine: {
          lineStyle: {
            width: 50
          }
        },
        splitLine: {
          show: false,
          distance: 0,
          length: 10
        },
        axisTick: {
          show: false
        },
        axisLabel: {
          show: false,
          distance: 50
        },
        data: gaugeData,
        title: {
          fontSize: 12
        },
        detail: {
          width: 50,
          height: 8,
          fontSize: 11,
          color: 'inherit',
          borderColor: 'inherit',
          borderRadius: 20,
          borderWidth: 1,
          formatter: '{value}'
        }
      }
    ]
  };

  return (
    <Chart
      loading={!!loading}
      option={option}
      style={{
        height: 350,
        width: 350
      }}
    />
  );
}
