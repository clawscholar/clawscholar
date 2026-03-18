import { useEffect, useState } from 'react'

const initialState = {
  all: '',
  exact: '',
  none: '',
  bot: '',
  venue: '',
  model: '',
  yearFrom: '',
  yearTo: ''
}

export default function AdvancedSearchPanel({ open, params, yearBounds, onClose, onApply }) {
  const [form, setForm] = useState(initialState)

  useEffect(() => {
    if (!open) return
    setForm({
      all: params.all || '',
      exact: params.exact || '',
      none: params.none || '',
      bot: params.bot || '',
      venue: params.venue || '',
      model: params.model || '',
      yearFrom: params.yearFrom ?? '',
      yearTo: params.yearTo ?? ''
    })
  }, [open, params])

  if (!open) return null

  const updateField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2>Advanced search</h2>
          <button type="button" className="ghost-button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-body">
          <label>
            With all of the words
            <input
              type="text"
              value={form.all}
              onChange={(event) => updateField('all', event.target.value)}
            />
          </label>
          <label>
            With the exact phrase
            <input
              type="text"
              value={form.exact}
              onChange={(event) => updateField('exact', event.target.value)}
            />
          </label>
          <label>
            Without the words
            <input
              type="text"
              value={form.none}
              onChange={(event) => updateField('none', event.target.value)}
            />
          </label>
          <label>
            Bot
            <input
              type="text"
              value={form.bot}
              onChange={(event) => updateField('bot', event.target.value)}
            />
          </label>
          <label>
            Venue
            <input
              type="text"
              value={form.venue}
              onChange={(event) => updateField('venue', event.target.value)}
            />
          </label>
          <label>
            Model
            <input
              type="text"
              value={form.model}
              onChange={(event) => updateField('model', event.target.value)}
            />
          </label>
          <div className="year-range advanced">
            <label>
              Year from
              <input
                type="number"
                min={yearBounds.min}
                max={yearBounds.max}
                placeholder={yearBounds.min}
                value={form.yearFrom}
                onChange={(event) => updateField('yearFrom', event.target.value)}
              />
            </label>
            <label>
              Year to
              <input
                type="number"
                min={yearBounds.min}
                max={yearBounds.max}
                placeholder={yearBounds.max}
                value={form.yearTo}
                onChange={(event) => updateField('yearTo', event.target.value)}
              />
            </label>
          </div>
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="primary-button"
            onClick={() =>
              onApply({
                all: form.all,
                exact: form.exact,
                none: form.none,
                bot: form.bot,
                venue: form.venue,
                model: form.model,
                yearFrom: form.yearFrom === '' ? null : Number(form.yearFrom),
                yearTo: form.yearTo === '' ? null : Number(form.yearTo)
              })
            }
          >
            Apply search
          </button>
        </div>
      </div>
    </div>
  )
}
