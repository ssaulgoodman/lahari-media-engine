> Archived. Historical cost audit; current model/provider choices live in `docs/video-model-comparison.md` and runtime provider config.

# OpenAI Storyboard Cost Audit — 2026-05-11

## Summary

Storyboard generation is the source of the recent OpenAI spend spike.

The cost is not only `gpt-image-2`. The workflow burns on both sides:

1. `gpt-5.5` reasons/writes the storyboard and cut plan.
2. `gpt-image-2` generates a large storyboard image with high-detail reference images.

Current runtime path:

- `server/services/storyboard.ts`
- `server/services/openai-image.ts`
- Responses API model: `gpt-5.5-2026-04-23`
- Image tool model: `gpt-image-2-2026-04-21`
- Current storyboard image size: `3072x1536`
- Current quality: `medium`
- Input refs are sent as `input_image` with `detail: high`

## OpenAI Billing Findings

Queried OpenAI org costs with a read-only admin key. The key was used only for the live API query and was not saved.

Window queried:

```text
2026-05-08T08:41:44Z → 2026-05-11T08:41:44Z
```

The finalized OpenAI costs available for `2026-05-08` and `2026-05-09` totaled:

```text
Total: $22.5606
```

Cost breakdown by OpenAI line item:

```text
gpt-5.5-2026-04-23, input              $6.9928
gpt-image-2-2026-04-21 image, output   $5.7621
gpt-5.5-2026-04-23, output             $5.5977
gpt-image-2-2026-04-21 image, input    $3.6177
gpt-image-2-2026-04-21 text, input     $0.4813
gpt-5.5-2026-04-23, cached input       $0.1089
```

Approximate split:

```text
GPT-5.5 text/reasoning side:  ~$12.70
GPT-image-2 side:             ~$9.86
```

So the biggest total contributor is actually `gpt-5.5` text tokens, not just image output.

## Today’s Usage Snapshot

For `2026-05-11`, the OpenAI costs endpoint had not fully finalized yet, but usage was visible.

OpenAI usage reported:

```text
gpt-5.5 requests today:     66
gpt-image-2 requests today: 79
```

Lahari DB logs for storyboard calls since `2026-05-11T00:00:00Z`:

```text
49 successful generate-storyboard
16 successful refine-storyboard
11 failed storyboard attempts
76 total storyboard log rows
```

This correlates strongly with the OpenAI usage spike. Same OpenAI project id and API key id were used.

## Sample Response Usage

For 25 recent stored OpenAI Responses API calls, retrieved by `openai_response_id`:

```text
Average input tokens:          16,323
Average cached tokens:          4,966
Average uncached input tokens:  11,356
Average output tokens:          1,719
Average reasoning tokens:         444
Average total tokens:          18,041
Average image calls:             1.0
Estimated GPT-5.5 text cost:   ~$0.1108 per storyboard call
```

That text-only estimate excludes the `gpt-image-2` image generation cost.

Our app currently logs a fallback storyboard estimate of about `$0.06` per generated image via `OPENAI_STORYBOARD_COST_ESTIMATE`, so X-Ray/project cost is underreporting real spend.

## Main Cost Drivers

1. Large output image:

```ts
size: '3072x1536'
quality: 'medium'
```

This is ~4.7M pixels, larger than the usual 2K-ish threshold. Image cost/latency scales with size and quality.

2. High-detail reference images:

```ts
{ type: 'input_image', file_id, detail: 'high' }
```

The storyboard calls usually include 3-4 refs. OpenAI billing shows meaningful `gpt-image-2 image input` spend.

3. GPT-5.5 prompt/output size:

Prompts are around 4.5k-5k characters, but image refs and response chaining produce much larger token counts. Some recent responses were 20k-40k total tokens.

4. Bulk and retry behavior:

Bulk storyboard generation can fan out many calls quickly. Failed attempts also show up in Lahari logs and can still consume some upstream usage before erroring.

## Immediate Containment Recommendations

1. Disable or gate bulk storyboard generation behind an explicit cost confirmation.

2. Reduce storyboard image size from `3072x1536` to a cheaper default:

```text
1536x1024 for normal runs
2048x1152 only if needed for final boards
```

3. Add a draft mode:

```text
quality: low
smaller image size
optional final regenerate at medium
```

4. Store actual `response.usage` from OpenAI Responses API in `lahari_ai_calls` metadata or response summary.

5. Update `OPENAI_STORYBOARD_COST_ESTIMATE` to a more realistic temporary default, likely at least:

```text
$0.25-$0.35 per storyboard call
```

6. Consider replacing `gpt-5.5` in the storyboard path with a cheaper planner model or a two-step flow:

```text
cheap model writes cut plan → image model renders board
```

Use `gpt-5.5` only for difficult refinement or director-grade creative passes.

## Exact OpenAI Query Shape

Costs:

```bash
GET /v1/organization/costs
  ?start_time=<unix>
  &end_time=<unix>
  &bucket_width=1d
  &group_by=project_id,line_item
```

Usage:

```bash
GET /v1/organization/usage/completions
  ?start_time=<unix>
  &end_time=<unix>
  &bucket_width=1d
  &group_by=model,project_id,api_key_id
```

The normal project `OPENAI_API_KEY` cannot query this. It returned:

```text
403 Missing scopes: api.usage.read
```

An OpenAI admin/restricted key with `api.usage.read` is required.
