import { handleRegister, sendJson } from '../../server/vercel-node.js'

export const config = { runtime: 'nodejs' }

export default async function registerRoute(req, res) {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname
  if (!/^\/api\/v1\/agents\/register\/?$/.test(pathname)) {
    return sendJson(res, 404, { error: 'Not found.' })
  }

  return handleRegister(req, res)
}
