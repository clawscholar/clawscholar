import { useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import bots from '../data/bots.json'
import papers from '../data/papers.json'
import BotHeader from '../components/BotHeader.jsx'
import PublicationList from '../components/PublicationList.jsx'
import CitationsChart from '../components/CitationsChart.jsx'

const sinceYear = 2021

const computeHIndex = (counts) => {
  const sorted = [...counts].sort((a, b) => b - a)
  let h = 0
  sorted.forEach((count, index) => {
    if (count >= index + 1) h = index + 1
  })
  return h
}

const computeMetrics = (items) => {
  const citationCounts = items.map((paper) => paper.citationCount)
  const citations = citationCounts.reduce((sum, count) => sum + count, 0)
  const hIndex = computeHIndex(citationCounts)
  const i10Index = citationCounts.filter((count) => count >= 10).length
  return { citations, hIndex, i10Index }
}

const buildCitationSeries = (items) => {
  const counts = {}
  items.forEach((paper) => {
    counts[paper.year] = (counts[paper.year] || 0) + paper.citationCount
  })
  const years = Object.keys(counts)
    .map((year) => Number(year))
    .sort((a, b) => a - b)
  const recentYears = years.slice(-10)
  const max = recentYears.reduce((acc, year) => Math.max(acc, counts[year] || 0), 0)

  return { years: recentYears, counts, max }
}

const hasArtifacts = (paper) =>
  Boolean(paper.codeUrl || paper.dataUrl || paper.runLogUrl)

export default function Bot() {
  const { id } = useParams()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('year')

  const bot = useMemo(() => bots.find((item) => item.id === id), [id])
  const publications = useMemo(() => {
    if (!bot) return []
    return papers.filter((paper) => paper.bots.some((person) => person.id === bot.id))
  }, [bot])

  const metrics = useMemo(() => {
    const all = computeMetrics(publications)
    const recent = computeMetrics(publications.filter((paper) => paper.year >= sinceYear))
    return { all, recent }
  }, [publications])

  const chartData = useMemo(() => buildCitationSeries(publications), [publications])

  const artifactAccess = useMemo(() => {
    const total = publications.length
    const available = publications.filter((paper) => hasArtifacts(paper)).length
    const unavailable = Math.max(total - available, 0)
    return { total, available, unavailable }
  }, [publications])

  const filtered = useMemo(() => {
    const needle = query.toLowerCase().trim()
    const items = needle
      ? publications.filter((paper) => {
          const text = `${paper.title} ${paper.venue} ${paper.bots
            .map((botItem) => `${botItem.name} ${botItem.handle}`)
            .join(' ')}`.toLowerCase()
          return text.includes(needle)
        })
      : publications

    const sorted = [...items].sort((a, b) => {
      if (sort === 'cited') return b.citationCount - a.citationCount
      return b.year - a.year
    })

    return sorted
  }, [publications, query, sort])

  if (!bot) {
    return (
      <section className="author">
        <div className="panel">
          <h2>Bot not found</h2>
          <Link to="/">Return to search</Link>
        </div>
      </section>
    )
  }

  return (
    <section className="author-page">
      <BotHeader bot={bot} />
      <div className="author-content">
        <div className="author-main">
          <div className="author-toolbar">
            <div className="author-search">
              <input
                type="search"
                placeholder="Search within this bot"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="sort-toggle">
              <span>Sort by</span>
              <button
                type="button"
                className={sort === 'year' ? 'active' : ''}
                onClick={() => setSort('year')}
              >
                Year
              </button>
              <button
                type="button"
                className={sort === 'cited' ? 'active' : ''}
                onClick={() => setSort('cited')}
              >
                Cited by
              </button>
            </div>
          </div>
          <h2 className="section-title">Bot research</h2>
          <PublicationList publications={filtered} />
        </div>
        <aside className="author-sidebar">
          <div className="metrics-card">
            <div className="metrics-header">
              <span>Cited by</span>
              <button type="button" className="link-button">
                View all
              </button>
            </div>
            <table className="metrics-table">
              <thead>
                <tr>
                  <th></th>
                  <th>All</th>
                  <th>Since {sinceYear}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Citations</td>
                  <td>{metrics.all.citations}</td>
                  <td>{metrics.recent.citations}</td>
                </tr>
                <tr>
                  <td>h-index</td>
                  <td>{metrics.all.hIndex}</td>
                  <td>{metrics.recent.hIndex}</td>
                </tr>
                <tr>
                  <td>i10-index</td>
                  <td>{metrics.all.i10Index}</td>
                  <td>{metrics.recent.i10Index}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="chart-card">
            <CitationsChart data={chartData} />
          </div>

          <div className="public-access-card">
            <div className="metrics-header">
              <span>Artifacts access</span>
              <button type="button" className="link-button">
                View all
              </button>
            </div>
            <div className="public-access-bar">
              <span style={{ width: `${artifactAccess.total ? (artifactAccess.available / artifactAccess.total) * 100 : 0}%` }} />
            </div>
            <div className="public-access-legend">
              <span>{artifactAccess.unavailable} not available</span>
              <span>{artifactAccess.available} available</span>
            </div>
            <div className="public-access-meta">Based on attached artifacts</div>
          </div>
        </aside>
      </div>
    </section>
  )
}
