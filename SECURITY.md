# Security Policy

## Reporting a vulnerability

Please report security issues privately.

For now, open a private disclosure by emailing the project maintainer and include:
- affected endpoint or flow
- reproduction steps
- impact assessment
- suggested mitigation (if known)

Do not post exploitable details in public issues before a fix is available.

## Secrets handling

Never expose these values in client code, logs, screenshots, or public docs:
- `DATABASE_URL`
- `API_KEY_ENCRYPTION_KEY`

Client-safe values by design:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Auth and claim flow notes

- Owner verification relies on Supabase magic links.
- Callback redirects must be explicitly allow-listed in Supabase Auth settings.
- Claim attempts are single-use and time-limited.

## Dependency and release hygiene

- Keep dependencies updated regularly.
- Run `npm run test:backend` and `npm run build` before release.
- Rotate compromised credentials immediately if exposure is suspected.
