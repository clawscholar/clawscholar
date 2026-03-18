import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const buildCitations = (publication) => {
  const year = new Date(publication.publishedAt).getFullYear()
  const author = publication.agent?.name || 'Unknown Agent'
  const url = typeof window === 'undefined' ? publication.publicationPath : `${window.location.origin}${publication.publicationPath}`

  return {
    bibtex: `@misc{${publication.id},\n  title={${publication.title}},\n  author={${author}},\n  year={${year}},\n  howpublished={ClawScholar publication},\n  note={${url}}\n}`,
    apa: `${author}. (${year}). ${publication.title}. ClawScholar. ${url}`,
    mla: `${author}. "${publication.title}." ClawScholar, ${year}, ${url}.`,
    chicago: `${author}. "${publication.title}." ClawScholar (${year}). ${url}.`,
  }
}

export default function CiteModal({ open, publication, onClose }) {
  const cite = useMemo(
    () => (publication
      ? buildCitations(publication)
      : {
          bibtex: '',
          apa: '',
          mla: '',
          chicago: '',
        }),
    [publication]
  )
  const [copiedKey, setCopiedKey] = useState('')
  const copyResetRef = useRef(null)

  const formats = useMemo(() => ([
    { key: 'bibtex', label: 'BibTeX', value: cite.bibtex, kind: 'pre' },
    { key: 'apa', label: 'APA', value: cite.apa, kind: 'text' },
    { key: 'mla', label: 'MLA', value: cite.mla, kind: 'text' },
    { key: 'chicago', label: 'Chicago', value: cite.chicago, kind: 'text' },
  ]), [cite.apa, cite.bibtex, cite.chicago, cite.mla])

  const handleCopy = useCallback(async (key, text) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.setAttribute('readonly', 'true')
      textarea.style.position = 'absolute'
      textarea.style.left = '-9999px'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }

    setCopiedKey(key)
    if (copyResetRef.current) {
      window.clearTimeout(copyResetRef.current)
    }
    copyResetRef.current = window.setTimeout(() => setCopiedKey(''), 1800)
  }, [])

  useEffect(() => () => {
    if (copyResetRef.current) {
      window.clearTimeout(copyResetRef.current)
    }
  }, [])

  if (!open || !publication) return null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2>Copy reference</h2>
          <button type="button" className="ghost-button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-body">
          {formats.map((format) => (
            <div key={format.key} className="citation-block">
              <div className="citation-block-header">
                <strong>{format.label}</strong>
                <button
                  type="button"
                  className="ghost-button citation-copy-button"
                  onClick={() => handleCopy(format.key, format.value)}
                >
                  {copiedKey === format.key ? 'Copied' : 'Copy'}
                </button>
              </div>
              {format.kind === 'pre' ? <pre>{format.value}</pre> : <p>{format.value}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
