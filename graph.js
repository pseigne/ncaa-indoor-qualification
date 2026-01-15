let chartInstance = null; // Store the chart globally so we can destroy it later

// --- Helper: Convert "4:01.20" to Seconds ---
function parseTime(timeStr) {
    let clean = timeStr.replace(/[#@]/g, '').trim(); // Remove symbols
    if (clean.includes(':')) {
        let parts = clean.split(':');
        return (parseFloat(parts[0]) * 60) + parseFloat(parts[1]);
    }
    return parseFloat(clean);
}

function formatSecondsToMinsSecs(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = (totalSeconds % 60).toFixed(2); // Keep 2 decimal places

    // Add leading zero if seconds is like 4.50 -> "04.50"
    const formattedSeconds = seconds < 10 ? '0' + seconds : seconds;

    return `${minutes}:${formattedSeconds}`;
}
// --- Fetch History & Prepare Data ---
async function loadHistoricalGraph(eventName, gender) {
    try {
        // 1. Get the list of all available dates
        const datesResponse = await fetch('data/dates.json');
        const dates = await datesResponse.json();

        // 2. Fetch every daily file in parallel
        const fetchPromises = dates.map(date =>
            fetch(`data/tfrrs_data (${date}).json`)
                .then(res => res.json())
                .then(dayData => {
                    // Find the specific event group (e.g. "Mile" and "Men")
                    // TFRRS titles have newlines, so we use .includes()
                    const eventGroup = dayData.find(e =>
                        e.event.includes(eventName) && e.event.includes(gender)
                    );

                    if (eventGroup) {
                        // Find the 16th ranked person
                        const cutoffEntry = eventGroup.rankings.find(r => r.rank === 16);
                        if (cutoffEntry) {
                            return {
                                date: date,
                                time: parseTime(cutoffEntry.time),
                                minutes: formatSecondsToMinsSecs(parseTime(cutoffEntry.time))
                            };
                        }
                    }
                    return null;
                })
        );

        // Wait for all files to load
        const results = await Promise.all(fetchPromises);

        // 3. Clean and Sort the data by date
        const cleanResults = results
            .filter(r => r !== null)
            .sort((a, b) => new Date(a.date) - new Date(b.date));

        // Extract arrays for Chart.js
        const chartLabels = cleanResults.map(r => r.date);
        const chartData = cleanResults.map(r => r.time);

        // 4. Draw the Chart
        renderChart(`${eventName} (${gender})`, chartLabels, chartData);

    } catch (error) {
        console.error("Graph Error:", error);
        // Optional: Hide chart if data missing
        if (chartInstance) chartInstance.destroy();
    }
}

// --- Draw the Chart ---
// --- Draw the Chart ---
function renderChart(label, dates, times) {
    const ctx = document.getElementById('cutoffChart').getContext('2d');

    if (chartInstance) chartInstance.destroy(); // Clear old chart

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dates,
            datasets: [{
                label: `16th Place Cutoff - ${label}`,
                data: times, // Data is still raw seconds (e.g. 241.5) so the line height is correct
                borderColor: '#003087',
                backgroundColor: 'rgba(0, 48, 135, 0.1)',
                borderWidth: 3,
                pointRadius: 5,
                fill: true,
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    title: { display: true, text: 'Time (MM:SS.ss)' }, // Updated title
                    ticks: {
                        // THIS is where we change the Y-axis labels
                        callback: function (value) {
                            return formatSecondsToMinsSecs(value);
                        }
                    }
                },
                x: {
                    type: 'time',
                    time: { unit: 'day' },
                    title: { display: true, text: 'Date' }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        // THIS makes the hover text show minutes
                        label: function (context) {
                            // context.raw is the raw seconds value
                            return `Cutoff: ${formatSecondsToMinsSecs(context.raw)}`;
                        }
                    }
                }
            }
        }
    });
}