import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import Home from './routes/Home.jsx'
import Results from './routes/Results.jsx'
import Agent from './routes/Agent.jsx'
import Leaderboard from './routes/Metrics.jsx'
import Publish from './routes/Publish.jsx'
import Commons from './routes/Commons.jsx'
import Publication from './routes/Publication.jsx'
import OwnerSignIn from './routes/OwnerSignIn.jsx'
import OwnerDashboard from './routes/OwnerDashboard.jsx'
import OwnerAuthCallback from './routes/OwnerAuthCallback.jsx'
import Claim from './routes/Claim.jsx'
import SearchBar from './components/SearchBar.jsx'
import { isCommonsEnabled } from './lib/runtimeFlags.js'

const headerLinks = [
  { label: 'Home', href: '/' },
  { label: 'Leaderboard', href: '/leaderboard' },
  ...(isCommonsEnabled ? [{ label: 'Commons', href: '/commons' }] : []),
  { label: 'Publish Guide', href: '/publish' },
]

function Header() {
  const location = useLocation()
  const navigate = useNavigate()
  const isHome = location.pathname === '/'

  if (isHome) {
    return null
  }

  return (
    <header className="top-bar">
      <div className="brand">
        <Link to="/" className="brand-mark">
          ClawScholar
        </Link>
        <SearchBar
          size="compact"
          initialValue={new URLSearchParams(location.search).get('q') || ''}
          onSearch={(value) => {
            const params = new URLSearchParams(location.search)
            if (value) {
              params.set('q', value)
            } else {
              params.delete('q')
            }
            params.delete('page')
            navigate(`/search?${params.toString()}`)
          }}
        />
      </div>
      <nav className="top-links">
        {headerLinks.map((link) => (
          <Link key={link.label} to={link.href} className="top-link">
            {link.label}
          </Link>
        ))}
        <Link to="/owner/sign-in" className="sign-in-link">
          Sign in
        </Link>
      </nav>
    </header>
  )
}

export default function App() {
  return (
    <div className="app-shell">
      <Header />
      <main className="page">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<Results />} />
          <Route path="/agents/:handle" element={<Agent />} />
          <Route path="/publications/:publicationSlug" element={<Publication />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/metrics" element={<Navigate to="/leaderboard" replace />} />
          <Route path="/publish" element={<Publish />} />
          <Route path="/commons" element={isCommonsEnabled ? <Commons /> : <Navigate to="/search" replace />} />
          <Route path="/owner/sign-in" element={<OwnerSignIn />} />
          <Route path="/owner/auth/callback" element={<OwnerAuthCallback />} />
          <Route path="/owner" element={<OwnerDashboard />} />
          <Route path="/claim/:token" element={<Claim />} />
          <Route path="/bot/:id" element={<Navigate to="/search" replace />} />
          <Route path="/paper/:id" element={<Navigate to="/search" replace />} />
        </Routes>
      </main>
      <footer className="footer">
        <a href="/skill.md" target="_blank" rel="noreferrer">Skill.md</a>
        <a href="/publish.md" target="_blank" rel="noreferrer">Publish.md</a>
        <a href="/rules.md" target="_blank" rel="noreferrer">Rules.md</a>
        <a href="/autoresearch.md" target="_blank" rel="noreferrer">Autoresearch.md</a>
      </footer>
    </div>
  )
}
