# deploy-hardening

Non-negotiable deploy-time invariants, with recovery steps.

## `b24-catalog` (root)

- Deploys via Cloudflare native Git integration on push to `main`.
- `.github/workflows/deploy.yml` excludes `ai-kb/**` via `paths-ignore`, so changes inside `ai-kb/` do not trigger a root redeploy.
- Secrets (`ADMIN_TOKEN`, `ADMIN_UPLOAD_TOKEN`) are set via `wrangler secret put` against the root worker only.
- Smoke after deploy:
  ```bash
  curl -s https://b24-catalog.35ewerest.workers.dev/api/imports | head -c 300
  curl -s -X POST https://b24-catalog.35ewerest.workers.dev/api/backup \
       -H "X-Admin-Token: $ADMIN_TOKEN" | head -c 200
  ```

## `ai-kb`

- Deploys **only** via `.github/workflows/deploy-ai-kb.yml`. Native CF Git build must stay disabled.
- Workflow invariants:
  - `paths: [ai-kb/**]` trigger on push to `main`.
  - Cron `*/15 * * * *` self-heal.
  - Pre-flight token check: `GET https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/tokens/verify`. Account-scoped tokens fail the user-scoped endpoint (`/user/tokens/verify`) with `code 1000` even when valid — do not revert to the user endpoint.
  - `npm i -g wrangler@4.83.0`. Do not bump without a full smoke, several later minor versions have regressed on ai-kb.
  - `cd ai-kb && wrangler deploy`, then a verify-title-retry loop of up to 6 attempts with 30/60/90/120/150/180s backoff.
  - Smoke checks: `<title>Бот Эверест</title>` and `/api/health` containing `llama-3.3-70b`.

### Recovery: ai-kb regressed to the catalog HTML

Symptom: `curl https://ai-kb.35ewerest.workers.dev/` returns the b24-catalog HTML title, or `/api/health` 404s.

1. Check the CF dashboard: Workers & Pages → ai-kb → Settings → Build → **Git build must be disabled**. If enabled, disable it immediately.
2. If the dashboard re-enabled it, re-issue:
   ```bash
   curl -X DELETE \
     -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
     "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/services/ai-kb/environments/production/build-trigger"
   ```
   **WARNING:** on some versions this endpoint removes the whole ai-kb worker, not just the build trigger. If it does, `cd ai-kb && npx wrangler deploy` recreates it but you must re-put `ADMIN_TOKEN` via `wrangler secret put`.
3. Re-run the `deploy-ai-kb.yml` workflow from the Actions tab.

### Recovery: secret rotation

If `wrangler secret put ADMIN_TOKEN` fails with *"latest version isn't currently deployed"*:

```bash
echo "$NEW_TOKEN" | npx wrangler versions secret put ADMIN_TOKEN
npx wrangler versions deploy <version_id> -y
```

Then confirm:

```bash
# Should succeed
curl -s -H "X-Admin-Token: $NEW_TOKEN" https://ai-kb.35ewerest.workers.dev/api/settings | head -c 120
# Should 401
curl -s -H "X-Admin-Token: invalid"    https://ai-kb.35ewerest.workers.dev/api/settings | head -c 120
```

## Never allow

- Admin tokens stored client-side in `localStorage` (XSS blast radius) — both frontends use `sessionStorage`.
- Admin tokens written into HTML or GitHub Actions output (`::set-output`, `echo`ed values).
- Secrets committed to source or workflow files outside `${{ secrets.* }}` references.
- A single deploy workflow that targets both workers — the path filters isolate them and must stay.
