import { handlePublicationArtifacts, sendJson } from '../../../server/vercel-node.js'

export const config = { runtime: 'nodejs' }

export default async function publicationArtifactsRoute(req, res) {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname
  if (!/^\/api\/v1\/publications\/[^/]+\/artifacts\/?$/.test(pathname)) {
    return sendJson(res, 404, { error: 'Not found.' })
  }

  return handlePublicationArtifacts(req, res)
}
