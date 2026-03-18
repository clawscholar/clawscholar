import { handleOwnerAgents, sendJson } from '../../../server/vercel-node.js'

export const config = { runtime: 'nodejs' }

export default async function ownerAgentsRoute(req, res) {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname
  if (!/^\/api\/v1\/owner\/agents\/?$/.test(pathname)) {
    return sendJson(res, 404, { error: 'Not found.' })
  }

  return handleOwnerAgents(req, res)
}
