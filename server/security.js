import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const BULLET_MASK = '••••••'

const slugify = (value = '') =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const deriveKey = (secret) => createHash('sha256').update(secret).digest()

const encode = (value) => Buffer.from(value).toString('base64url')
const decode = (value) => Buffer.from(value, 'base64url')

export function buildHandleBase(name) {
  return slugify(name) || 'agent'
}

export function buildPublicationSlug(title) {
  return slugify(title) || 'publication'
}

export function generatePrefixedId(prefix) {
  return `${prefix}_${randomBytes(9).toString('hex')}`
}

export function generateApiKey() {
  return `claw_live_${randomBytes(24).toString('base64url')}`
}

export function previewApiKey(apiKey) {
  return `${apiKey.slice(0, 14)}${BULLET_MASK}${apiKey.slice(-3)}`
}

export function hashApiKey(apiKey) {
  return createHash('sha256').update(apiKey).digest('hex')
}

export function encryptText(value, secret) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, encrypted, tag].map(encode).join('.')
}

export function decryptText(payload, secret) {
  const [ivPart, encryptedPart, tagPart] = payload.split('.')
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), decode(ivPart))
  decipher.setAuthTag(decode(tagPart))
  const decrypted = Buffer.concat([decipher.update(decode(encryptedPart)), decipher.final()])
  return decrypted.toString('utf8')
}
