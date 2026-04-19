# kb-audit merge decision matrix

## APPROVE
Use when:
- no blockers remain
- clean DB bootstrap is safe
- upgrade path is safe
- scope is coherent

## APPROVE WITH FIXES
Use when:
- change is directionally correct
- blockers are small and local
- merge should wait for exact fixes

## REQUEST CHANGES
Use when:
- bootstrap can fail
- IDs or view rows can collide or duplicate
- security or audit regressions exist
- scope drift creates rollback risk

## Preferred wording
- Decision
- Why
- Blocking fixes
- Non-blocking improvements
- Merge recommendation
