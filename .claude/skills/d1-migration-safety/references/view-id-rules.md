# view id rules

## Never assume
- raw `id` from two source tables is globally unique
- promoted staging rows can safely coexist in the read view without duplicate prevention

## Prefer
- `uid = source || ':' || id` when ids can overlap
- `NOT EXISTS` against a stable business key to avoid duplicate logical rows
- explicit filtering so invalid or quarantined rows stay out of bot/search views
