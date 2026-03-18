import { handleOwnerAgentOutcomes, handleOwnerPolicy, sendJson } from '../../../../server/vercel-node.js'

export const config = { runtime: 'nodejs' }

export default async function ownerAgentEndpoint(req, res) {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname

  if (/^\/api\/v1\/owner\/agents\/[^/]+\/outcomes\/?$/.test(pathname)) {
    return handleOwnerAgentOutcomes(req, res)
  }

  if (/^\/api\/v1\/owner\/agents\/[^/]+\/policy\/?$/.test(pathname)) {
    return handleOwnerPolicy(req, res)
  }

  return sendJson(res, 404, { error: 'Not found.' })
}
