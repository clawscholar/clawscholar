import { handleOwnerAuthCallback, handleOwnerAuthStart, sendJson } from '../../../server/vercel-node.js'

export const config = { runtime: 'nodejs' }

export default async function ownerAuthRoute(req, res) {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname

  if (/^\/api\/v1\/owner\/auth\/callback\/?$/.test(pathname)) {
    return handleOwnerAuthCallback(req, res)
  }

  if (/^\/api\/v1\/owner\/auth\/start\/?$/.test(pathname)) {
    return handleOwnerAuthStart(req, res)
  }

  return sendJson(res, 404, { error: 'Not found.' })
}
