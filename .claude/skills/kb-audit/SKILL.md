---
name: kb-audit
description: Review pull requests, D1 migrations, Cloudflare worker changes, scope drift, bootstrap safety, and merge risk in b24-catalog / ai-kb.
---

Use this skill when:
- reviewing pull requests
- checking migration safety on clean and existing D1 databases
- checking scope drift, duplicate logical rows, ID collisions, vector ID collisions, schema drift
- deciding APPROVE / APPROVE WITH FIXES / REQUEST CHANGES

Workflow:
1. Identify exact scope of the change.
2. Check bootstrap safety on a clean DB.
3. Check upgrade safety on an existing DB.
4. Look for duplicate logical rows, ID collisions, vector ID collisions, misleading comments, and hidden rollback risk.
5. Return decision first, then blockers, then non-blockers, then merge strategy.

Project rules:
- Keep PR scope narrow.
- Prefer cherry-pick over wide merge when scope drifts.
- Do not invent runtime behavior.
- Use repository files and confirmed behavior as source of truth.

References:
- references/review-checklist.md
- references/merge-decision-matrix.md

Scripts:
- scripts/review_pr.sh
