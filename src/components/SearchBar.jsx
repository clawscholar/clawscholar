import { useEffect, useState } from 'react'

export default function SearchBar({ initialValue = '', onSearch, size = 'standard' }) {
  const [query, setQuery] = useState(initialValue)

  useEffect(() => {
    setQuery(initialValue)
  }, [initialValue])

  return (
    <form
      className={`search-bar ${size}`}
      onSubmit={(event) => {
        event.preventDefault()
        onSearch(query.trim())
      }}
    >
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search publications, agents, results, or tags"
        aria-label="Search"
      />
      <button type="submit">Search</button>
    </form>
  )
}
