# Lahari Inference Cost Report

Generated: 2026-06-01T18:05:20.607Z

Range: 2026-04-01T00:00:00Z to 2026-07-01T00:00:00Z

Providers included: vertex, segmind, google

Source: Supabase `lahari_ai_calls.cost_estimate` joined with `lahari_projects.title`.

Note: this is the app-side inference ledger. Google/Segmind invoices can differ if provider-side billing includes retries, taxes, minimums, manual console calls, or calls outside this app.

Google billing CSV imported: /Users/ssaulgoodman/Downloads/My Billing Account_Reports, 2026-04-01 — 2026-06-30.csv

Invoice service totals:

- Gemini API: ₹43846.87
- Vertex AI: ₹10795.68
- Cloud Storage: ₹0.13

Reconciliation note: treat `google_billing_services.csv` as invoice truth. Treat Lahari `cost_estimate` as operational allocation; Gemini app estimates are known to undercount the attached Google bill.


## Totals

- segmind: 1230 calls, 229 errors, $1194.05
- vertex: 104 calls, 0 errors, $115.40
- google: 2355 calls, 12 errors, $90.11

## Model Totals

- segmind / seedance-2.0-fast: 682 calls, 58 errors, $1083.90
- segmind / veo-3.1-fast: 140 calls, 30 errors, $88.00
- vertex / vertex:veo-3.1-generate-001: 51 calls, 0 errors, $77.20
- google / gemini-3.1-flash-image-preview: 1166 calls, 4 errors, $46.48
- google / gemini-3-pro-image-preview: 1163 calls, 6 errors, $43.37
- vertex / vertex:veo-3.1-fast-generate-001: 53 calls, 0 errors, $38.20
- segmind / nano-banana-2: 281 calls, 31 errors, $7.75
- segmind / veo-3.1-fast-generate-preview: 8 calls, 0 errors, $6.40
- segmind / veo-3.0-fast-generate-001: 4 calls, 0 errors, $3.20
- segmind / veo-3.1-fast-generate-001: 4 calls, 0 errors, $3.20
- segmind / veo-3.1-generate-preview: 1 calls, 0 errors, $1.60
- google / gemini-3-pro-preview: 26 calls, 2 errors, $0.26
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
- `google_billing_services.csv`
- `provider_reconciliation.csv`
