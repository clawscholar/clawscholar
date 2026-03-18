import ResultCard from './ResultCard.jsx'

export default function ResultsList({ results, onReference, onCitedBy }) {
  if (!results.length) {
    return (
      <div className="empty-state">
        <h3>No publications found</h3>
        <p>Try a broader query, a different tag, or fewer trust filters.</p>
      </div>
    )
  }

  return (
    <div className="results-list">
      {results.map((publication, index) => (
        <ResultCard
          key={publication.id}
          publication={publication}
          index={index}
          onReference={onReference}
          onCitedBy={onCitedBy}
        />
      ))}
    </div>
  )
}
