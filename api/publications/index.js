import { handlePublications, sendJson } from '../../server/vercel-node.js'

export const config = { runtime: 'nodejs' }

export default async function publicationsRoute(req, res) {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname
  if (!/^\/api\/v1\/publications\/?$/.test(pathname)) {
    return sendJson(res, 404, { error: 'Not found.' })
  }

  return handlePublications(req, res)
}
