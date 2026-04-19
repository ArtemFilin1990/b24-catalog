---
name: d1-migration-safety
description: Review D1 migration bootstrap safety, upgrade safety, helper-table dependencies, duplicate rows, ID collisions, and clean-db behavior in b24-catalog / ai-kb.
---

Use this skill when:
- reviewing D1 migrations
- checking bootstrap on a clean database
- checking upgrade path on an existing database
- validating views, helper tables, unique ids, and read-model safety

Checklist:
1. Clean DB bootstrap must succeed.
2. Existing DB upgrade must remain safe and idempotent where intended.
3. Helper tables must exist before writes reference them.
4. Views must not duplicate logical rows.
5. Raw IDs must not be treated as globally unique if source tables overlap.
6. Comments must describe actual SQL behavior.

Output:
- Decision
- Bootstrap blockers
- Upgrade blockers
- Non-blocking improvements
- Recommended migration order

References:
- references/bootstrap-safety.md
- references/view-id-rules.md

Scripts:
- scripts/check_migration.sh
