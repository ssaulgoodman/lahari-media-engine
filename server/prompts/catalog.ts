/**
 * Prompt catalog — the read-only reference for every AI prompt in the pipeline.
 *
 * PRESET ABSTRACTION WARNING (2026-05-17): this catalog is currently a
 * legacy/internal reference surface. Runtime prompt builders have begun moving
 * to core + workflow + preset composition (`server/presets.ts`), and this file
 * still contains older compatibility examples in several templates. Do not
 * treat it as public Prompt Library copy until the catalog is regenerated from
 * or hand-synced with the runtime builders.
 *
 * NOTE FOR FUTURE CHANGES: this file is hand-synced with the actual prompt
 * strings in services/claude.ts, services/imagen.ts, services/gemini.ts,
 * services/openai-script.ts, services/storyboard.ts,
 * services/seedance-storyboard-rd.ts, and routes/generate-video.ts. When you
 * tweak a prompt in the service, update its `template` here so the Prompts page
 * stays truthful.
 *
 * Phase 1 = display only. Phase 2 moves to server/prompts/<name>.ts templates
 * with runtime interpolation + per-project overrides.
 *
 * Text-provider routing (2026-05-12): every entry below whose `model` column
 * says "Claude Opus" or "Claude Sonnet" for a text stage is actually routed
 * through `project.text_provider`. Three options: `claude-opus` (default,
 * Opus 4.7 primary / Sonnet 4.6 refine), `gpt-5.5`, `gemini-3-pro` (Gemini
 * 3 Pro primary / Gemini 3.1 Flash refine). The only text stages NOT routed
 * are the script writer trio: planScenes, refineScript, writeShotPrompts —
 * they stay on Claude Opus because the extended-thinking + validation-loop
 * retry semantics don't port cleanly to OpenAI / Gemini. The storyboard
 * planner IS routed (uses `useRefineModel: true` to keep cost low).
 */

export type PromptStage =
  | 'audio'          // Transcription + structure detection
  | 'blueprint'      // Concept, script, style direction
  | 'looks'          // Character + environment image gen
  | 'studio'         // Shot-level image/video work
  | 'utilities';     // Vision describe, critique, chat

export type PromptMeta = {
  id: string;
  name: string;
  stage: PromptStage;
  model: string;
  modelLabel: string;
  /** The UI action that fires this prompt. */
  triggeredBy: string;
  /** One-sentence description of what it does. */
  summary: string;
  variables: { name: string; description: string }[];
  template: string;
  /** Source reference for maintainers. */
  source: { file: string; lines: string };
};

