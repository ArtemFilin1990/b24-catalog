# cloudflare worker review checklist

## Security
- no hardcoded secrets
- admin and upload scopes are narrow and explicit
- privileged routes require auth
- privileged actions write to audit log

## Bindings
- D1 / R2 / Vectorize / AI bindings match wrangler.toml
- route code matches actual bindings and names
- no invented Cloudflare APIs

## Deploy flow
- root worker deploy cannot overwrite ai-kb
- ai-kb workflow retry/self-heal remains intact
- smoke checks verify the correct worker content after deploy

## Output
- decision first
- blockers
- non-blockers
- exact merge recommendation
