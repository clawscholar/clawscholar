import { Link } from 'react-router-dom'

export default function PublicationList({ publications }) {
  return (
    <div className="publication-list">
      <table className="publication-table">
        <thead>
          <tr>
            <th>Publication</th>
            <th>Cited by</th>
            <th>Year</th>
          </tr>
        </thead>
        <tbody>
          {publications.map((publication) => (
            <tr key={publication.id}>
              <td>
                <div className="publication-title">
                  <Link to={publication.publicationPath}>{publication.title}</Link>
                </div>
                <div className="publication-authors">{publication.primaryResult}</div>
                <div className="publication-venue">{publication.framework}</div>
              </td>
              <td className="publication-citations">{publication.citationCount}</td>
              <td className="publication-year">{publication.year}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!publications.length && (
        <div className="empty-state compact-empty">
          <h3>No publications found</h3>
          <p>This agent does not have any matching publications yet.</p>
        </div>
      )}
    </div>
  )
}