export const PROMPT_CATALOG: PromptMeta[] = [
  // ─── Audio ────────────────────────────────────────────────────────
  {
    id: 'transcribe-lyrics',
    name: 'Transcribe lyrics',
    stage: 'audio',
    model: 'gemini-3-pro-preview',
    modelLabel: 'Gemini 3 Pro',
    triggeredBy: 'Queue start (fallback when no SRT and no cached analysis), direct upload, or "Fill missing" button.',
    summary: 'Extracts timestamped lyrics ([M:SS] format) from audio. Queue checks cached analysis on songs table first, then SRT, then this fallback.',
    variables: [
      { name: 'language', description: 'Song language or "Detect automatically"' },
    ],
    template: `Transcribe the lyrics of this audio.
Language: {{language}}.
Format: timestamp on the left, lyrics on the right. Like:

[0:00] First line of lyrics
[0:15] Second line of lyrics

Rules:
- Original language ONLY. No translations.
- One line per lyrical phrase with its approximate timestamp.
- Keep it clean and simple. No SRT format, no numbering, no metadata.
Return ONLY the transcription.`,
    source: { file: 'server/services/gemini.ts', lines: '67-93' },
  },
  {
    id: 'detect-structure',
    name: 'Detect musical structure + classify song',
    stage: 'audio',
    model: 'gemini-3-pro-preview',
    modelLabel: 'Gemini 3 Pro',
    triggeredBy: 'Fires in parallel with transcription at project creation.',
    summary: 'Identifies musical sections + classifies the song type from audio. Returns sections array, songType enum (stotra/chant/bhajan/kirtan/song/unknown), isNarrative boolean, isMeditative boolean. Classification flows to concept generation.',
    variables: [],
    template: `Analyze this audio and return a JSON object with four fields:

1. "sections" — array of musical sections (max 10). Each: label, startTime (M:SS), endTime (M:SS), energy (Low/Medium/High), 5-word description.

2. "songType" — one of: stotra, chant, bhajan, kirtan, song, unknown.

3. "isNarrative" — true if the song tells a story or has a dramatic arc.

4. "isMeditative" — true if the song is contemplative, steady, inward-focused.`,
    source: { file: 'server/services/gemini.ts', lines: 'detectStructure' },
  },
  {
    id: 'summarize-meaning',
    name: 'Summarize meaning',
    stage: 'audio',
    model: 'claude-sonnet-4-6',
    modelLabel: 'Claude Sonnet 4.6',
    triggeredBy: 'Chains after lyrics are available (never in parallel with transcription).',
    summary: 'Writes a 150-word interpretive summary: theme, addressee, emotional arc, cultural context.',
    variables: [
      { name: 'title', description: 'Song title' },
      { name: 'language', description: 'Song language' },
      { name: 'context', description: 'Optional extra context from queue metadata' },
      { name: 'lyrics', description: 'Transcribed lyrics' },
    ],
    template: `Song: {{title}} ({{language}})
{{context ? "Context: " + context : ""}}

LYRICS:
{{lyrics}}

Summarize the meaning of this song.

Cover:
1. What is the song about? (2-3 sentences)
2. Who is it addressed to?
3. Emotional arc
4. Cultural/spiritual context

Under 150 words. Write in English.`,
    source: { file: 'server/services/claude.ts', lines: '19-51' },
  },
  {
    id: 'write-audio-plan',
    name: 'Write per-shot dialogue/audio plan',
    stage: 'blueprint',
    model: 'project.text_provider',
    modelLabel: 'Project text provider',
    triggeredBy: 'Script phase "Write dialogue", Audio phase rewrites, or Codex audio-director apply flow.',
    summary: 'Writes structured per-shot dialogue, restrained sound notes, and server-inferred lipsync/overlay strategy for anime/dialogue workflows. Music-video workflow skips this by default.',
    variables: [
      { name: 'project', description: 'Project title, workflow, preset, and source_payload' },
      { name: 'scene', description: 'Scene label, narrative description, and any source/lyrics text' },
      { name: 'shot', description: 'Shot ID, duration, direction, visual prompt, and cast IDs' },
      { name: 'cast', description: 'Allowed cast IDs with names, descriptions, look availability, and voice assignment state' },
      { name: 'preset', description: 'Runtime preset, including source and audio rules' },
    ],
    template: `CORE TASK
Write spoken dialogue lines and restrained sound notes for one shot only.
This is structured production data that drives TTS, lipsync, overlay audio, and video-generation context. It is not prose and it is not a script rewrite.

CONTEXT
{{workflowContextFor(preset)}}

INPUTS
Project title: {{project.title}}
Scene label: {{scene.section_label}}
Scene narrative: {{scene.narrative_description}}
Scene source text: {{scene.lyrics}}
Shot ID: {{shot.id}}
Shot duration: {{shot.duration}}s
Shot direction: {{shot.direction}}
Shot visual prompt: {{shot.visual_prompt}}
Allowed cast: {{allowedCast}}
Raw source material: {{source_payload}}

TASTE
{{preset.source.rules}}
{{preset.audio.dialogueRules}}
{{preset.audio.soundRules}}
{{preset.audio.strategyRules}}

OUTPUT CONTRACT
- Use only the listed cast IDs. Do not invent characters.
- Dialogue text is exactly what TTS will speak. Never include delivery labels, camera notes, speaker names, or parenthetical directions inside dialogue text.
- If the shot has no spoken line, return an empty dialogue array and optional soundNotes.
- targetSec is optional; include it only when the line's approximate timing is obvious from the shot.
- Return only structured audio-plan JSON.`,
    source: { file: 'server/prompts/audioPlan.ts', lines: 'buildAudioPlanPrompt' },
  },

  // ─── Blueprint ────────────────────────────────────────────────────
  {
    id: 'generate-concepts',
    name: 'Generate concept directions',
    stage: 'blueprint',
    model: 'claude-opus-4-7',
    modelLabel: 'Claude Opus 4.7',
    triggeredBy: "Fires when you click 'Generate concept' on the Concept phase.",
    summary: 'Proposes 3 creative narrative directions for the project (or 1 if a director brief is set). Composed via composePrompt; concept stays story/brief-level — style and medium are decided in later phases. User note is a hard creative constraint inside the tool contract.',
    variables: [
      { name: 'title', description: 'Project title' },
      { name: 'language', description: 'Project language' },
      { name: 'workflowContext', description: 'Human-readable production-spine context; never raw workflow enum labels' },
      { name: 'presetTaste', description: 'preset.concept.rules — concept-layer rules only; no style/medium content' },
      { name: 'userNotePolicy', description: 'Hard-constraint policy: all directions satisfy the note; conflicts translate to concept-layer intent' },
      { name: 'sourceText', description: 'Lyrics (music_led) or script excerpt (scripted_narrative)' },
      { name: 'meaning', description: 'Music meaning/intent OR director brief/logline' },
      { name: 'musicalStructure', description: 'Section summary for music_led' },
      { name: 'scriptSummary', description: 'Optional script overview for scripted_narrative' },
      { name: 'songType', description: 'Audio classification for music_led' },
      { name: 'isNarrative', description: 'Has dramatic arc?' },
      { name: 'isMeditative', description: 'Contemplative/inward?' },
      { name: 'context', description: 'Optional project context' },
      { name: 'directorBrief', description: "If set, output is EXACTLY 1 concept that realizes the brief instead of 3 directions" },
      { name: 'userNote', description: 'Optional director nudge for this generation call' },
    ],
    template: `Propose creative narrative directions for this project.

Each direction is one coherent idea — what the viewer follows, what visibly happens, the emotional arc, the world the work lives in. Focus on story, beats, and what visibly happens.

Visual style, palette, and cinematography are decided in later phases. Do not include art-style language, camera directions, or color palette in any field — those belong to the style phase, not the concept phase.

CONTEXT
{{workflowContext}}

INPUTS
{{formatted title, language, source text, meaning, musical structure or script overview, audio classification, director brief if set}}

TASTE
{{preset.concept.rules}}

USER NOTE POLICY
{{If USER NOTE is present, treat it as a hard creative constraint. All returned directions must satisfy it. Conflicts with source/preset/tool contract are refused or translated to concept-layer intent. Variety means distinct directions inside the constraint.}}

Return EXACTLY 3 concepts (or 1 if directorBrief is set). Each: title, subject, mood, theme, conceptDirection, description.

USER NOTE
{{userNote}}`,
    source: { file: 'server/prompts/concept.ts', lines: 'buildGenerateConceptPrompt' },
  },
  {
    id: 'plan-scenes',
    name: 'Plan script (cast, environments, scenes, shots)',
    stage: 'blueprint',
    model: 'claude-opus-4-7',
    modelLabel: 'Claude Opus 4.7',
    triggeredBy: "Fires when you click 'Generate script' on the Script phase.",
    summary: 'Plans the full music-led video structure — cast list, environments, scenes aligned to musical sections, and shot directions. Composed via composePrompt; user note is a hard structural constraint inside source timing and preset rules.',
    variables: [
      { name: 'videoModel', description: 'Selected video model; Seedance enables storyboard-clip pacing rules' },
      { name: 'concept', description: 'Locked concept (subject, direction, theme, expanded description, mood)' },
      { name: 'lyrics', description: 'Full lyrics' },
      { name: 'meaning', description: 'Meaning summary' },
      { name: 'musicalStructure', description: 'Sections with timestamps' },
      { name: 'pacing', description: 'Shot duration in seconds (default 15 — matches Seedance storyboard-mode workhorse clip length)' },
      { name: 'minShotDuration', description: 'Video model minimum clip length (e.g. 4s for Veo Standard, 8s for Veo Fast)' },
      { name: 'workflowContext', description: 'Human-readable music-led production context; never raw workflow enum labels' },
      { name: 'presetTaste', description: 'Source rules, workflow shot-plan rules, pacing, and preset script rules' },
      { name: 'userNotePolicy', description: 'Hard-constraint policy: all structure satisfies the note unless source timing/tool contract wins' },
      { name: 'songType', description: 'Audio classification when available' },
      { name: 'isNarrative', description: 'Has dramatic arc?' },
      { name: 'isMeditative', description: 'Contemplative/inward?' },
      { name: 'userNote', description: 'Optional director note' },
    ],
    template: `Plan the production structure for a music-led video.

Create cast, environments, scenes, and shot directions. A later prompt decides visual framing and camera language, so focus on what happens: visible action, performance, emotional movement, scene progression, and musical response.

CONTEXT
{{workflowContext}}

INPUTS
{{Concept, audio classification, lyrics/source text, meaning/intent, musical structure}}

TASTE
{{preset.source.rules}}
{{workflow.shotPlanRules}}
{{director mode + pacing guidance}}
{{preset.script.castRules / environmentRules / sceneRules / shot examples}}

USER NOTE POLICY
{{If USER NOTE is present, all returned structure satisfies it. If it conflicts with source timing or production constraints, preserve the contract and translate the note into closest valid structural intent.}}

Return the plan using the plan_music_video tool.

Uses extended thinking (8K budget) so Claude reasons through pacing math.
Validation loop: enforces shot counts/duration sums plus cast/env references.
Errors sent back as tool_result for self-correction (max 3 attempts).

USER NOTE
{{userNote}}`,
    source: { file: 'server/prompts/planScenes.ts', lines: 'buildPlanScenesPrompt' },
  },
  {
    id: 'parse-script-intake',
    name: 'Parse script seed',
    stage: 'blueprint',
    model: 'claude-opus-4-7',
    modelLabel: 'Claude Opus 4.7',
    triggeredBy: 'Fires when a script-first project is created from direct intake.',
    summary: 'Converts an uploaded script/treatment into cast, environments, scenes, and shots. Composed via composePrompt; preserves story intent and uses preset rules for extraction/planning.',
    variables: [
      { name: 'workflowContext', description: 'Human-readable scripted narrative context; never raw workflow enum labels' },
      { name: 'scriptText', description: 'Uploaded script, treatment, or episode brief' },
      { name: 'directorBrief', description: 'Optional intake brief' },
      { name: 'targetRuntime', description: 'Optional total runtime target, stored in project_brief' },
      { name: 'presetTaste', description: 'Source rules, workflow shot-plan rules, pacing, cast/env extraction rules, and scene planning rules' },
    ],
    template: `Convert the uploaded script into a production-ready scene and shot plan.

This is extraction and production planning, not story rewriting. Preserve story intent, scene order, character actions, and dialogue order unless the director brief explicitly asks for adaptation.

CONTEXT
{{workflowContext}}

INPUTS
{{Source title, director brief, target runtime, script text}}

TASTE
{{preset.source.rules}}
{{workflow.shotPlanRules}}
{{default pacing}}
{{preset.script.castRules / environmentRules / sceneRules}}

Return the plan using the parse_scripted_narrative tool.

Hard rules:
- Break the script into production scenes and shots.
- Extract cast members needed on screen.
- Extract reusable environments/backgrounds.
- Shot directions describe what happens, not camera/lens/style.
- Every shot has castNames and environmentName.
- Do not invent new plot turns, characters, or locations unless required to make an underspecified brief producible.`,
    source: { file: 'server/prompts/parseScript.ts', lines: 'buildParseScriptPrompt' },
  },
  {
    id: 'plan-scenes-openai',
    name: 'Plan script (GPT-5.5 experiment)',
    stage: 'blueprint',
    model: 'gpt-5.5',
    modelLabel: 'GPT-5.5 (Responses structured output)',
    triggeredBy: 'Experimental script generation path when scriptProvider/openai runtime flag is selected.',
    summary: 'Alternative script planner using the same composed plan-scenes prompt, cast/environment/scene/shot JSON contract, and validation loop as the Claude planner.',
    variables: [
      { name: 'videoModel', description: 'Selected video model; Seedance enables storyboard-clip pacing rules' },
      { name: 'concept', description: 'Locked concept (subject, direction, theme, expanded description, mood)' },
      { name: 'lyrics', description: 'Full lyrics' },
      { name: 'meaning', description: 'Meaning summary' },
      { name: 'musicalStructure', description: 'Sections with timestamps' },
      { name: 'pacing', description: 'Base shot duration for keyframe mode' },
      { name: 'minShotDuration', description: 'Video model minimum clip length' },
      { name: 'songType', description: 'Audio classification for music-led projects' },
      { name: 'isNarrative', description: 'Has dramatic arc?' },
      { name: 'isMeditative', description: 'Contemplative/inward?' },
      { name: 'userNote', description: 'Optional director note' },
    ],
    template: `This path delegates to server/prompts/planScenes.ts and then asks GPT-5.5 for the same strict JSON schema used by the Claude planner.

CORE TASK
Plan the production structure: cast, reusable environments, scenes aligned to source timing, and concrete shot directions.

CONTEXT
{{workflowContextFor(preset)}}

INPUTS
{{concept, source text, meaning/director brief, musical or timing structure, model pacing, and optional user note}}

TASTE
{{preset.source.rules}}
{{preset.workflow.scriptRules}}
{{preset.script.sceneRules}}
{{preset.script.castRules}}
{{preset.script.environmentRules}}

USER NOTE POLICY
{{Hard structural constraint when present; source timing and output contract still win.}}

OUTPUT CONTRACT
Return only the script JSON schema: cast, environments, scenes, shots.`,
    source: { file: 'server/prompts/planScenes.ts + server/services/openai-script.ts', lines: 'buildPlanScenesPrompt / planScenesOpenAI' },
  },
  {
    id: 'brainstorm-style-directions',
    name: 'Brainstorm style directions',
    stage: 'blueprint',
    model: 'claude-opus-4-7',
    modelLabel: 'Claude Opus 4.7',
    triggeredBy: "Fires when you click 'Brainstorm styles' on the Style phase.",
    summary: 'Proposes 4 distinct visual style directions — lighting, palette, texture, cultural references.',
    variables: [
      { name: 'concept', description: 'Locked concept' },
      { name: 'workflowContext', description: 'Human-readable production-spine context; never raw workflow enum labels' },
      { name: 'presetTaste', description: 'Preset style rules + brainstorm-only taste rules' },
      { name: 'sourceText', description: 'Lyrics/source excerpt for music-led projects; script/source excerpt for scripted narrative projects' },
      { name: 'meaning', description: 'Music-led meaning/intent, or scripted director brief/logline when available' },
      { name: 'scriptSummary', description: 'Optional scene/script overview once it exists' },
      { name: 'userNotes', description: 'Optional preference for all 4 variations' },
    ],
    template: `Propose 4 distinct visual style directions for this project.

Each direction is one coherent visual world the project could live inside.
Do not write story, scenes, characters, camera shot lists, or plot beats.
Cover a real range across legitimate aesthetics for the medium described in TASTE.

CONTEXT
{{workflowContext}}

INPUTS
{{formatted project subject, concept/theme, mood, source excerpt, meaning/logline, and script overview}}

TASTE
{{preset.style.rules}}
{{preset.style.brainstormTaste}}

Return exactly 4 directions as JSON.

Each direction:
- title: short evocative name, 2-5 words
- description: 2 compact sentences describing palette, line or medium treatment, rendering, lighting, texture, and overall mood

Hard rules:
- No character names.
- No scene beats.
- No plot.
- Do not number directions as story arcs.
- Each direction must be independently usable as an image-generation style prompt.
- Do not restate one look with different adjectives.

USER NOTE
{{userNotes}}`,
    source: { file: 'server/prompts/styleBrainstorm.ts', lines: 'buildStyleBrainstormPrompt' },
  },
  {
    id: 'refine-style-direction',
    name: 'Refine style direction',
    stage: 'blueprint',
    model: 'claude-sonnet-4-6',
    modelLabel: 'Claude Sonnet 4.6',
    triggeredBy: "Fires when you add feedback on a style direction and click 'Refine'.",
    summary: 'Revises one style direction using director feedback. Composed via composePrompt; user note (the feedback) is applied surgically — preserve identity, do not regenerate. If feedback conflicts with medium guard, translate to medium-safe analogue.',
    variables: [
      { name: 'currentDescription', description: 'Current direction text' },
      { name: 'currentTitle', description: 'Optional current title' },
      { name: 'feedback', description: 'Director feedback — flows into USER NOTE' },
      { name: 'concept', description: 'Locked concept (for subject/mood context)' },
      { name: 'workflowContext', description: 'Human-readable production-spine context' },
      { name: 'presetTaste', description: 'preset.style.rules — medium + drift bans' },
      { name: 'userNotePolicy', description: 'Surgical-application policy: touch only addressed fields, preserve identity, translate medium conflicts' },
    ],
    template: `Revise the current style direction text using the director's feedback.

This is a surgical refinement, not a replacement. Preserve the direction's core identity. Update only the aspects the feedback addresses; leave the rest of the description intact.

CONTEXT
{{workflowContext}}

INPUTS
{{Subject, mood, theme, and the current direction text}}

TASTE
{{preset.style.rules}}

USER NOTE POLICY
{{Apply surgically. Touch only what the note addresses. Preserve identity. Refuse medium conflicts or translate to medium-safe analogue.}}

Return refined direction as JSON: title (revise only if note touches it), description (2 compact sentences).

USER NOTE
{{feedback}}`,
    source: { file: 'server/prompts/refineStyle.ts', lines: 'buildRefineStylePrompt' },
  },
  // Note: curated style presets no longer involve any AI prompt. The /lock-
  // style-preset endpoint points a new project-scoped asset row at the
  // preset's shared curated file_path and writes style_asset_id directly —
  // no text-to-image step. The old "visualize curated style preset" prompt
  // entry was removed when that path was deleted (it was generating fresh
  // images from description text without ever reading the curated file).
  // ─── Looks ────────────────────────────────────────────────────────
  {
    id: 'character-look',
    name: 'Character look',
    stage: 'looks',
    model: 'gemini-3-pro-image-preview',
    modelLabel: 'Gemini 3 Pro Image',
    triggeredBy: "Fires 3× in parallel when you click 'Generate look' on a character.",
    summary: 'Generates 3 reusable neutral character reference portraits — no props, no actions, plain background for reuse across shots.',
    variables: [
      { name: 'character.name', description: 'Character name' },
      { name: 'character.description', description: 'Physical + cultural description' },
      { name: 'styleImage', description: 'Locked style reference (Image N)' },
      { name: 'styleDescription', description: 'Optional style intent note stored on the locked style' },
      { name: 'userRefImage', description: 'Optional director-supplied reference' },
      { name: 'userFeedback', description: 'Optional director note' },
    ],
    template: `Generate one reusable character reference portrait.

CONTEXT
{{workflowContext}}

INPUTS
Style reference image: Image 1
The style image is the visual authority for medium, rendering, line treatment, palette, texture, lighting, and finish.
{{styleDescription ? "Style intent note: " + styleDescription + "\nUse the style intent note only to clarify what to extract from the style image. If the text and image disagree, follow the image." : ""}}
{{userRefImage ? "Director character reference: Image 2\nMatch its identity cues. The style reference remains the source of truth for how to render them." : ""}}

Character: {{character.name}}
Character description: {{character.description}}

TASTE
{{preset.style.rules}}
{{preset.looks.characterRules}}
{{preset.looks.qualityRules}}

OUTPUT CONTRACT
One single image. No collage, no grid, no multiple panels. No text, no watermark.
Mid-shot portrait, neutral pose, plain or softly blurred background, no props or scene-specific action.`,
    source: { file: 'server/prompts/lookPrompts.ts', lines: 'buildCharacterLookPrompt' },
  },
  {
    id: 'environment-look',
    name: 'Environment look',
    stage: 'looks',
    model: 'gemini-3-pro-image-preview',
    modelLabel: 'Gemini 3 Pro Image',
    triggeredBy: "Fires 3× in parallel when you click 'Generate look' on an environment.",
    summary: 'Generates 3 wide establishing shots of the environment — empty, no characters.',
    variables: [
      { name: 'environment.name', description: 'Environment name' },
      { name: 'environment.description', description: 'Spatial description' },
      { name: 'styleImage', description: 'Locked style reference (Image N)' },
      { name: 'styleDescription', description: 'Optional style intent note stored on the locked style' },
      { name: 'userRefImage', description: 'Optional director-supplied reference' },
      { name: 'userNote', description: 'Optional director note' },
    ],
    template: `Generate one reusable environment reference image.

CONTEXT
{{workflowContext}}

INPUTS
Style reference image: Image 1
The style image is the visual authority for medium, rendering, line treatment, palette, texture, lighting, and finish.
{{styleDescription ? "Style intent note: " + styleDescription + "\nUse the style intent note only to clarify what to extract from the style image. If the text and image disagree, follow the image." : ""}}
{{userRefImage ? "Director environment reference: Image 2\nMatch its geography, architecture, layout, and mood. The style reference remains the source of truth for how to render it." : ""}}

Environment: {{environment.name}}
Environment description: {{environment.description}}

TASTE
{{preset.style.rules}}
{{preset.looks.environmentRules}}
{{preset.looks.qualityRules}}

OUTPUT CONTRACT
One single image. No collage, no grid, no multiple panels. No text, no watermark.
Full reusable environment reference, whole space visible, no characters unless scale absolutely requires tiny neutral figures.`,
    source: { file: 'server/prompts/lookPrompts.ts', lines: 'buildEnvironmentLookPrompt' },
  },

  // ─── Studio ───────────────────────────────────────────────────────
  {
    id: 'write-shot-prompts',
    name: 'Write shot prompts (bulk)',
    stage: 'studio',
    model: 'claude-opus-4-7',
    modelLabel: 'Claude Opus 4.7',
    triggeredBy: "Auto-fires once at the end of Blueprint, or when you click 'Rewrite all' in Studio.",
    summary: 'Composed via composePrompt. Writes visual + motion prompts per shot plus a continuity tag (cut vs prev_shot). User note is a hard creative constraint applied across every shot; conflicts with the locked style reference or preset rules translate to closest valid intent. "Cinematic but renderable" — functional for AI models without being literary or schematic.',
    variables: [
      { name: 'shots', description: 'List of shots with id, direction, duration, cast, scene context' },
      { name: 'cast', description: 'Character descriptions' },
      { name: 'workflowContext', description: 'Human-readable production-spine context' },
      { name: 'presetTaste', description: 'preset.studio.shotPromptRules' },
      { name: 'userNotePolicy', description: 'Hard-constraint policy applied to every shot; refuse conflicts with style ref / preset' },
      { name: 'videoModel', description: 'Selected video model; appends Seedance-specific guidance to INPUTS' },
      { name: 'songType', description: 'Audio classification (music_led only)' },
      { name: 'isNarrative', description: 'Has dramatic arc? (music_led only)' },
      { name: 'isMeditative', description: 'Contemplative/inward? — appends pacing guidance' },
      { name: 'concept', description: 'Used only for mood anchor' },
      { name: 'userNote', description: 'Optional director note' },
      { name: 'previousBatchTail', description: 'Tail of previous batch for continuity context' },
    ],
    template: `CORE TASK
Write renderable visualPrompt + motionPrompt pairs for the listed shots. The script already planned what happens; this tool turns those beats into image/video model instructions.

CONTEXT
{{workflowContextFor(preset)}}

INPUTS
Mood: {{concept.mood}}
Video model: {{videoModel}}
Characters: {{castList}}
Previous batch tail: {{previousBatchTail}}
Shots to write: {{shotList}}
Model guidance: {{seedance or default video guidance}}
Music-led audio classification/pacing flags appear only for music-led projects.

TASTE
{{preset.studio.shotPromptRules}}

USER NOTE POLICY
{{If USER NOTE is present, treat it as a hard creative constraint across every shot unless it conflicts with the locked style reference, preset rules, cast/environment facts, or output contract.}}

OUTPUT CONTRACT
- id must exactly match the shot ID.
- visualPrompt is the start frame: subject placement, shot scale, spatial relationship, location, and one key visible detail. No art style or palette; the locked style reference owns medium.
- motionPrompt is one sentence describing only visible change: character action, camera movement, environmental motion, or timing.
- continuityFrom is cut or prev_shot. First shot of a scene is always cut.
- Do not invent geography, props, characters, generated audio, subtitles, or invisible emotion.
- Return one entry per shot.`,
    source: { file: 'server/prompts/shotPrompts.ts', lines: 'buildWriteShotPromptsPrompt' },
  },
  {
    id: 'seedance-storyboard-image',
    name: 'Write Seedance storyboard prompt',
    stage: 'studio',
    model: 'per-project text_provider (refine sibling)',
    modelLabel: 'Claude Sonnet / GPT-5.5 / Gemini 3.1 Flash (refine tier)',
    triggeredBy: "Fires when you click 'Board prompts' or per-shot 'Write prompt' in Seedance storyboard mode.",
    summary: 'Composer-backed planner step. Converts one shot brief into two saved artifacts: storyboardPrompt for the image renderer and cutPlanText for Seedance video. Panel actions appear in both outputs; locked refs and preset taste decide the medium.',
    variables: [
      { name: 'title', description: 'Song title' },
      { name: 'concept', description: 'Locked concept summary' },
      { name: 'sceneLabel', description: 'Scene/section label for context only' },
      { name: 'sceneNarrative', description: 'Scene overview for context only' },
      { name: 'musicalCue', description: 'Audio-analysis musical structure cue' },
      { name: 'clipDirection', description: 'Exact shot direction to storyboard' },
      { name: 'clipDuration', description: 'Seedance clip duration, 4-15s' },
      { name: 'sceneLyrics', description: 'Lyric/phrase cue if present' },
      { name: 'castNames', description: 'Characters visible in this clip' },
      { name: 'environmentName', description: 'Environment reference name' },
      { name: 'styleImage', description: 'Locked style reference (vision input — always sent so the planner can read the medium and adjust output language)' },
      { name: 'prevStoryboardImage', description: 'Optional prev shot storyboard (vision input) when shot.use_prev_storyboard_ref is true' },
      { name: 'prevCutPlanText', description: 'Optional prev shot cut plan (text context) when shot.include_prev_cut_plan resolves true (smart default: continuity_from === prev_shot)' },
      { name: 'artistNote', description: 'Optional rewrite/refine instruction' },
      { name: 'artistReferenceImage', description: 'Optional visual reference attached during refine' },
    ],
    template: `CORE TASK
Plan one storyboard board and cut plan for a two-step storyboard workflow.

CONTEXT
{{workflowContextFor(preset)}}

INPUTS
Source brief: {{shot title, concept, scene, clip direction, cast, environment, duration, panel grid}}
Current storyboard prompt: {{currentPrompt, refine only}}
Current cut plan: {{currentCutPlan, refine only}}
Previous storyboard ref: {{present when enabled}}
Previous cut plan tail: {{present when enabled}}
Artist reference: {{present during refine with image}}

TASTE
{{preset.style.rules}}
{{preset.studio.storyboardRules}}
{{project storyboard override}}

USER NOTE POLICY
{{Refine only: apply director feedback surgically; preserve source brief, locked refs, panel logic, and continuity unless the note changes them.}}

OUTPUT CONTRACT
Return only JSON:
{
  "storyboardPrompt": "complete image-model prompt with panel layout, subject/setting context, per-panel action descriptions inline, explicit inter-panel consistency demand, and no-text-in-panels rule",
  "cutPlanText": "Panel N — <action> per panel, one line each"
}

storyboardPrompt stays lean, roughly under 330 words. No contract bullet lists, animation rules, emotional-arc prose, quality boilerplate, readable text, captions, logos, or watermarks.`,
    source: { file: 'server/prompts/storyboard.ts + server/services/seedance-storyboard-rd.ts', lines: 'buildStoryboardPlannerPrompt / buildStoryboardPrompt' },
  },
  {
    id: 'render-seedance-storyboard-image',
    name: 'Render Seedance storyboard image',
    stage: 'studio',
    model: 'nano-banana-2 / nano-banana-pro / gpt-image-2',
    modelLabel: 'Storyboard image provider (project storyboard_provider)',
    triggeredBy: "Fires when you click 'Board images' or per-shot 'Generate storyboard' after a saved prompt exists. Bulk button regenerates already-rendered (unlocked) boards too — only locked shots are skipped.",
    summary: 'Image-only render step. Sends the saved storyboardPrompt to the selected storyboard provider with locked style/cast/environment refs. Cut plan is NOT sent — it is for the downstream Seedance video step only. Three provider options, all routed through Segmind BYOK: nano-banana-2 (default), nano-banana-pro, and gpt-image-2.',
    variables: [
      { name: 'storyboardPrompt', description: 'Saved image-render prompt on the shot. Only field required for image gen.' },
      { name: 'storyboardProvider', description: 'Project storyboard provider: nano-banana-2 | nano-banana-pro | gpt-image-2' },
      { name: 'referenceImages', description: 'Locked style, cast, environment refs (filtered by shot.excluded_refs.storyboard). When shot.use_prev_storyboard_ref is true, the prev shot\'s locked storyboard is also attached. In edit_image refine mode, the previous storyboard image is prepended; an artist-attached refinement ref is appended last.' },
      { name: 'artistNote', description: 'Only used in edit_image mode as an image edit instruction.' },
    ],
    template: `{{storyboardPrompt}}

{{editImageMode ? "Artist image edit note:\\n" + artistNote + (artistReferenceImage ? "\\nArtist attached an additional refinement reference image. Use it as guidance for the requested change only; preserve the locked cast, environment, style refs, and saved cut plan." : "") : ""}}`,
    source: { file: 'server/services/storyboard.ts', lines: 'generateStoryboardVersion / renderWithProvider' },
  },
  {
    id: 'seedance-storyboard-refine',
    name: 'Refine Seedance storyboard',
    stage: 'studio',
    model: 'project.text_provider (refine tier) OR storyboard image provider',
    modelLabel: 'Redo = text-provider refine model (Sonnet/GPT-5.5/Gemini Flash); Edit = project storyboard_provider',
    triggeredBy: "Fires when you enter a natural-language note and click 'Refine' in storyboard mode.",
    summary: 'Refine has two modes. Redo (replan) routes through project.text_provider (cheap refine sibling) to rewrite saved storyboardPrompt + cutPlanText; the artist must click Generate after to render a new image. Edit (edit_image) calls the project storyboard_provider directly with the previous storyboard image + the saved prompt + the artist note — text fields untouched. Edit prompt does NOT include the cut plan (image renderer does not use it).',
    variables: [
      { name: 'artistNote', description: 'Natural-language refinement note (required, route 400s if empty)' },
      { name: 'refineMode', description: 'replan or edit_image' },
      { name: 'currentPrompt', description: 'Saved storyboardPrompt (used in both modes — as revision context for replan, as base prompt for edit_image)' },
      { name: 'currentCutPlan', description: 'Saved storyboard_cut_plan (replan only — Edit does not send this)' },
      { name: 'baseStoryboardPrompt', description: 'Canonical source brief for this shot (replan only)' },
      { name: 'referenceImages', description: 'replan: only the artist-attached refinement ref is sent (planner is treated as text-only). edit_image: previous storyboard image (prepended), locked style/cast/env refs filtered by shot.excluded_refs.storyboard, then artist-attached ref (appended).' },
      { name: 'artistReferenceImage', description: 'Optional image uploaded with the refine note' },
    ],
    template: `REDO / replan mode (planner — rewrites text fields):
Rewrite the saved storyboard render prompt and cut plan using the artist note.

Artist note:
{{artistNote}}

Current storyboard render prompt:
{{currentPrompt}}

Current cut plan:
{{currentCutPlan}}

Original source brief:
{{baseStoryboardPrompt}}

---

EDIT / edit_image mode (image provider — renders a new image):
{{currentPrompt}}

Artist image edit note:
{{artistNote}}
{{artistReferenceImage ? "\\nArtist attached an additional refinement reference image. Use it as guidance for the requested change only; preserve the locked cast, environment, style refs, and saved cut plan." : ""}}`,
    source: { file: 'server/routes/generate-shots.ts + server/services/storyboard.ts', lines: 'refine-storyboard / writeStoryboardPrompt / generateStoryboardVersion' },
  },
  {
    id: 'shot-start-frame',
    name: 'Shot start frame',
    stage: 'studio',
    model: 'gemini-3-pro-image-preview',
    modelLabel: 'Gemini 3 Pro Image',
    triggeredBy: "Fires when you click the frame icon on a shot or 'Generate all frames'.",
    summary: "Generates the shot's start frame using the full reference chain: characters → style → environment → continuity.",
    variables: [
      { name: 'visualPrompt', description: "Shot's visual prompt" },
      { name: 'styleImage', description: 'Locked style ref' },
      { name: 'characterRefs', description: 'One per cast member' },
      { name: 'environmentRef', description: "Locked environment ref if shot has one" },
      { name: 'prevShotEndFrame', description: 'Previous shot extracted last frame (if continuity = prev_shot)' },
      { name: 'continuityDescription', description: 'Text description of previous frame' },
      { name: 'userFeedback', description: 'Optional director note on regen' },
      { name: 'failedImage', description: 'Previous failed attempt (on regen with feedback)' },
    ],
    template: `Scene: {{visualPrompt}}

Preserve character identity from character references. Match environment from environment reference. Match the visual style EXACTLY from the style reference image — the style image is the ground truth.

(Style DNA text REMOVED — Gemini matches style image directly.)

Reference chain (numbered images):
  Image 1..N = Character: {name}
  Image N+1 = Style reference
  Image N+2 = Environment reference
  Image N+3 = Continuity reference (if prev_shot)
  Image N+4 = PREVIOUS ATTEMPT (if regen with feedback)

Priority: character identity > continuity > environment > style.`,
    source: { file: 'server/services/imagen.ts', lines: '366-435' },
  },
  {
    id: 'refine-frame-prompt',
    name: 'Refine frame prompt (first frame, end frame, character look, env look)',
    stage: 'studio',
    model: 'claude-sonnet-4-6',
    modelLabel: 'Claude Sonnet 4.6 (vision)',
    triggeredBy: 'Fires when you click Refine on First frame or Last frame tab, or refine a character/env look.',
    summary: 'Director says what to change, Claude applies it to the current prompt. No scene/style/character context — just feedback + current prompt + optional images.',
    variables: [
      { name: 'feedback', description: 'What the director wants changed' },
      { name: 'currentPrompt', description: 'The prompt being rewritten' },
      { name: 'failedImage', description: 'The result from the current prompt (optional)' },
      { name: 'referenceImage', description: 'Director\'s reference image (optional)' },
    ],
    template: `WHAT THE DIRECTOR WANTS CHANGED:
{{feedback}}

Image 1: result from current prompt. Image 2: director's reference (if attached).

CURRENT PROMPT:
{{currentPrompt}}

Apply the feedback. Keep what works. 1-3 sentences.

Output via rewrite_frame_prompt tool: { visualPrompt }`,
    source: { file: 'server/services/claude.ts', lines: 'refineFramePrompt' },
  },
  {
    id: 'refine-video-prompt',
    name: 'Refine video/motion prompt',
    stage: 'studio',
    model: 'claude-sonnet-4-6',
    modelLabel: 'Claude Sonnet 4.6 (vision)',
    triggeredBy: "Fires when you click 'Refine' on the Video tab.",
    summary: 'Director says what to change about the animation. Claude rewrites the motion prompt. Sees start frame + end frame + shot description — no style/scene/character context.',
    variables: [
      { name: 'feedback', description: 'What the director wants changed' },
      { name: 'currentMotionPrompt', description: 'Current video instruction' },
      { name: 'shotVisualPrompt', description: 'What happens in this shot (context)' },
      { name: 'startFrame', description: 'Start frame image (context, not a failure)' },
      { name: 'endFrame', description: 'End frame image (optional — where shot should land)' },
      { name: 'referenceImage', description: 'Director\'s reference image (optional)' },
    ],
    template: `WHAT THE DIRECTOR WANTS CHANGED:
{{feedback}}

Image 1: start frame. Image 2: end frame (if exists). Image 3: director ref (if attached).

WHAT HAPPENS IN THIS SHOT:
{{shotVisualPrompt}}

CURRENT MOTION PROMPT:
{{currentMotionPrompt}}

Apply the feedback. 1-2 sentences, action + camera.

Output via rewrite_motion_prompt tool: { motionPrompt }`,
    source: { file: 'server/services/claude.ts', lines: 'refineMotionPrompt' },
  },
  {
    id: 'refine-concept',
    name: 'Refine locked concept',
    stage: 'blueprint',
    model: 'claude-sonnet-4-6',
    modelLabel: 'Claude Sonnet 4.6',
    triggeredBy: "Fires when you click 'Refine' on the locked concept.",
    summary: 'Revises the locked concept using director feedback. Composed via composePrompt; user note (the feedback) is applied surgically — preserve locked fields, touch only what the note addresses. Concept stays story/brief-level; style and medium are decided later.',
    variables: [
      { name: 'lockedConcept', description: 'Current locked concept JSON' },
      { name: 'feedback', description: 'Director feedback — flows into USER NOTE' },
      { name: 'workflowContext', description: 'Human-readable production-spine context' },
      { name: 'presetTaste', description: 'preset.concept.rules — concept-layer rules only; no style/medium content' },
      { name: 'userNotePolicy', description: 'Surgical-application policy: touch only addressed fields, preserve locked fields, refuse layer-violating notes' },
    ],
    template: `Revise the locked concept using the director's feedback.

This is a refinement, not a replacement — preserve the core identity. Update only the fields the feedback addresses; leave the rest unchanged.

Visual style, palette, and cinematography belong to later phases. Do not introduce art-style language, camera directions, or color palette here.

CONTEXT
{{workflowContext}}

INPUTS
{{Current concept: title, subject, mood, theme, conceptDirection, description}}

TASTE
{{preset.concept.rules}}

USER NOTE POLICY
{{Apply surgically. Touch only fields addressed by the note. Preserve locked fields. Refuse style/medium asks at this layer and translate to concept-layer intent.}}

Return refined concept as JSON. Fields not addressed by the feedback carry forward unchanged.

USER NOTE
{{feedback}}`,
    source: { file: 'server/prompts/concept.ts', lines: 'buildRefineConceptPrompt' },
  },
  {
    id: 'refine-script',
    name: 'Refine script (surgical edit)',
    stage: 'blueprint',
    model: 'claude-opus-4-7',
    modelLabel: 'Claude Opus 4.7',
    triggeredBy: "Fires when you click 'Refine script' and enter feedback.",
    summary: 'Composed via composePrompt. Surgically refines the existing script using director feedback (user note). Preserve scenes/shots not addressed, do not rename existing cast/environments (their names are IDs downstream), keep source structure. Extended thinking + validation loop reruns on shot-count/duration violations. Standard mode: ceil(scene_duration / pacing) shots per scene. Seedance storyboard mode: 4-15s clips that sum to scene duration.',
    variables: [
      { name: 'currentScript', description: 'Full current script (cast, environments, scenes with shots)' },
      { name: 'feedback', description: 'Director feedback — flows into USER NOTE' },
      { name: 'concept', description: 'Locked concept' },
      { name: 'workflowContext', description: 'Human-readable production-spine context' },
      { name: 'presetTaste', description: 'preset.script.sceneRules + planner identity' },
      { name: 'userNotePolicy', description: 'Surgical-application policy: preserve unchanged scenes, do not rename cast/environments' },
      { name: 'sourceText', description: 'Lyrics (music_led) or script excerpt (scripted_narrative)' },
      { name: 'meaning', description: 'Meaning / director brief' },
      { name: 'musicalStructure', description: 'Sections with timestamps' },
      { name: 'basePacing', description: 'Shot duration in seconds' },
      { name: 'minShotDuration', description: 'Video model minimum clip length' },
      { name: 'videoModel', description: 'Seedance triggers storyboard-clip duration rules' },
    ],
    template: `Refine the existing production script using the director's feedback.

This is SURGICAL refinement, not rewriting from scratch. Think editor, not new writer.

CONTEXT
{{workflowContext}}

INPUTS
{{Concept, source text, meaning, structure, pacing guidance (Seedance or standard), current script JSON}}

TASTE
{{preset.script.sceneRules + planner identity}}

USER NOTE POLICY
{{Preserve unchanged scenes/shots exactly. Do not rename existing cast/environments — they are IDs. Every shot keeps castNames + environmentName. Refuse style/medium asks at this layer.}}

Return the COMPLETE updated script using the plan_music_video tool — all scenes, not just the changed ones. The system replaces the old script entirely with your output.

USER NOTE
{{feedback}}`,
    source: { file: 'server/prompts/refineScript.ts', lines: 'buildRefineScriptPrompt' },
  },
  {
    id: 'chained-shot-refresh',
    name: 'Chained-shot refresh (prev-frame grounded)',
    stage: 'studio',
    model: 'claude-sonnet-4-6',
    modelLabel: 'Claude Sonnet 4.6 (vision)',
    triggeredBy: 'Fires automatically after a shot\'s video lands, when the next shot is tagged "prev_shot".',
    summary: "Claude sees the extracted last frame and rewrites the next shot's prompts so continuity flows from what actually happened while preserving the shot's intended beat. Skipped in Seedance storyboard mode, where shots do not wait on previous frames.",
    variables: [
      { name: 'prevFrame', description: "Extracted last frame of the previous shot's video" },
      { name: 'shotDirection', description: "Next shot's preserved intent / beat" },
      { name: 'currentVisualPrompt', description: "Next shot's draft visual prompt" },
      { name: 'currentMotionPrompt', description: "Next shot's draft motion prompt" },
      { name: 'characterNames', description: 'Character names (for prompt references)' },
      { name: 'environmentName', description: 'Environment name (optional)' },
    ],
    template: `The image is the last frame of the previous shot.

The next shot was drafted before this frame existed. Rewrite its prompts so they flow from what actually happened while honoring the shot's intent.

SHOT INTENT:
{{shotDirection}}

DRAFT PROMPTS (rewrite these):
Visual: {{currentVisualPrompt}}
Motion: {{currentMotionPrompt}}
{{characterNames ? "Characters: " + characterNames : ""}}
{{environmentName ? "Environment: " + environmentName : ""}}

Keep the shot intent. Rewrite so the first moment matches the frame — same characters, same state, natural continuation. Visual: 1-3 sentences. Motion: 1-2 sentences.`,
    source: { file: 'server/services/claude.ts', lines: 'refreshChainedShotPrompt' },
  },
  {
    id: 'shot-video-assembly',
    name: 'Shot video prompt (keyframe mode)',
    stage: 'studio',
    model: 'veo-3.1-* / seedance-2.0-*',
    modelLabel: 'Video model (Veo or Seedance)',
    triggeredBy: "Fires when you click the play icon on a shot or 'Generate all videos'.",
    summary: "Keyframe path: motionPrompt is the video instruction. Ref labels are appended only when character/env reference images are actually attached. Artist can override via the Video prompt tab. Storyboard mode uses the separate Seedance storyboard video prompt.",
    variables: [
      { name: 'motionPrompt', description: "Shot's video instruction (action + camera)" },
      { name: 'refLabels', description: 'Auto-appended when ref images attached, e.g. "Maintain Priya\'s appearance from reference"' },
    ],
    template: `{{motionPrompt}}. {{refLabels}}`,
    source: { file: 'server/routes/generate-video.ts', lines: 'Veo prompt builder in generate-video endpoint' },
  },
  {
    id: 'seedance-storyboard-video',
    name: 'Seedance video from locked storyboard',
    stage: 'studio',
    model: 'seedance-2.0-*',
    modelLabel: 'Seedance 2.0 via Segmind',
    triggeredBy: "Fires when you click 'Generate video' in the Storyboard panel's Video sub-tab.",
    summary: 'Builds the Seedance prompt around @image1 as the locked ordered storyboard, @image2+ as locked consistency refs, and the saved cut plan as the motion/edit guide.',
    variables: [
      { name: 'storyboardImage', description: '@image1, the locked storyboard grid' },
      { name: 'referenceImages', description: '@image2+ locked style, character, and environment identity anchors' },
      { name: 'rows', description: 'Storyboard grid rows (2 for both sizes today)' },
      { name: 'cols', description: 'Storyboard grid columns (2 for clips <10s, 3 for clips ≥10s)' },
      { name: 'cutPlanText', description: 'Saved shot progression text from the active storyboard version' },
      { name: 'clipDuration', description: 'Seedance clip duration, 4-15s' },
      { name: 'mood', description: 'Mood word from the project (e.g. contemplative)' },
      { name: 'musicalCue', description: 'Pacing cue from audio analysis, optional' },
      { name: 'clipDirection', description: 'Exact shot direction for this clip' },
      { name: 'lipsyncEnabled', description: 'Per-shot toggle; when true the shot audio slice is sent as audio 1 for subtle visible vocal lip-sync' },
    ],
    template: `(Trimmed from ~80 lines to ~10 — the old "animation contract" + 24fps quality boilerplate confused Seedance more than it helped.)

Animate the storyboard @image1 into one {{clipDuration}}s clip. Follow the panels left-to-right, then top-to-bottom, as one continuous edited shot.

Shot: {{clipDirection}}

{{refBindings ? "Identity refs (do not redesign):\\n" + refBindings : ""}}
{{cutPlanText ? "\\nPanel beats:\\n" + cutPlanText : ""}}
{{lipsyncEnabled ? "\\nLip-sync: audio 1 is the song segment — use it only as visual timing reference for mouth movement on clearly-visible singing faces. Do not generate or preserve audio. Faces turned away or instrumental moments: keep mouth natural." : ""}}

Preserve character identity (face, body, costume, jewelry) and environment geometry across the whole animation — match the locked references throughout, do not let them drift between panels.

Do not render text, panel borders, numbers, gutters, or split-screen artifacts from the board into the video.`,
    source: { file: 'server/services/seedance-storyboard-rd.ts', lines: 'buildSeedanceStoryboardVideoPrompt (board_plus_timing variant)' },
  },

  // ─── Utilities ────────────────────────────────────────────────────
  {
    id: 'critique-shot-image',
    name: 'Critique shot image',
    stage: 'utilities',
    model: 'gemini-3-pro-preview',
    modelLabel: 'Gemini 3 Pro (vision)',
    triggeredBy: 'Fires automatically after a shot frame lands — scores + suggests fixes.',
    summary: 'Scores the image 0-10 on style adherence, prompt fidelity, character consistency, technical quality; returns specific actionable suggestions.',
    variables: [
      { name: 'image', description: 'The generated image' },
      { name: 'referenceImages', description: 'Character refs' },
      { name: 'compiledPrompt', description: 'The prompt that produced this image' },
      { name: 'styleDNA', description: 'Locked style keywords' },
    ],
    template: `You are a meticulous Art Director reviewing this generated image for a video project.

SCORING RUBRIC (0-10):
  9-10: Publication ready. Style is spot-on, characters are recognizable, composition is compelling.
  7-8:  Strong result with minor issues — slight color drift, a small costume detail off, minor composition weakness.
  5-6:  Mediocre. Noticeable style mismatch, character inconsistency, or weak composition. Needs rework.
  3-4:  Poor. Major problems — wrong style, unrecognizable characters, bad anatomy, or broken composition.
  0-2:  Failed. Completely off-brief or technically broken.

EVALUATE THESE CRITERIA (weighted):

1. STYLE ADHERENCE (40%): Does the image match the locked visual style?
2. PROMPT FIDELITY (30%): Does the image faithfully depict the prompt?
3. CHARACTER CONSISTENCY (20% if refs present): Do characters match their references?
4. TECHNICAL QUALITY (10-30%): Artifacts, anatomy, lighting, noise.

Return JSON with score, reasoning, isConsistent, suggestions. "suggestions" must be specific + actionable.`,
    source: { file: 'server/services/gemini.ts', lines: '136-201' },
  },
  {
    id: 'describe-frame',
    name: 'Describe frame (continuity)',
    stage: 'utilities',
    model: 'gemini-3-pro-preview',
    modelLabel: 'Gemini 3 Pro (vision)',
    triggeredBy: "Fires when building continuity description for a chained shot.",
    summary: 'Short factual description of a video frame — subject pose, framing, lighting, action mid-beat — like a script supervisor note.',
    variables: [
      { name: 'image', description: 'The video frame' },
    ],
    template: `Describe this single video frame factually for shot continuity. 2-3 sentences max.
Focus on: subject position/pose/expression, camera framing + angle, lighting mood, what action is mid-motion.
Do NOT speculate about narrative or use flowery language. Write like a script supervisor noting continuity.`,
    source: { file: 'server/services/gemini.ts', lines: '210-224' },
  },
  {
    id: 'analyze-image-style',
    name: 'Analyze uploaded style image',
    stage: 'utilities',
    model: 'claude-sonnet-4-6',
    modelLabel: 'Claude Sonnet 4.6 (vision)',
    triggeredBy: 'Fires when you upload a reference image in the Style phase.',
    summary: 'Extracts a 2-3 sentence style fragment from a user-supplied reference image for downstream image gen.',
    variables: [
      { name: 'image', description: 'The uploaded reference image' },
    ],
    template: `Analyze this image and describe its "Art Style" in detail. Return a concise prompt fragment (2-3 sentences) covering: lighting, color palette, texture/medium, composition, mood. Be concrete and specific — this will be used as an image generation style reference.

Return ONLY the style fragment text. No quotes, no JSON, no markdown.`,
    source: { file: 'server/services/claude.ts', lines: '565-585' },
  },
  {
    id: 'chat-with-director',
    name: 'Chat with director',
    stage: 'utilities',
    model: 'gemini-3-pro-preview',
    modelLabel: 'Gemini 3 Pro',
    triggeredBy: 'Fires when you send a message in the Chat panel.',
    summary: 'Answers questions about prompts and pipeline with the project analysis context in view.',
    variables: [
      { name: 'analysisContext', description: 'Project analysis (concept, script, style summary)' },
      { name: 'userMessage', description: 'Your message' },
      { name: 'history', description: 'Prior chat turns' },
    ],
    template: `Context: {{analysisContext}}

User Message: {{userMessage}}. (Provide advice on prompts)`,
    source: { file: 'server/services/gemini.ts', lines: '228-242' },
  },
];

export const STAGE_META: Record<PromptStage, { label: string; description: string; order: number }> = {
  audio:      { label: 'Audio',      description: 'Lyrics, structure, and meaning — fires once at project creation.', order: 1 },
  blueprint:  { label: 'Blueprint',  description: 'Concept, script, and style direction — the creative decisions.',   order: 2 },
  looks:      { label: 'Looks',      description: 'Character and environment reference images — 3 parallel each.',    order: 3 },
  studio:     { label: 'Studio',     description: 'Per-shot work: prompt writing, frames, refine, and video.',        order: 4 },
  utilities:  { label: 'Utilities',  description: 'Vision critique, continuity describe, style extract, chat.',        order: 5 },
};
