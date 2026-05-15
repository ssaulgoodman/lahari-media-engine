# Storyboard prompt — final template

This is the locked storyboard prompt for `buildStoryboardPrompt('adaptive_numbered_storyboard')` in [server/services/seedance-storyboard-rd.ts](../server/services/seedance-storyboard-rd.ts). Once signed off, port to the runtime helper.

Placeholders use `{{like_this}}`. The runtime computes `panelCount` / `rows` / `cols` from `clipDuration`:


| Clip duration | Grid | Panels |
| ------------- | ---- | ------ |
| < 10 seconds  | 2×2  | 4      |
| ≥ 10 seconds  | 2×3  | 6      |


Future iteration may swap the rule for pacing-driven sizing (slow → fewer panels, fast → more) once Gemini's pacing notes are available; for now, duration is the proxy.

---

## Final prompt

```
Create a numbered cinematic storyboard for one Lahari devotional music-video clip.

Use a {{rows}}×{{cols}} grid ({{panelCount}} panels) read left-to-right, top-to-bottom. Clean white background, thin white borders, generous spacing between and around every panel. Editorial minimalist storyboard layout, professional pitch-deck style.

Song: {{title}}
Concept: {{concept}}
{{#if mood}}Mood: {{mood}}{{/if}}
{{#if musicalCue}}Pacing cue from the music: {{musicalCue}}{{/if}}
Scene this clip is part of: {{sceneNarrative}}
Shot description: {{clipDirection}}
Clip length: {{clipDuration}}s
Characters in this shot: {{castNames || "no recurring character"}}
Setting: {{environmentName || "not specified"}}

Reference images:
- Style image — copy its lighting, colors, and art style.
- Character images — match each character's face, body, and outfit.
- Environment image — keep the same place and layout in every panel.

You're directing this clip's visual edit. The scene gives you the wider moment this clip belongs to; the shot description is the specific moment you draw. For each panel, decide:

- the framing (wide / medium / close / extreme close)
- the camera angle (eye / low / high / overhead / over-shoulder)
- whether the camera moves (static, push, pull, pan, tilt, rack-focus) or holds
- where characters stand, where they look, what they do
- which part of the environment is visible and how light falls
- why this cut earns its place — new information, deeper emotion, or a beat hit
- where in the {{clipDuration}}s window this panel sits

Across the panels, design a coherent arc: open (establish), build (deepen the moment), land (the strongest visual or emotional beat), resolve (a final image that releases the tension). Keep a stable spatial map — characters and key objects on consistent sides of the frame across cuts (the 180° rule).

Storyboard contract:
- Treat the board as one edited scene, not separate concept frames. Every panel must be a plausible frame from the same {{clipDuration}}s clip.
- Each panel is a true 16:9 cinematic film frame, all panels with identical width and height. Do not stretch, crop, stack vertically, or distort panels to fill the canvas.
- Maintain 100% visual consistency across all panels: same art style, same lighting mood, same character designs, same color palette, same environment details, same costumes and jewelry.
- Only the characters listed in "Characters in this shot" appear with identity in this clip. Other named characters mentioned elsewhere in the brief (concept or scene context) belong to the broader scene, not this clip — don't draw them. Anonymous background figures the shot description itself calls for (crowds of devotees, villagers, distant sages, temple staff) are fine; keep them out of the foreground unless the shot calls for it.
- Use only culturally authentic objects, gestures, and elements that belong to the shot, the references, and the devotional Bhakti context.
- Every panel must show visible action, a clear camera angle, and a step in the emotional progression — not a static repeat of the previous panel.
- Mark each panel with a small clean panel number only — just the digit ("1", "2", "3"…) in a corner. Do not write descriptions, captions, arrows, subtitles, speech bubbles, logos, watermarks, or any other readable text inside the panels. Panel descriptions live outside the image, in the shot progression below.

Style and quality:
- Live-action cinematic realism, high-end Indian devotional film quality.
- Sharp focus, natural skin and fabric detail, real-world materials, physically accurate lighting.
- Spiritually uplifting, emotionally moving, serene yet vibrant Bhakti devotional atmosphere.
- Ultra-high resolution, subtle film grain, masterpiece quality.

Then, outside the image, return a concise shot progression in plain text using this exact shape. Use exactly the same number of panels as the image:

Shot progression:
Panel 1 [MM:SS-MM:SS] - camera: <shot type and any movement>; action: <what happens visibly in this panel>; motion cue: <the specific camera move or beat the video model should preserve, e.g. "slow push-in over 3s" or "rack focus on a chime hit">
Panel 2 [MM:SS-MM:SS] - camera: ...; action: ...; motion cue: ...
(repeat for every panel actually drawn)

Continuity notes: one short sentence naming the spatial map and screen direction you preserved.
```

---

## Runtime port plan

When this is approved, two changes hit `seedance-storyboard-rd.ts`:

1. Add a `panelLayout(clipDuration)` helper:
  ```ts
   const panelLayout = (sec: number) =>
     sec < 10 ? { count: 4, rows: 2, cols: 2 } : { count: 6, rows: 2, cols: 3 };
  ```
2. Rewrite `buildStoryboardPrompt('adaptive_numbered_storyboard')` to render the template above, threading `panelCount`, `rows`, `cols` from the helper and the existing `clipContext()` fields into the placeholders.

The other three variants (`four_panel_clean`, `six_panel_music_video`, `filmstrip_minimal_cuts`) stay untouched — they're alternate variants for A/B research and the default everyone hits is `adaptive_numbered_storyboard`.
