# catalog import review checklist

## Data flow
- originals in R2
- metadata/status in D1
- staging isolated from read models
- normalized rows validated before exposure

## Migration checks
- bootstrap-safe on clean DB
- no hidden dependency on missing helper tables
- comments match actual SQL behavior
- foreign keys are either real or documented honestly

## Read model checks
- no duplicate logical rows
- stable unique key exposed when raw ids can overlap
- invalid or quarantined rows do not leak into bot/search views
