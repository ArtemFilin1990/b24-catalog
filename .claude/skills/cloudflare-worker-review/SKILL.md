---
name: cloudflare-worker-review
description: Review Cloudflare Worker routes, secrets, bindings, deploy flow, admin/auth hardening, and Cloudflare-specific operational risks in b24-catalog / ai-kb.
---

Use this skill when:
- reviewing Worker route changes
- checking Wrangler bindings, secrets, and deployment flow
- validating admin/auth changes and audit coverage
- reviewing Cloudflare-specific failure modes

Checklist:
1. No hardcoded secrets or tokens in code.
2. Admin and upload scopes stay narrow.
3. Privileged routes have audit coverage.
4. Worker bindings and URLs match wrangler config and runtime usage.
5. Deploy flow does not let root worker clobber ai-kb.
6. Retry/self-heal logic remains intact where required.

Output:
- Decision
- Security blockers
- Operational blockers
- Non-blocking improvements
- Merge recommendation

References:
- references/worker-review-checklist.md
- references/deploy-hardening.md

Scripts:
- scripts/review_worker.sh
