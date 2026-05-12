/**
 * Prompt catalog — the read-only reference for every AI prompt in the pipeline.
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

  // ─── Blueprint ────────────────────────────────────────────────────
  {
    id: 'generate-concepts',
    name: 'Generate concept directions',
    stage: 'blueprint',
    model: 'claude-opus-4-7',
    modelLabel: 'Claude Opus 4.7',
    triggeredBy: "Fires when you click 'Generate concept' on the Concept phase.",
    summary: 'Proposes 3 creative directions adapted to the song type. Receives songType + isNarrative + isMeditative from audio analysis — no hardcoded direction labels.',
    variables: [
      { name: 'title', description: 'Song title' },
      { name: 'language', description: 'Song language' },
      { name: 'lyrics', description: 'Full lyrics (truncated to 4000 chars)' },
      { name: 'meaning', description: 'Meaning summary' },
      { name: 'musicalStructure', description: 'Human-readable section summary' },
      { name: 'songType', description: 'Audio classification: stotra/chant/bhajan/kirtan/song/unknown' },
      { name: 'isNarrative', description: 'Has dramatic arc?' },
      { name: 'isMeditative', description: 'Contemplative/inward?' },
      { name: 'context', description: 'Optional song context' },
      { name: 'userNote', description: 'Optional director note to steer the concepts' },
    ],
    template: `You are a visionary film director specializing in Indian mythological and devotional cinema.

SONG: {{title}} ({{language}})
SONG TYPE (from audio analysis): {{songType}}, {{traits}}

MUSICAL STRUCTURE:
{{musicalStructure}}

LYRICS:
{{lyrics}}

MEANING:
{{meaning}}
{{userNote ? "DIRECTOR NOTE (must follow): " + userNote : ""}}

Generate EXACTLY 3 creative directions for a music video. Each should offer a genuinely different visual approach, but all must respect the song's nature — read the SONG TYPE and MEANING carefully.`,
    source: { file: 'server/services/claude.ts', lines: 'generateConceptOptions' },
  },
  {
    id: 'plan-scenes',
    name: 'Plan script (cast, environments, scenes, shots)',
    stage: 'blueprint',
    model: 'claude-opus-4-7',
    modelLabel: 'Claude Opus 4.7',
    triggeredBy: "Fires when you click 'Generate script' on the Script phase.",
    summary: 'Plans the full video structure — cast list, environments, scenes aligned to musical sections, and shot directions. Uses song type + meditative/narrative signals to keep devotional songs from drifting into generic plot logic.',
    variables: [
      { name: 'videoMode', description: '"montage" or "cinematic"' },
      { name: 'videoModel', description: 'Selected video model; Seedance enables storyboard-clip pacing rules' },
      { name: 'concept', description: 'Locked concept (deity, direction, theme, expanded description, mood)' },
      { name: 'lyrics', description: 'Full lyrics' },
      { name: 'meaning', description: 'Meaning summary' },
      { name: 'musicalStructure', description: 'Sections with timestamps' },
      { name: 'pacing', description: 'Shot duration in seconds (default 8)' },
      { name: 'minShotDuration', description: 'Video model minimum clip length (e.g. 4s for Veo Standard, 8s for Veo Fast)' },
      { name: 'songType', description: 'Audio classification: stotra/chant/bhajan/kirtan/song/unknown' },
      { name: 'isNarrative', description: 'Has dramatic arc?' },
      { name: 'isMeditative', description: 'Contemplative/inward?' },
      { name: 'userNote', description: 'Optional director note' },
    ],
    template: `You are a music video director. Your job is to plan the STRUCTURE — cast, locations, scenes, and what happens in each shot. A cinematographer will later decide framing and camera work, so focus on WHAT HAPPENS, not how the camera moves.

DIRECTOR STYLE:
- Montage: "rhythmic, many discrete moments, broader coverage of the emotional and spiritual world."
- Cinematic: "fewer, more sustained moments, stronger continuity, deeper immersion."

SONG TYPE (from audio analysis): {{songType}}, {{traits}}

CONCEPT:
Deity/subject: {{concept.deity}}
Direction: {{concept.conceptDirection}}
Core idea: {{concept.theme}}
Expanded brief: {{concept.description}}
Mood: {{concept.mood}}

[lyrics, meaning, musical structure injected]

═══ PACING RULES (extended thinking reasons through this) ═══
Base shot length: {{pacing}} seconds.
For each scene: number_of_shots = ceil(scene_duration / {{pacing}})
Every shot is {{pacing}}s except the LAST shot which gets the remainder.
Example: 21s at 8s → ceil(21/8) = 3 shots (8+8+5).
Video model min clip: {{minShotDuration}}s — shorter shots get generated at model floor and trimmed in render.

SEEDANCE STORYBOARD PACING (when videoModel starts with "seedance"):
- A Lahari shot is one storyboard-controlled clip, not one continuous camera take.
- Each shot may contain internal cuts and angles, but it must stay one clear story/music idea.
- Prefer 15s when the phrase supports a real mini-scene.
- Allowed range: 4-15s. Use 4-8s only for short transitions or quick devotional responses.
- Shot durations inside each scene must add exactly to the scene duration.
- direction should be a practical edited beat sequence that a storyboard can show.
═══════════════════════════════════════════════════════════════

Uses extended thinking (8K budget) so Claude reasons through pacing math.
Validation loop: enforces EXACT shot count per scene (not just max).
Errors sent back as tool_result for self-correction (max 3 attempts).

CAST rules: reusable physical identity — face, skin, costume, ornaments.
No actions, no props in hands (these are for reference portraits, not scenes).
SCENE rules:
- Each shot direction should describe WHAT HAPPENS in the moment, not framing or camera movement
- Good: "Ganesha receives the offering, his expression softens"
- Good: "Devotee prostrates before the idol, hands trembling"
- Good: "Each sacred name reveals a different facet of Ganesha's presence in the temple space"
- Good: "The devotee's offering becomes the bridge between human longing and divine grace"
- Bad: "Slow dolly in on Ganesha"
- Bad: "Wide establishing shot of temple"
{{isMeditative ? "- For meditative/devotional pieces: prefer revelation, invocation, darshan, ritual progression, symbolic manifestation, and contemplative presence over plot twists or problem-solution arcs." : ""}}
- Avoid mechanical alternation between two visual worlds unless the song truly demands it
- Not every sacred name or attribute needs a literal illustration
- Avoid generic mystical spectacle by default: floating symbols, cosmic particles, glowing script, abstract energy fields
- Build progression across the scene: invocation -> deepening presence -> surrender`,
    source: { file: 'server/services/claude.ts', lines: 'planScenes' },
  },
  {
    id: 'plan-scenes-openai',
    name: 'Plan script (GPT-5.5 experiment)',
    stage: 'blueprint',
    model: 'gpt-5.5',
    modelLabel: 'GPT-5.5 (Responses structured output)',
    triggeredBy: 'Experimental script generation path when scriptProvider/openai runtime flag is selected.',
    summary: 'Alternative script planner tuned to be practical and shootable, with the same cast/environment/scene/shot JSON contract and validation loop as the Claude planner.',
    variables: [
      { name: 'videoMode', description: '"montage" or "cinematic"' },
      { name: 'videoModel', description: 'Selected video model; Seedance enables storyboard-clip pacing rules' },
      { name: 'concept', description: 'Locked concept (deity, direction, theme, expanded description, mood)' },
      { name: 'lyrics', description: 'Full lyrics' },
      { name: 'meaning', description: 'Meaning summary' },
      { name: 'musicalStructure', description: 'Sections with timestamps' },
      { name: 'pacing', description: 'Base shot duration for keyframe mode' },
      { name: 'minShotDuration', description: 'Video model minimum clip length' },
      { name: 'songType', description: 'Audio classification: stotra/chant/bhajan/kirtan/song/unknown' },
      { name: 'isNarrative', description: 'Has dramatic arc?' },
      { name: 'isMeditative', description: 'Contemplative/inward?' },
      { name: 'userNote', description: 'Optional director note' },
    ],
    template: `You are the practical script planner for Lahari, an AI music-video tool for devotional songs.

Your job is production structure: cast, reusable locations, scenes, and what physically happens in each shot.
Write for assets that artists can actually generate and storyboard. Be concrete, calm, and shootable.

Do not write pompous poetry. Do not use vague phrases like "divine grace flows", "cosmic energy blooms", or "the universe awakens" unless you translate them into visible human action, ritual action, or a simple physical image.
Do not include camera directions, lens choices, color palette, art style, rendering language, or overbuilt fantasy architecture in the script. Storyboard and cinematography steps happen later.
Avoid impossible crowds, dozens of extras, elaborate VFX, and prop chaos unless the song explicitly demands it.

DIRECTOR STYLE: {{videoMode}}
SONG TYPE: {{songType}}, {{traits}}

CONCEPT:
Deity/subject: {{concept.deity}}
Direction: {{concept.conceptDirection}}
Core idea: {{concept.theme}}
Expanded brief: {{concept.description}}
Mood: {{concept.mood}}

LYRICS:
{{lyrics}}

MEANING:
{{meaning}}

MUSICAL STRUCTURE:
{{musicalStructure}}

{{videoModel startsWith seedance ? "
SEEDANCE STORYBOARD PACING:
- A Lahari shot is one storyboard-controlled clip, not one continuous camera take.
- Each shot may contain internal cuts and angles, but it must be one clear story/music idea.
- Prefer 15s when the phrase supports a real mini-scene.
- Allowed range: 4-15s. Use 4-8s only for short transitions or quick devotional responses.
- Shot durations inside each scene must add exactly to the scene duration.
- direction should be a practical edited beat sequence that a storyboard can show.
" : "
STANDARD PACING:
- Base shot length is {{pacing}}s.
- For each scene, write exactly ceil(scene_duration / {{pacing}}) shots.
- The app will assign deterministic durations later.
- Video model minimum clip length is {{minShotDuration}}s.
"}}

Return only JSON matching the strict schema.

CAST:
- Include only characters actually needed.
- Include the deity and key human figures by proper names.
- Descriptions are neutral reusable reference identities: physical appearance, cultural identity, costume, ornaments. No action, no props in hands, no art style.

ENVIRONMENTS:
- Use 2-3 reusable locations unless the song truly needs more.
- Descriptions are physical spaces only: landscape/architecture/scale/atmosphere. No art style.

SCENES:
- Follow musical structure timestamps exactly.
- narrativeDescription is plain and concrete, 1-2 sentences.
- Every shot must have environmentName from your environment list.
- Every visible character must be in castNames.
- direction = what happens in the clip. In Seedance mode it can be 2-5 internal beats, but keep one coherent clip idea.`,
    source: { file: 'server/services/openai-script.ts', lines: 'buildPrompt' },
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
      { name: 'lyrics', description: 'Full lyrics (truncated to 3000 chars)' },
      { name: 'meaning', description: 'Meaning summary (1500 chars)' },
      { name: 'scriptSummary', description: 'Optional script summary once it exists' },
      { name: 'songType', description: 'Audio classification: stotra/chant/bhajan/kirtan/song/unknown' },
      { name: 'isNarrative', description: 'Has dramatic arc?' },
      { name: 'isMeditative', description: 'Contemplative/inward?' },
      { name: 'userNotes', description: 'Optional preference for all 4 variations' },
    ],
    template: `You are a Director of Photography designing the visual language for an Indian devotional music video.

The audience is Indian. The imagery must feel culturally authentic, not generic fantasy.
These descriptions will be used as prompts for Gemini image generation.

SONG: {{concept.deity}} — {{concept.theme}}
Mood: {{concept.mood}}
Language: {{concept.language}}
{{songType || traits ? "SONG TYPE: " + [songType, traits].filter(Boolean).join(", ") : ""}}

LYRICS:
{{lyrics}}

MEANING:
{{meaning}}

{{scriptSummary ? "SCRIPT OVERVIEW:\\n" + scriptSummary : ""}}
{{userNotes ? "USER DIRECTION: All 4 must be variations within this preference:\\n" + userNotes : ""}}

Propose 4 distinct visual style directions using the propose_style_directions tool.

Each direction must produce a visibly different reference image: vary color temperature, medium/rendering approach, lighting behavior, and artistic/cultural reference.
Do not let all four directions collapse into warm, dark, temple-chiaroscuro variants.
Photographic, painterly, illustrated, miniature-inspired, or mixed-media directions are all welcome if specific and culturally respectful.

For each: a title (2-5 words) and description (2 short punchy sentences, concrete and compact).

Description covers ONLY transferable visual treatment: lighting, color palette, texture/medium, cultural references.
Do NOT describe characters, scenes, environments, or narrative.
These descriptions will be used as image generation prompts — be concrete, not literary.

QUALITY GUIDELINES for the image generation downstream:
- Avoid overly AI/CGI/fantasy look — should feel cinematic or painterly, grounded and intentional
- Avoid excessive intricate details that muddy the image — every element should have clear intention
- If stylized, it should be tasteful and deliberate, not generic digital art or AI slop
- Think intentional reference image, not generic concept art`,
    source: { file: 'server/services/claude.ts', lines: 'brainstormStyleDirections' },
  },
  {
    id: 'refine-style-direction',
    name: 'Refine style direction',
    stage: 'blueprint',
    model: 'claude-sonnet-4-6',
    modelLabel: 'Claude Sonnet 4.6',
    triggeredBy: "Fires when you add feedback on a style direction and click 'Refine'.",
    summary: 'Revises one style direction using director feedback, kept cohesive, vivid, and concrete.',
    variables: [
      { name: 'currentDescription', description: 'Current direction text' },
      { name: 'feedback', description: 'Director feedback' },
      { name: 'concept', description: 'Locked concept (for mood/deity context)' },
    ],
    template: `You are an elite DP refining a visual direction based on feedback.

CURRENT DIRECTION:
{{currentDescription}}

CONTEXT:
- Deity/Subject: {{concept.deity}}
- Mood: {{concept.mood}}

USER FEEDBACK:
{{feedback}}

Revise the direction incorporating the feedback. Keep it cohesive and internally consistent. The description will be used as an image generation prompt — be vivid and concrete. Focus on visual STYLE, MOOD, and ATMOSPHERE — no character descriptions.

Use the refine_direction tool.`,
    source: { file: 'server/services/claude.ts', lines: '472-493' },
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
      { name: 'userRefImage', description: 'Optional director-supplied reference' },
      { name: 'userFeedback', description: 'Optional director note' },
    ],
    template: `Generate ONE cinematic character REFERENCE portrait. Match the visual style EXACTLY from Image 1.

{{character.name}} — {{character.description}}

{{userRefImage ? "Image 2 is a reference the director provided — match its identity. The style image (Image 1) is HOW to render them." : ""}}

This is a REUSABLE CHARACTER REFERENCE — used across many different shots and scenes.
- Mid-shot portrait: upper body and face clearly visible
- NEUTRAL POSE: hands relaxed, no props/weapons/lamps/offerings in hand
- Focus on: face, skin, expression, costume, ornaments, jewelry, crown, hair
- Plain or softly blurred background — character isolated for reuse

(Style DNA text REMOVED — Gemini matches the style image directly.)

One single image. No collage, no grid, no multiple panels. No text, no watermark.
Avoid: overly AI/CGI look, excessive intricate detail, generic fantasy.`,
    source: { file: 'server/services/imagen.ts', lines: '177-194' },
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
      { name: 'userRefImage', description: 'Optional director-supplied reference' },
      { name: 'userNote', description: 'Optional director note' },
    ],
    template: `Generate ONE cinematic environment shot. Match the visual style EXACTLY from Image 1. No characters or figures.

{{environment.name}} — {{environment.description}}

{{userRefImage ? "Image 2 is a reference — match its geography, architecture, mood. Style image (Image 1) is HOW it's rendered." : ""}}

Wide establishing shot, full environment visible, empty scene.

(Style DNA text REMOVED — Gemini matches the style image directly.)

One single image. No collage, no grid, no multiple panels. No text, no watermark.
Avoid: overly AI/CGI look, excessive intricate detail, generic fantasy.`,
    source: { file: 'server/services/imagen.ts', lines: '272-288' },
  },

  // ─── Studio ───────────────────────────────────────────────────────
  {
    id: 'write-shot-prompts',
    name: 'Write shot prompts (bulk)',
    stage: 'studio',
    model: 'claude-opus-4-7',
    modelLabel: 'Claude Opus 4.7',
    triggeredBy: "Auto-fires once at the end of Blueprint, or when you click 'Rewrite all' in Studio.",
    summary: 'Writes visual + motion prompts per shot plus a continuity tag (cut vs prev_shot). "Cinematic but renderable" — functional for AI models without being literary or schematic.',
    variables: [
      { name: 'shots', description: 'List of shots with id, direction, duration, cast, scene context' },
      { name: 'cast', description: 'Character descriptions' },
      { name: 'videoModel', description: 'Selected video model; adds Seedance-specific motion prompt guidance' },
      { name: 'songType', description: 'Audio classification: stotra/chant/bhajan/kirtan/song/unknown' },
      { name: 'isNarrative', description: 'Has dramatic arc?' },
      { name: 'isMeditative', description: 'Contemplative/inward?' },
      { name: 'concept', description: 'Used only for mood anchor' },
      { name: 'userNote', description: 'Optional director note' },
      { name: 'previousBatchTail', description: 'Tail of previous batch for continuity context' },
    ],
    template: `You are a cinematographer. The director planned what happens in each shot — you decide how it looks on screen and how it moves. Your outputs go directly to an image model (visualPrompt) and a video model (motionPrompt).

WRITE CINEMATIC PROMPTS THAT ARE RENDERABLE.

These prompts are for image and video models, so every sentence must describe something visible or animateable. Do not write poetry, metaphor, or inner emotion directly. Avoid phrases like "seems to", "as if", or invisible causes such as grace, breath, presence, warmth, or devotion. Describe the visible effect directly.

But do not become schematic. Avoid layout jargon like "left half", "right half", "split-focus", or "perfect symmetry" unless the shot truly depends on that exact arrangement.

Translate emotion into physical evidence:
- a still face
- a hand tightening
- a flame settling
- moisture on stone
- a body lowering into prostration
- distance between two figures

EXAMPLES — the boundary between renderable and not:

GOOD visualPrompt:
"Medium side shot: the devotee sits cross-legged before the stone murti, placing a brass lamp on the floor between them. The murti is mostly in shadow, with only the lower belly and trunk catching the lamplight."

GOOD visualPrompt:
"Low wide shot from the shrine floor: the devotee lies in full prostration in the foreground, forehead touching stone, while the Ganesha murti rises behind him in stillness. The brass lamp burns between them."

GOOD motionPrompt:
"Static hold as the devotee lowers his forehead to the floor; only the lamp flame moves."

GOOD motionPrompt:
"Slow push-in toward the murti's cheek as a bead of moisture begins to slide down the carved stone."

BAD visualPrompt:
"The devotee surrenders his ego before the timeless grace of the divine." — emotional interpretation, not renderable.

BAD visualPrompt:
"A symmetrical split-focus composition with the devotee on the left third and the murti on the right third." — schematic layout jargon unless the shot truly needs it.

BAD motionPrompt:
"The camera slowly dollies in to heighten the sacred atmosphere." — generic movement and non-visual rationale.

BAD motionPrompt:
"Golden divine energy fills the sanctum as cosmic particles swirl around Ganesha." — mystical VFX not grounded in the shot direction.

{{songType}}, {{traits}}
Mood: {{concept.mood}}
Video model: {{videoModel}}

CHARACTERS:
{{castList}}
{{userNote}}{{previousBatchTail}}
SHOTS TO WRITE:
{{shotList}}
{{videoModel startsWith seedance ? "
SEEDANCE 2.0 PROMPTING MODE:
- Think like a production storyboard: each motionPrompt should read as a timed action cue for this exact shot duration, not a loose mood sentence.
- Seedance follows explicit subject + motion + camera + timing well. Name the subject, the visible change, and the camera move in a clean order.
- Use each shot's listed duration when helpful: \"Over 5s...\" or \"During the final second...\" for holds, reveals, and beat hits.
- Lahari provides the finished song in render, and Segmind is called with generate_audio=false. Do NOT ask Seedance to generate music, voiceover, dialogue, or sound effects.
- You may reference the song rhythm visually: \"on the vocal phrase\", \"on the drum accent\", \"as the line resolves\", \"with the chant pulse\". Keep it visible and editorial.
- Keep camera choreography simple and physically plausible. Seedance rewards clear cuts, short moves, stable subjects, and consistency locks more than overloaded cinematic adjectives.
- If the start frame must stay consistent, say so positively: \"maintain the same face, costume, and temple geometry while...\"
- Avoid multi-shot language inside one Lahari shot unless the direction explicitly requires a transition. Lahari stitches separate clips later.
" : "
VIDEO MODEL PROMPTING MODE:
- The model gets a start frame and the final song is added in render, so the motionPrompt should describe visible action and camera motion only.
- Do not request generated audio, dialogue, subtitles, or sound effects.
"}}
{{meditativeGuidance}}
For EACH shot, write using the write_shot_prompts tool:

- visualPrompt: The start frame. Brief but complete: camera position, shot scale, subject placement, spatial relationship, location, and one key visible detail. The model already has character/environment/style reference IMAGES — do not describe art style or color palette. Do allow functional lighting when it defines the frame ("lamplight catches the carved cheek", "the face emerges from shadow"). Preserve the shot's real geography. Do not invent corridors, arches, rooms, props, or layouts not implied by the shot direction or environment.
  ONLY include characters listed in that shot's Cast field.

- motionPrompt: One sentence. The video model already SEES the start frame. Say only what changes: character action, camera movement, environmental motion, and visible timing against the song when useful. Name the camera verb when it moves (push-in, pan, tracking, pull-back). Prefer the simplest truthful motion. A static hold is valid when the beat is carried by stillness.

- continuityFrom: 'cut' or 'prev_shot'.
  Use 'prev_shot' when this shot directly intensifies, reveals, or sustains the previous shot's final moment — a gaze becoming a close-up, stillness cracking into recognition, a slow reveal continuing across an edit point.
  Use 'cut' when the shot begins a new beat, scale, angle, or emotional step.
  The first shot of a scene is ALWAYS 'cut'.

BEFORE RETURNING, CHECK THE SEQUENCE:
- No invented geography (corridors, archways, courtyards not in the direction)
- No repeated camera verb across consecutive shots
- No schematic composition shortcuts unless truly necessary (symmetrical two-shot, split-focus, left-third/right-third)
- No mystical VFX unless explicitly described in the shot direction
- At least consider 'prev_shot' for direct intensifications — don't default to all cuts
- Every shot must advance the devotional arc, not just restate the previous beat

Match the IDs exactly.`,
    source: { file: 'server/services/claude.ts', lines: 'writeShotPrompts' },
  },
  {
    id: 'seedance-storyboard-image',
    name: 'Write Seedance storyboard prompt',
    stage: 'studio',
    model: 'gpt-5.5',
    modelLabel: 'OpenAI Responses planner',
    triggeredBy: "Fires when you click 'Board prompts' or per-shot 'Write prompt' in Seedance storyboard mode.",
    summary: 'Text-only planner step. Converts one Seedance shot brief into two saved artifacts: storyboardPrompt for the image renderer and cutPlanText for Seedance video.',
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
      { name: 'artistNote', description: 'Optional rewrite/refine instruction' },
      { name: 'artistReferenceImage', description: 'Optional visual reference attached during refine' },
    ],
    template: `Convert the source brief below into two saved artifacts for a two-step storyboard workflow.

1. storyboardPrompt: the exact image-render prompt for a storyboard renderer. It should ask for one clean storyboard sheet, coherent cinematic panels, thin white panel borders acceptable, no captions or readable text inside panels, and no printed panel numbers unless absolutely unavoidable. It should include the reference-use rules and enough visual/camera detail for the renderer, but it must not ask the image model to explain itself.
2. cutPlanText: a text-only numbered cut plan with timestamps, camera, action, and Seedance motion cues. This text will later drive the video prompt.

Source brief:
Create a numbered cinematic storyboard for one Lahari devotional music-video clip.

Use a {{rows}}x{{cols}} grid ({{panelCount}} panels) read left-to-right, top-to-bottom. Clean white background, thin white borders, generous spacing between and around every panel. Editorial minimalist storyboard layout, professional pitch-deck style.

Song: {{title}}
Concept: {{concept}}
Mood: {{mood}}
Pacing cue from the music: {{musicalCue}}
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

Continuity notes: one short sentence naming the spatial map and screen direction you preserved.`,
    source: { file: 'server/services/storyboard.ts + server/services/seedance-storyboard-rd.ts', lines: 'writeStoryboardPrompt / buildStoryboardPrompt' },
  },
  {
    id: 'render-seedance-storyboard-image',
    name: 'Render Seedance storyboard image',
    stage: 'studio',
    model: 'gpt-image-2 / nano-banana-2',
    modelLabel: 'Storyboard image provider',
    triggeredBy: "Fires when you click 'Board images' or per-shot 'Generate storyboard' after a saved prompt exists. Bulk button regenerates already-rendered (unlocked) boards too.",
    summary: 'Image-only render step. Sends the saved storyboardPrompt to the selected storyboard provider with locked style/cast/environment refs. Cut plan is NOT sent — it is for the downstream Seedance video step only.',
    variables: [
      { name: 'storyboardPrompt', description: 'Saved image-render prompt on the shot. Only field required for image gen.' },
      { name: 'storyboardProvider', description: 'Project storyboard provider: gpt-image-2 or nano-banana-2' },
      { name: 'referenceImages', description: 'Locked style, cast, environment refs (filtered by shot.excluded_refs.storyboard). In edit_image refine mode, the previous storyboard image is prepended; an artist-attached refinement ref is appended last.' },
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
    model: 'gpt-5.5 planner or storyboard image provider',
    modelLabel: 'Redo = OpenAI planner; Edit = selected image provider',
    triggeredBy: "Fires when you enter a natural-language note and click 'Refine' in storyboard mode.",
    summary: 'Refine has two modes. Redo (replan) calls the planner to rewrite saved storyboardPrompt + cutPlanText; the artist must click Generate after to render a new image. Edit (edit_image) calls the image provider directly with the previous storyboard image + the saved prompt + the artist note — text fields untouched. Edit prompt does NOT include the cut plan (image renderer does not use it).',
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
    summary: 'Claude rewrites concept fields (theme, mood, conceptDirection) based on feedback while preserving deity and title.',
    variables: [
      { name: 'lockedConcept', description: 'Current locked concept JSON' },
      { name: 'feedback', description: 'Director feedback' },
    ],
    template: `Refine the locked concept based on feedback. Keep deity and title.
Rewrite: theme, mood, conceptDirection. Output via tool.`,
    source: { file: 'server/services/claude.ts', lines: 'refineConceptDirection' },
  },
  {
    id: 'refine-script',
    name: 'Refine script (surgical edit)',
    stage: 'blueprint',
    model: 'claude-opus-4-7',
    modelLabel: 'Claude Opus 4.7',
    triggeredBy: "Fires when you click 'Refine script' and enter feedback.",
    summary: 'Claude Opus surgically edits the existing script based on feedback. Uses extended thinking + validation loop for standard pacing or Seedance storyboard clip durations.',
    variables: [
      { name: 'currentScript', description: 'Full current script (cast, environments, scenes with shots)' },
      { name: 'feedback', description: 'Director feedback' },
      { name: 'concept', description: 'Locked concept' },
      { name: 'lyrics', description: 'Full lyrics' },
      { name: 'musicalStructure', description: 'Sections with timestamps' },
      { name: 'pacing', description: 'Shot duration in seconds' },
      { name: 'minShotDuration', description: 'Video model minimum clip length (e.g. 4s for Veo Standard, 8s for Veo Fast)' },
      { name: 'videoModel', description: 'Selected video model; Seedance enables storyboard-clip duration validation' },
    ],
    template: `Surgical refinement with 5 preservation rules. Extended thinking (8K budget) for pacing math.
Standard mode: shot counts must equal ceil(scene_duration / {{pacing}}); last shot gets the remainder.
Seedance storyboard mode: each shot is a 4-15s storyboard clip; shot durations must add exactly to the scene duration and each direction may describe 2-5 internal edited beats.
Validation loop: if shot counts or Seedance durations are wrong, errors are sent back as tool_result.
Same plan_music_video tool output.`,
    source: { file: 'server/services/claude.ts', lines: 'refineScript' },
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
    template: `Animate this {{rows}}×{{cols}} storyboard grid into one cohesive {{clipDuration}}s music-video clip. Follow @image1's panels left-to-right across each row, then continue to the next row.

@image1 is the source of truth for composition, blocking, screen direction, cut order, and camera progression. Do not render text, panel numbers, borders, gutters, or split-screen artifacts from the board into the video.

Reference bindings:
- @image1 = the locked storyboard grid
- @image2..N = locked style, character, and environment refs — identity anchors only
{{lipsyncEnabled ? "
Audio reference:
- audio 1 is the exact song segment for this clip. Use it only as a visual timing and lip-sync reference; do not generate or preserve audio.
- If a singing or chanting face is clearly visible in the storyboard progression, add subtle mouth movement aligned to audio 1's vocal phrasing.
- If the face is turned away, too small, obscured, or the passage is instrumental, keep the mouth natural and still. Do not invent dialogue or exaggerated mouth shapes.
" : ""}}

Song: {{title}}
Concept: {{concept}}
{{mood ? "Mood: {{mood}}" : ""}}
{{musicalCue ? "Musical pacing cue: {{musicalCue}}" : ""}}
Shot description: {{clipDirection}}
Clip duration: {{clipDuration}}s
Cast in clip: {{castNames}}
Environment: {{environmentName}}

Locked shot progression (motion and cut guide):
{{cutPlanText}}

Animation contract:
- Camera movement: simple and physically plausible — pushes, pulls, pans, tilts, rack-focus. No impossible swings or vertigo zooms unless the shot progression names them.
- Preserve character identity (face, body, costume, jewelry) and environment geometry across cuts to match the references.
- The storyboard composes; the references only anchor identity. Render only objects called for by the storyboard or the shot progression text.
- Soft slow-motion feel on emotional, singing, and dancing moments.
- Do not generate audio; the song is mixed separately.

Generate one cohesive {{clipDuration}}s edited clip with smooth cinematic camera movement. 24fps, masterpiece quality.`,
    source: { file: 'server/services/seedance-storyboard-rd.ts', lines: 'buildSeedanceStoryboardVideoPrompt' },
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
    template: `You are a meticulous Art Director reviewing this generated image for a devotional music video.

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
