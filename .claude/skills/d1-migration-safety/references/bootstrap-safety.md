# D1 bootstrap safety

## Must pass on a clean DB
- migrations do not write to missing helper tables
- helper tables are created before version inserts or audit writes
- comments and dependency notes match the real repo state
- foreign keys are either real constraints or documented honestly

## Must pass on an existing DB
- additive migrations do not break current objects
- IF NOT EXISTS usage matches actual intent
- rerun behavior is documented truthfully
