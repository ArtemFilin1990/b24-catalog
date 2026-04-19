---
name: bearing-analog-check
description: Validate bearing analogs, type matching, series logic, geometry safety, and NO DIRECT EQUIV decisions for Everest bearing tasks.
---

Use this skill when:
- checking bearing analog proposals
- reviewing type/series classification logic
- validating that replacements preserve bearing type and geometry
- reviewing bot answers about bearing analogs

Rules:
- Exact type match is mandatory.
- Exact geometry match is mandatory for a direct equivalent.
- If direct equivalence is not confirmed, return NO DIRECT EQUIV.
- Do not map a ball bearing to a roller bearing or vice versa even if dimensions look similar.
- Keep confirmed facts separate from assumptions.

Review output:
1. Decision
2. What is confirmed
3. What is not confirmed
4. Risks of a wrong substitute
5. Safe recommendation
