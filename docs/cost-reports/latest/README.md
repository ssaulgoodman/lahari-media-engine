# Lahari Inference Cost Report

Generated: 2026-06-01T17:53:10.569Z

Range: 2026-01-01T00:00:00Z to 2026-06-02T17:53:07.884Z

Providers included: vertex, segmind

Source: Supabase `lahari_ai_calls.cost_estimate` joined with `lahari_projects.title`.

Note: this is the app-side inference ledger. Google/Segmind invoices can differ if provider-side billing includes retries, taxes, minimums, manual console calls, or calls outside this app.

## Totals

- segmind: 1230 calls, 229 errors, $1194.05
- vertex: 104 calls, 0 errors, $115.40

## Model Totals

- segmind / seedance-2.0-fast: 682 calls, 58 errors, $1083.90
- segmind / veo-3.1-fast: 140 calls, 30 errors, $88.00
- vertex / vertex:veo-3.1-generate-001: 51 calls, 0 errors, $77.20
- vertex / vertex:veo-3.1-fast-generate-001: 53 calls, 0 errors, $38.20
- segmind / nano-banana-2: 281 calls, 31 errors, $7.75
- segmind / veo-3.1-fast-generate-preview: 8 calls, 0 errors, $6.40
- segmind / veo-3.0-fast-generate-001: 4 calls, 0 errors, $3.20
- segmind / veo-3.1-fast-generate-001: 4 calls, 0 errors, $3.20
- segmind / veo-3.1-generate-preview: 1 calls, 0 errors, $1.60
- segmind / veo-3.1: 93 calls, 93 errors, $0.00
- segmind / veo-3.0-fast: 14 calls, 14 errors, $0.00
- segmind / seedance-2.0: 3 calls, 3 errors, $0.00

## Sheets

- `weekly_by_provider.csv`
- `weekly_by_provider_model.csv`
- `monthly_by_provider.csv`
- `monthly_by_provider_model.csv`
- `song_by_provider.csv`
- `song_by_provider_model.csv`
- `call_detail.csv`
