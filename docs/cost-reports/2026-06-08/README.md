# Lahari Inference Cost Report

Generated: 2026-06-08T03:42:09.934Z

Range: 2026-01-01T00:00:00Z to 2026-06-09T03:42:05.690Z

Providers included: vertex, segmind

Source: Supabase `lahari_ai_calls.cost_estimate` joined with `lahari_projects.title`.

Note: this is the app-side inference ledger. Google/Segmind invoices can differ if provider-side billing includes retries, taxes, minimums, manual console calls, or calls outside this app.


## Totals

- segmind: 2404 calls, 268 errors, $2164.18
- vertex: 104 calls, 0 errors, $115.40

## Model Totals

- segmind / seedance-2.0-fast: 1206 calls, 93 errors, $2033.20
- segmind / veo-3.1-fast: 140 calls, 30 errors, $88.00
- vertex / vertex:veo-3.1-generate-001: 51 calls, 0 errors, $77.20
- vertex / vertex:veo-3.1-fast-generate-001: 53 calls, 0 errors, $38.20
- segmind / nano-banana-2: 930 calls, 34 errors, $28.58
- segmind / veo-3.1-fast-generate-preview: 8 calls, 0 errors, $6.40
- segmind / veo-3.0-fast-generate-001: 4 calls, 0 errors, $3.20
- segmind / veo-3.1-fast-generate-001: 4 calls, 0 errors, $3.20
- segmind / veo-3.1-generate-preview: 1 calls, 0 errors, $1.60
- segmind / veo-3.1: 93 calls, 93 errors, $0.00
- segmind / veo-3.0-fast: 14 calls, 14 errors, $0.00
- segmind / seedance-2.0: 4 calls, 4 errors, $0.00

## Sheets

- `weekly_by_provider.csv`
- `weekly_by_provider_model.csv`
- `monthly_by_provider.csv`
- `monthly_by_provider_model.csv`
- `song_by_provider.csv`
- `song_by_provider_model.csv`
- `call_detail.csv`

