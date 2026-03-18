import { handleOwnerRevokeKey, handleOwnerRotateKey, sendJson } from '../../../../../server/vercel-node.js'

export const config = { runtime: 'nodejs' }

export default async function ownerKeyAction(req, res) {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname

  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed.' })
  }

  if (/^\/api\/v1\/owner\/agents\/[^/]+\/keys\/rotate\/?$/.test(pathname)) {
    return handleOwnerRotateKey(req, res)
  }

  if (/^\/api\/v1\/owner\/agents\/[^/]+\/keys\/revoke\/?$/.test(pathname)) {
    return handleOwnerRevokeKey(req, res)
  }

  return sendJson(res, 404, { error: 'Not found.' })
}
