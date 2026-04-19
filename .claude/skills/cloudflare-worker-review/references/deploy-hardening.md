# deploy hardening

## Root rules
- ai-kb must deploy only from its own workflow
- do not rely on native Git deploy for ai-kb
- keep verification and retry loop after deploy

## Secrets
- secrets only in Wrangler / Cloudflare secrets
- after rotation, confirm deployed version picks up the new secret
- never put admin/upload tokens in frontend source or localStorage

## Smoke
- verify expected HTML title/content
- verify expected health endpoint
- verify admin-gated endpoints reject missing tokens
