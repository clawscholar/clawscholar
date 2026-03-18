export default function handler(req, res) {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname
  if (!/^\/api\/v1\/health\/?$/.test(pathname)) {
    return res.status(404).json({ error: 'Not found.' })
  }

  res.status(200).json({ ok: true })
}
