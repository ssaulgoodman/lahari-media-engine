# Video Model Comparison — 720p, No Audio, Image-to-Video

**Status:** Provider reference. Update when model defaults, provider routing, or pricing/quality conclusions change.

All pricing verified for 720p, audio OFF where the provider supports it. Per-second rates derived from per-generation prices where needed (cost / duration).

## All models, all providers — sorted cheapest first

| # | Model | Provider | $/sec | $/min | Audio-off pricing |
|---|-------|----------|-------|-------|-------------------|
| 1 | Runway Gen-4 Turbo | Runway API | $0.05 | $3.00 | Flat (no discount) |
| 2 | Kling 3.0 Standard | Kling native | $0.084 | $5.04 | Yes (0.6 vs 0.9 credits/s) |
| 3 | Kling 3.0 Standard | fal.ai | $0.084 | $5.04 | Yes ($0.126 with audio) |
| 4 | Veo 3.1 Fast | Vertex AI | $0.08 | $4.80 | Yes (explicit tier) |
| 5 | Wan 2.2 A14B | fal.ai | $0.08 | $4.80 | Flat (no discount) |
| 6 | Veo 3.1 Fast | Segmind | $0.10 | $6.00 | Yes ($0.40/4s off, $0.60/4s on) |
| 7 | Veo 3.1 Fast | fal.ai | $0.10 | $6.00 | Yes (explicit tier) |
| 8 | Runway Gen-4 Turbo | Segmind | $0.10 | $6.00 | Flat ($0.50/5s, $1.00/10s) |
| 9 | Wan 2.7 | Together AI | $0.10 | $6.00 | Unverified |
| 10 | Kling 3.0 Pro | Kling native | $0.112 | $6.72 | Yes (0.8 vs 1.2 credits/s) |
| 11 | Kling 3.0 Pro | fal.ai | $0.112 | $6.72 | Yes ($0.168 with audio) |
| 12 | Runway Gen-4 | Runway API | $0.12 | $7.20 | Flat (no discount) |
| 13 | Kling 3.0 Standard | Segmind | $0.124 | $7.44 | Flat ($1.24/10s avg) |
| 14 | Wan 2.7 | Segmind | $0.14 | $8.40 | Flat ($0.70/5s avg) |
| 15 | Seedance 2.0 Fast | BytePlus | ~$0.146 | ~$8.76 | Unverified |
| 16 | Seedance 2.0 Fast | Segmind | $0.146 | $8.76 | Free audio (no extra cost) |
| 17 | Seedance 2.0 | BytePlus | ~$0.18 | ~$10.80 | Unverified |
| 18 | Seedance 2.0 | Segmind | $0.182 | $10.92 | Free audio (no extra cost) |
| 19 | Kling 3.0 Pro | Segmind | $0.194 | $11.64 | Flat ($1.94/10s avg) |
| 20 | Veo 3.1 | Vertex AI | $0.20 | $12.00 | Yes (explicit tier) |
| 21 | Veo 3.1 | fal.ai | $0.20 | $12.00 | Yes (explicit tier) |
| 22 | Seedance 2.0 Fast | fal.ai | $0.242 | $14.52 | Flat (no discount) |
| 23 | Seedance 2.0 | fal.ai | $0.302 | $18.14 | Flat (no discount) |

## Feature Matrix

| Feature | Veo 3.1 | Runway Gen-4 | Kling 3.0 | Seedance 2.0 | Wan 2.7 |
|---------|---------|-------------|-----------|-------------|---------|
| Image-to-video | Yes | Yes | Yes | Yes | Yes |
| Reference images | Yes (3 asset) | Yes (@mention) | Yes (bind subject) | Yes (12 omni ref) | Yes (9-grid) |
| First + last frame | Yes | First only | Yes | Yes | Yes |
| Character consistency | Via ref images | Via ref images | Bind subject (strong) | Omni reference | 9-grid multi-angle |
| RAI safety filter | Aggressive | Moderate | Moderate | Minimal | Minimal |
| Max duration | 8s | 10s | 15s | 15s | 15s |
| Multi-shot native | No | No | Yes (6 shots) | No | No |

## Provider comparison per model

### Veo 3.1 Fast (720p, no audio)
| Provider | $/sec | Notes |
|----------|-------|-------|
| Vertex AI | $0.08 | Native, confirmed no-audio discount |
| Segmind | $0.10 | $0.40/4s, $0.60/6s, $0.80/8s (audio off) |
| fal.ai | $0.10 | Confirmed no-audio tier |

