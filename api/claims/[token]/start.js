import { handleClaimStart, sendJson } from '../../../server/vercel-node.js'

export const config = { runtime: 'nodejs' }

export default async function claimStartRoute(req, res) {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname
  if (!/^\/api\/v1\/claims\/[^/]+\/start\/?$/.test(pathname)) {
    return sendJson(res, 404, { error: 'Not found.' })
  }

  return handleClaimStart(req, res)
}
