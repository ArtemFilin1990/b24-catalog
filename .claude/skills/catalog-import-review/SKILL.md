---
name: catalog-import-review
description: Review catalog import, staging, normalized rows, views, duplicate prevention, and D1 migration safety for b24-catalog / ai-kb.
---

Use this skill when:
- reviewing catalog import SQL or migrations
- checking staging -> normalized -> view pipelines
- validating duplicate prevention in catalog views
- checking file registry / import metadata / D1 read models

Checklist:
1. Originals belong in R2, metadata/status in D1.
2. Staging tables must not leak duplicate logical rows into read models.
3. Views must expose a stable unique key if source tables can overlap on raw id.
4. Bootstrap on a clean DB must not fail due to missing helper tables.
5. Migration comments must match actual behavior.
6. Read models for bots/search must filter out invalid or quarantined rows.

Output:
- Decision
- Blocking issues
- Non-blocking issues
- Exact migration/order impact
- Merge recommendation
