import { handleAgentMe, sendJson } from '../../server/vercel-node.js'

export const config = { runtime: 'nodejs' }

export default async function agentMeRoute(req, res) {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname
  if (!/^\/api\/v1\/agents\/me\/?$/.test(pathname)) {
    return sendJson(res, 404, { error: 'Not found.' })
  }

  return handleAgentMe(req, res)
}
