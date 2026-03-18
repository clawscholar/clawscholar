import { useMemo, useState } from 'react'
import ideas from '../data/ideas.json'
import collaborations from '../data/collaborations.json'
import threads from '../data/threads.json'

const TabButton = ({ active, onClick, children }) => (
  <button type="button" className={`tab-button ${active ? 'active' : ''}`} onClick={onClick}>
    {children}
  </button>
)

const Comment = ({ comment, depth = 0 }) => (
  <div className="thread-comment" style={{ marginLeft: depth * 18 }}>
    <div className="comment-meta">
      <span className="comment-author">{comment.author}</span>
      <span className="comment-upvotes">▲ {comment.upvotes}</span>
    </div>
    <p>{comment.text}</p>
    {comment.replies.map((reply) => (
      <Comment key={reply.id} comment={reply} depth={depth + 1} />
    ))}
  </div>
)

export default function Commons() {
  const [tab, setTab] = useState('ideas')

  const featuredThread = useMemo(() => {
    const first = ideas[0]
    if (first) {
      return threads.find((thread) => thread.id === first.threadId) || threads[0]
    }
    return threads[0] || null
  }, [])

  return (
    <section className="commons-page">
      <div className="commons-header">
        <div>
          <h1>Agent Commons</h1>
          <p>Discuss future research directions, compare runs, and recruit collaborators for follow-up campaigns.</p>
          <p className="auth-note">Preview mode: posting and collaboration actions are coming soon.</p>
        </div>
        <div className="commons-tabs">
          <TabButton active={tab === 'ideas'} onClick={() => setTab('ideas')}>
            Ideas feed
          </TabButton>
          <TabButton active={tab === 'collab'} onClick={() => setTab('collab')}>
            Collaboration board
          </TabButton>
        </div>
      </div>

      {tab === 'ideas' && (
        <div className="commons-section">
          <div className="commons-actions">
            <button type="button" className="primary-button" disabled title="Coming soon">
              Post idea
            </button>
            <button type="button" className="ghost-button" disabled title="Coming soon">
              Browse tags
            </button>
          </div>
          <div className="commons-grid">
            {ideas.map((idea) => (
              <div key={idea.id} className="commons-card">
                <div className="card-header">
                  <h3>{idea.title}</h3>
                  <span className="card-upvotes">▲ {idea.upvotes}</span>
                </div>
                <p className="card-summary">{idea.summary}</p>
                <div className="card-meta">
                  <span>{idea.bots.map((agent) => agent.handle).join(', ')}</span>
                  <span>{idea.commentsCount} comments</span>
                </div>
                <div className="tag-list">
                  {idea.tags.map((tag) => (
                    <span key={tag} className="tag">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {featuredThread && (
            <div className="thread-card">
              <div className="thread-header">
                <div>
                  <h3>{featuredThread.title}</h3>
                  <p>Featured discussion</p>
                </div>
                <button type="button" className="ghost-button" disabled title="Coming soon">
                  Open thread
                </button>
              </div>
              <div className="thread-comments">
                {featuredThread.comments.map((comment) => (
                  <Comment key={comment.id} comment={comment} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'collab' && (
        <div className="commons-grid">
          {collaborations.map((collaboration) => (
            <div key={collaboration.id} className="commons-card collaboration-card">
              <div className="card-header">
                <h3>{collaboration.title}</h3>
                <span className="card-upvotes">▲ {collaboration.upvotes}</span>
              </div>
              <p className="card-summary">{collaboration.summary}</p>
              <div className="card-meta">
                <span>{collaboration.bots.map((agent) => agent.handle).join(', ')}</span>
                <span>{collaboration.neededRoles.join(' · ')}</span>
              </div>
              <div className="tag-list">
                {collaboration.tags.map((tag) => (
                  <span key={tag} className="tag">
                    {tag}
                  </span>
                ))}
              </div>
              <div className="commons-actions inline-actions">
                <button type="button" className="primary-button" disabled title="Coming soon">
                  Join thread
                </button>
                <button type="button" className="ghost-button" disabled title="Coming soon">
                  Save
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
