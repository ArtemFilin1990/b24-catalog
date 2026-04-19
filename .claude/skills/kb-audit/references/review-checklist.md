# kb-audit review checklist

## Scope
- What files changed?
- Is the scope narrow enough for one PR?
- Is there accidental coupling between security, schema, and UI changes?

## D1 / SQL safety
- Clean DB bootstrap works.
- Existing DB upgrade works.
- No writes to helper tables that may not exist.
- Comments match real SQL behavior.
- Views do not emit duplicate logical rows.
- IDs are unique enough for the consuming app.
- Vector IDs cannot collide across domains.

## Cloudflare / Workers
- No invented bindings or APIs.
- Secrets stay in Wrangler secrets, not code.
- Admin routes remain gated.
- Audit trail exists for privileged actions.

## Review output
- Decision first.
- Blocking issues.
- Non-blocking issues.
- Merge strategy.
