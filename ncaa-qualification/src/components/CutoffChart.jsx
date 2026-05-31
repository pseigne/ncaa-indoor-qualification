import React, { useEffect, useRef } from 'react';
import { Chart, registerables } from 'chart.js';
import { formatSecondsToMinsSecs } from '../utils/helpers';

Chart.register(...registerables);

function CutoffChart({ historicalData, selectedEvent, gender, loadingGraph, cutoffRank, isArchive = false }) {
  const canvasRef = useRef(null);
  const chartInstanceRef = useRef(null);

  useEffect(() => {
    if (!historicalData || historicalData.length === 0 || !canvasRef.current) {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
      return;
    }

    const ctx = canvasRef.current.getContext('2d');
    const chartLabels = historicalData.map(r => {
      const match = r.date.match(/\((.*?)\)/);
      if (match) {
        // Just extract MM-DD or show it clean
        return match[1];
      }
      return r.date.replace(/_/g, '-');
    });
    const chartPoints = historicalData.map(r => r.time);

    if (chartInstanceRef.current) {
      chartInstanceRef.current.destroy();
    }

    const primaryColor = '#3f8cfb';
    const areaColor = 'rgba(63, 140, 251, 0.08)';

    chartInstanceRef.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels: chartLabels,
        datasets: [{
          label: `${cutoffRank}th Place Cutoff - ${selectedEvent} (${gender === 'm' ? 'Men' : 'Women'})`,
          data: chartPoints,
          borderColor: primaryColor,
          backgroundColor: areaColor,
          borderWidth: 3,
          pointRadius: 6,
          pointBackgroundColor: primaryColor,
          pointHoverRadius: 8,
          fill: true,
          tension: 0.15
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            title: { display: true, text: 'Time (MM:SS.ss)', font: { weight: 'bold' } },
            ticks: {
              callback: function (value) {
                return formatSecondsToMinsSecs(value);
              }
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.05)'
            }
          },
          x: {
            type: 'category',
            title: { display: true, text: isArchive ? 'Year' : 'Date', font: { weight: 'bold' } },
            grid: {
              display: false
            }
          }
        },
        plugins: {
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.9)',
            titleColor: '#fff',
            bodyColor: '#fff',
            padding: 12,
            cornerRadius: 8,
            callbacks: {
              label: function (context) {
                return ` Cutoff Time: ${formatSecondsToMinsSecs(context.raw)}`;
              }
            }
          }
        }
      }
    });

    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
    };
  }, [historicalData, selectedEvent, gender, cutoffRank, isArchive]);

  const titleText = isArchive
    ? `${cutoffRank}th Place Historical Cutoffs`
    : `${cutoffRank}th Place Daily Cutoff Progression`;

  const descText = isArchive
    ? `Historical final cutoff times for the top-${cutoffRank} qualifiers in the ${selectedEvent} (${gender === 'm' ? 'Men' : 'Women'}) across previous years`
    : `Real-time progression of the top-${cutoffRank} qualifying bubble over the course of the active season`;

  return (
    <section className="chart-section">
      <div className="chart-header">
        <h2>{titleText}</h2>
        <span className="chart-desc">
          {descText}
        </span>
      </div>
      <div className="chart-wrapper">
        {loadingGraph ? (
          <div className="graph-loader">
            <div className="spinner"></div>
            <span>Recalculating bubble entries...</span>
          </div>
        ) : historicalData && historicalData.length > 0 ? (
          <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }}></canvas>
        ) : (
          <div className="graph-placeholder">
            <p>No progression data found for this selection.</p>
          </div>
        )}
      </div>
    </section>
  );
}

export default CutoffChart;