### Kling 3.0 Standard (720p, no audio)
| Provider | $/sec | Notes |
|----------|-------|-------|
| Kling native | $0.084 | 0.6 credits/s, credit = $0.14 |
| fal.ai | $0.084 | Confirmed audio off price |
| Segmind | ~$0.124 | $1.24/10s average (no audio/resolution breakdown) |

### Seedance 2.0 (720p, image-to-video)
| Provider | $/sec | Notes |
|----------|-------|-------|
| Segmind | $0.146 (Fast), $0.182 (Std) | Audio is FREE — no extra cost |
| BytePlus | ~$0.146 (Fast), ~$0.18 (Std) | Native, token-based |
| fal.ai | $0.242 (Fast), $0.302 (Std) | Most expensive for Seedance |

### Runway Gen-4 Turbo
| Provider | $/sec | Notes |
|----------|-------|-------|
| Runway API | $0.05 | 5 credits/s, $0.01/credit |
| Segmind | $0.10 | $0.50/5s, $1.00/10s — 2x native |

## Provider coverage

| Provider | Veo 3.1 | Runway Gen-4 | Kling 3.0 | Seedance 2.0 | Wan |
|----------|---------|-------------|-----------|-------------|-----|
| Native | Vertex AI | Runway API | Kling API | BytePlus | Alibaba Cloud |
| fal.ai | Yes | No | Yes | Yes | Yes (2.2) |
| Segmind | Yes | Yes | Yes | Yes | Yes (2.7) |
| Replicate | Yes | Yes | Yes | Yes | Yes |
| Together AI | No | No | No | No | Yes (2.7) |

## Recommendation for Lahari

**Primary: Veo 3.1 Fast on Vertex ($0.08/s)** — ref images + lastFrame, no-audio confirmed. Already wired up.

**Fallback for blocked content: Runway Gen-4 Turbo ($0.05/s native)** — different safety policy, ref images, cheapest option. Segmind is 2x native cost for Runway so go direct.

**Character-heavy shots: Kling 3.0 Standard ($0.084/s native or fal)** — bind subject for character lock-in. Same price across native + fal.

**Flexible refs: Seedance 2.0 Fast on Segmind or BytePlus (~$0.146/s)** — 12 omni refs, free audio. Avoid fal for Seedance (66% markup).

**Budget: Runway Gen-4 Turbo native ($0.05/s)** — cheapest with ref image support.

## Sources

- [Vertex AI pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing)
- [Kling native API pricing](https://kling.ai/dev/pricing)
- [fal.ai Kling 3.0 Standard](https://fal.ai/models/fal-ai/kling-video/v3/standard/image-to-video)
- [fal.ai Kling 3.0 Pro](https://fal.ai/models/fal-ai/kling-video/v3/pro/image-to-video)
- [fal.ai Seedance 2.0](https://fal.ai/models/bytedance/seedance-2.0/image-to-video)
- [fal.ai Seedance 2.0 Fast](https://fal.ai/models/bytedance/seedance-2.0/fast/image-to-video)
- [fal.ai Wan 2.2](https://fal.ai/models/fal-ai/wan/v2.2-a14b/image-to-video)
- [Segmind Veo 3.1 Fast](https://www.segmind.com/models/veo-3.1-fast/pricing) — $0.40-0.80 per gen (audio off)
- [Segmind Seedance 2.0](https://www.segmind.com/models/seedance-2.0/pricing) — $0.182/s at 720p, audio free
- [Segmind Seedance 2.0 token pricing](https://blog.segmind.com/how-video-token-pricing-actually-works-seedance-2-and-seedance-2-fast/)
- [Segmind Kling 3.0 Standard](https://www.segmind.com/partners/kling) — $1.24 avg/gen
- [Segmind Runway Gen-4 Turbo](https://www.segmind.com/models/runway-gen4-turbo/pricing) — $0.50/5s, $1.00/10s
- [Segmind Wan 2.7](https://www.segmind.com/partners/kling) — $0.70 avg/gen
- [Runway API pricing](https://docs.dev.runwayml.com/guides/pricing/)
- [Seedance BytePlus](https://docs.byteplus.com/en/docs/ModelArk/2291680)
- [Together AI Wan 2.7](https://www.together.ai/blog/wan-2-7-now-available-on-together-ai)
