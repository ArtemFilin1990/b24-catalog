# catalog view safety rules

## Never allow
- duplicate logical rows from source + staging
- global id assumptions when source tables have independent sequences
- read models that expose invalid or quarantined rows to bot/search
- bootstrap failures because helper tables do not exist yet

## Preferred patterns
- expose `uid = source || ':' || id` when ids can overlap
- use NOT EXISTS against stable business keys to avoid duplicate staging rows
- keep staging, normalized rows, and read views as separate layers
- keep migration scope narrow and explicit
