export default function CitationsChart({ data }) {
  if (!data || data.years.length === 0) {
    return null
  }

  if (data.max === 0) {
    const columnStyle = { '--year-count': data.years.length }
    return (
      <div className="citations-chart">
        <div className="chart-header">
          <span>Citations per year</span>
        </div>
        <div className="chart-zero-state">
          <p>No citations yet</p>
          <div className="chart-zero-baseline" />
          <div className="chart-year-row" style={columnStyle}>
            {data.years.map((year) => (
              <span key={`label-${year}`} className="bar-label">{year}</span>
            ))}
          </div>
        </div>
      </div>
    )
  }

  const buildTicks = (maxValue) => {
    if (maxValue <= 4) {
      return Array.from({ length: maxValue + 1 }, (_, index) => maxValue - index)
    }
    return [maxValue, Math.round(maxValue * 0.75), Math.round(maxValue * 0.5), Math.round(maxValue * 0.25), 0]
  }

  const ticks = buildTicks(data.max)
  const maxTick = ticks[0] || 0
  const columnStyle = { '--year-count': data.years.length }
  const tickRows = ticks.map((tick, index) => {
    const top = maxTick <= 0 ? 100 : 100 - (tick / maxTick) * 100
    const align = index === 0 ? 'top' : index === ticks.length - 1 ? 'bottom' : 'middle'
    return { tick, top, align }
  })

  return (
    <div className="citations-chart">
      <div className="chart-header">
        <span>Citations per year</span>
      </div>
      <div className="chart-body">
        <div className="chart-plot-shell">
          <div className="chart-plot-area">
            <div className="chart-grid-lines">
              {tickRows.map(({ tick, top }) => (
                <span key={`line-${tick}`} className="chart-grid-line" style={{ top: `${top}%` }} />
              ))}
            </div>
            <div className="chart-bars" style={columnStyle}>
              {data.years.map((year) => {
                const value = data.counts[year] || 0
                const height = maxTick <= 0 ? 0 : Math.max(4, (value / maxTick) * 100)
                return (
                  <div key={year} className="chart-bar">
                    <div className="bar" style={{ height: `${height}%` }} />
                  </div>
                )
              })}
            </div>
          </div>
          <div className="chart-year-row" style={columnStyle}>
            {data.years.map((year) => (
              <span key={`label-${year}`} className="bar-label">{year}</span>
            ))}
          </div>
        </div>
        <div className="chart-axis">
          {tickRows.map(({ tick, top, align }) => (
            <span
              key={tick}
              className={`chart-axis-tick chart-axis-tick-${align}`}
              style={{ top: `${top}%` }}
            >
              {tick}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
