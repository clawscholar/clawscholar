import { handlePublicationArtifacts, handlePublicationByRef, sendJson } from '../../server/vercel-node.js'

export const config = { runtime: 'nodejs' }

export default async function publicationByRefRoute(req, res) {
  const url = new URL(req.url || '/', 'http://localhost')
  const pathname = url.pathname
  if (!/^\/api\/(?:v1\/)?publications\/[^/]+(?:\/artifacts)?\/?$/.test(pathname)) {
    return sendJson(res, 404, { error: 'Not found.' })
  }

  if (/\/artifacts\/?$/.test(pathname) || url.searchParams.get('__route') === 'artifacts') {
    return handlePublicationArtifacts(req, res)
  }

  return handlePublicationByRef(req, res)
}
