/**
 * Prompt catalog — the read-only reference for every AI prompt in the pipeline.
 *
 * NOTE FOR FUTURE CHANGES: this file is hand-synced with the actual prompt
 * strings in services/claude.ts, services/imagen.ts, services/gemini.ts, and
 * the inline Veo assembly in routes/generate.ts. When you tweak a prompt in
 * the service, update its `template` here so the Prompts page stays truthful.
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
    triggeredBy: 'Fires once when the project is created from the queue.',
    summary: 'Extracts timestamped lyrics from the audio file in the original language.',
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
    name: 'Detect musical structure',
    stage: 'audio',
    model: 'gemini-3-pro-preview',
    modelLabel: 'Gemini 3 Pro',
    triggeredBy: 'Fires in parallel with transcription at project creation.',
    summary: 'Identifies musical sections (Intro, Verse, Chorus, etc.) with timestamps and energy levels.',
    variables: [],
    template: `Identify the musical sections of this audio. Keep it SHORT — max 10 sections.
For each: label (Intro/Verse/Chorus/Bridge/Interlude/Outro), startTime (M:SS), endTime (M:SS), energy (Low/Medium/High), and a 5-word description.
Return ONLY a JSON array.`,
    source: { file: 'server/services/gemini.ts', lines: '95-131' },
  },
  {
    id: 'summarize-meaning',
    name: 'Summarize meaning',
    stage: 'audio',
    model: 'claude-sonnet-4-6',
    modelLabel: 'Claude Sonnet 4.6',
    triggeredBy: 'Fires after transcription lands.',
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
    model: 'claude-opus-4-6',
    modelLabel: 'Claude Opus 4.6',
    triggeredBy: "Fires when you click 'Generate concept' on the Concept phase.",
    summary: 'Proposes 3 creative directions — traditional / modern / experimental — with deity, mood, theme, visual suggestions.',
    variables: [
      { name: 'title', description: 'Song title' },
      { name: 'language', description: 'Song language' },
      { name: 'lyrics', description: 'Full lyrics (truncated to 4000 chars)' },
      { name: 'meaning', description: 'Meaning summary' },
      { name: 'musicalStructure', description: 'Section breakdown (JSON, first 8 sections)' },
      { name: 'context', description: 'Optional song context' },
      { name: 'userNote', description: 'Optional director note to steer the concepts' },
    ],
    template: `You are a visionary film director specializing in Indian mythological and devotional cinema.

SONG: {{title}} ({{language}})
{{context ? "CONTEXT: " + context : ""}}

LYRICS:
{{lyrics}}

MEANING:
{{meaning}}

MUSICAL STRUCTURE:
{{musicalStructure}}
{{userNote ? "DIRECTOR NOTE (must follow): " + userNote : ""}}

Generate EXACTLY 3 creative directions for a music video:
1. Traditional/classical — rooted in culture, devotional storytelling
2. Modern/contemporary — fresh visual language, cinematic realism
3. Bold/experimental — unexpected, artistic, boundary-pushing

For each direction provide:
- title: 2-4 word creative title
- deity: the primary divine figure
- mood: one distinct emotional keyword (different per direction)
- theme: the core narrative idea (1 sentence)
- conceptDirection: traditional / modern / experimental
- visualSuggestions: { artStyle, colorPalette }

Use the generate_concepts tool. Return EXACTLY 3 concepts.`,
    source: { file: 'server/services/claude.ts', lines: '55-93' },
  },
  {
    id: 'plan-scenes',
    name: 'Plan script (cast, environments, scenes, shots)',
    stage: 'blueprint',
    model: 'claude-sonnet-4-6',
    modelLabel: 'Claude Sonnet 4.6',
    triggeredBy: "Fires when you click 'Generate script' on the Script phase.",
    summary: 'Plans the full video structure — cast list, environments, scenes aligned to musical sections, and shot directions.',
    variables: [
      { name: 'videoMode', description: '"montage" or "cinematic"' },
      { name: 'concept', description: 'Locked concept (deity, theme, mood)' },
      { name: 'lyrics', description: 'Full lyrics' },
      { name: 'meaning', description: 'Meaning summary' },
      { name: 'musicalStructure', description: 'Sections with timestamps' },
      { name: 'pacing', description: 'Shot duration in seconds (default 8)' },
      { name: 'userNote', description: 'Optional director note' },
    ],
    template: `You are a music video director planning a {{videoMode}} for a devotional song.

CONCEPT: {{concept.deity}} — {{concept.theme}}
Mood: {{concept.mood}}
{{concept.conceptDirection}}

LYRICS:
{{lyrics}}

MEANING: {{meaning}}

MUSICAL STRUCTURE: {{musicalStructure}}

CLIP LENGTH: All shots are fixed at {{pacing}} seconds. You decide creative content, not duration.
{{userNote ? "DIRECTOR NOTE (must follow): " + userNote : ""}}

Plan the full music video using the plan_music_video tool.

CAST rules:
- Include the deity and key mythological figures by their proper names
- Description = physical appearance for image generation: face, skin tone, build, costume, ornaments, weapons/props. 2-3 sentences.
- Include cultural context: "{name}, the {role} from {tradition}" — e.g. "Kolasura, an asura king from Vaishnavite mythology"
- No art style in descriptions — just what the character looks like

ENVIRONMENT rules:
- Only 2-3 key locations that define the visual world
- Description = physical space: architecture, landscape, scale, lighting conditions, atmosphere. 2 sentences.
- Include cultural reference: "inspired by {source}" — e.g. "inspired by Chola-era temple architecture"
- No art style — just the place itself

SCENE rules:
- One scene per musical section
- narrativeDescription: what happens, 1-2 sentences
- Each shot: direction (5-10 word creative idea), castNames (from cast list), environmentName (from environment list)`,
    source: { file: 'server/services/claude.ts', lines: '156-194' },
  },
  {
    id: 'brainstorm-style-directions',
    name: 'Brainstorm style directions',
    stage: 'blueprint',
    model: 'claude-opus-4-6',
    modelLabel: 'Claude Opus 4.6',
    triggeredBy: "Fires when you click 'Brainstorm styles' on the Style phase.",
    summary: 'Proposes 4 distinct visual style directions — lighting, palette, texture, cultural references.',
    variables: [
      { name: 'concept', description: 'Locked concept' },
      { name: 'lyrics', description: 'Full lyrics (truncated to 3000 chars)' },
      { name: 'musicalStructure', description: 'Sections JSON (first 8)' },
      { name: 'meaning', description: 'Meaning summary (1500 chars)' },
      { name: 'scriptSummary', description: 'Optional script summary once it exists' },
      { name: 'userNotes', description: 'Optional preference for all 4 variations' },
    ],
    template: `You are a Director of Photography designing the visual language for an Indian devotional music video.

The audience is Indian. The imagery must feel culturally authentic, not generic fantasy.
These descriptions will be used as prompts for Gemini image generation.

SONG: {{concept.deity}} — {{concept.theme}}
Mood: {{concept.mood}}
Language: {{concept.language}}

LYRICS:
{{lyrics}}

MUSICAL STRUCTURE:
{{musicalStructure}}

MEANING:
{{meaning}}

{{scriptSummary ? "SCRIPT OVERVIEW:\\n" + scriptSummary : ""}}
{{userNotes ? "USER DIRECTION: All 4 must be variations within this preference:\\n" + userNotes : ""}}

Propose 4 distinct visual style directions using the propose_style_directions tool.

Each direction should feel like a different film — different DP, era, artistic movement.

For each: a title (2-5 words) and description (2 short punchy sentences, keyword-heavy).

Description covers ONLY transferable visual treatment: lighting, color palette, texture/medium, cultural references.
Do NOT describe characters, scenes, environments, or narrative.
These descriptions will be used as image generation prompts — be concrete, not literary.

QUALITY GUIDELINES for the image generation downstream:
- Avoid overly AI/CGI/fantasy look — should feel cinematic and grounded
- Avoid excessive intricate details that muddy the image — every element should have clear intention
- If stylized, it should be tasteful and deliberate, not generic digital art
- Think film stills, not concept art`,
    source: { file: 'server/services/claude.ts', lines: '400-435' },
  },
  {
    id: 'refine-style-direction',
    name: 'Refine style direction',
    stage: 'blueprint',
    model: 'claude-sonnet-4-6',
    modelLabel: 'Claude Sonnet 4.6',
    triggeredBy: "Fires when you add feedback on a style direction and click 'Refine'.",
    summary: 'Revises one style direction using director feedback, kept cohesive and keyword-heavy.',
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
  {
    id: 'enrich-style-dna',
    name: 'Enrich style DNA from locked image',
    stage: 'blueprint',
    model: 'claude-sonnet-4-6',
    modelLabel: 'Claude Sonnet 4.6 (vision)',
    triggeredBy: 'Fires automatically after you lock a style image.',
    summary: 'Claude sees the locked style image and writes a 30-50 word keyword DNA injected into all downstream image prompts.',
    variables: [
      { name: 'image', description: 'The locked style reference image' },
      { name: 'shortDescription', description: 'The original text direction' },
    ],
    template: `Analyze this locked style reference image.

The user chose it based on this direction: "{{shortDescription}}"

Write a STYLE DNA fragment — 30-50 words of dense keywords and short phrases. NOT prose. This fragment gets injected into every image generation prompt downstream, so it must be pure transferable visual treatment.

Format: keyword phrases separated by commas. Like an image generation prompt, not a paragraph.

Include: lighting type, color temperature, dominant palette colors, texture/medium, grain, mood keyword, artistic reference if clear.

Do NOT include: the subject/character, the scene/environment/architecture, narrative, composition, camera angle.

Example output:
warm amber chiaroscuro, deep burgundy-gold palette, oil painting texture, visible brushwork, film grain, sacred stillness, Caravaggio lighting, Tanjore gold leaf finish

Return ONLY the keywords. No quotes, no JSON, no markdown.`,
    source: { file: 'server/services/claude.ts', lines: '521-561' },
  },

  // ─── Looks ────────────────────────────────────────────────────────
  {
    id: 'character-look',
    name: 'Character look',
    stage: 'looks',
    model: 'gemini-3-pro-image-preview',
    modelLabel: 'Gemini 3 Pro Image',
    triggeredBy: "Fires 3× in parallel when you click 'Generate look' on a character.",
    summary: 'Generates 3 cinematic character portraits using style + optional user reference as anchors.',
    variables: [
      { name: 'character.name', description: 'Character name' },
      { name: 'character.description', description: 'Physical + cultural description' },
      { name: 'styleDNA', description: 'Injected style keywords' },
      { name: 'styleImage', description: 'Locked style reference (Image N)' },
      { name: 'userRefImage', description: 'Optional director-supplied reference' },
      { name: 'userFeedback', description: 'Optional director note' },
    ],
    template: `Generate ONE cinematic character portrait in the visual style of Image 1.

{{character.name}} — {{character.description}}

{{userRefImage ? "Image 2 is a reference the director provided for this character — match its identity (face, costume, silhouette, key iconography) while rendering in the project's visual style (Image 1). The reference image is the source of truth for WHO this character is; the style image is the source of truth for HOW to render them." : ""}}

Mid-shot character portrait, upper body and face visible, detailed costume and ornaments. Eye-level framing, natural cinematic lighting.

Style: {{styleDNA}}

{{userFeedback ? "Director note: " + userFeedback : ""}}

One single image. No collage, no grid, no multiple panels. No text, no watermark.
Avoid: overly AI/CGI look, excessive intricate detail, generic fantasy. Should feel like a real film still.`,
    source: { file: 'server/services/imagen.ts', lines: '160-205' },
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
      { name: 'styleDNA', description: 'Injected style keywords' },
      { name: 'styleImage', description: 'Locked style reference (Image N)' },
      { name: 'userRefImage', description: 'Optional director-supplied reference' },
      { name: 'userNote', description: 'Optional director note' },
    ],
    template: `Generate ONE cinematic environment shot in the visual style of Image 1. No characters or figures.

{{environment.name}} — {{environment.description}}

{{userRefImage ? "Image 2 is a reference the director provided for this environment — match its geography, architecture, and mood while rendering in the project's visual style (Image 1). The reference defines WHAT the place looks like; the style defines HOW it's rendered." : ""}}

Wide establishing shot, full environment visible, empty scene.

Style: {{styleDNA}}

{{userNote ? "Director note: " + userNote : ""}}

One single image. No collage, no grid, no multiple panels. No text, no watermark.
Avoid: overly AI/CGI look, excessive intricate detail, generic fantasy. Should feel like a real film still.`,
    source: { file: 'server/services/imagen.ts', lines: '238-277' },
  },

  // ─── Studio ───────────────────────────────────────────────────────
  {
    id: 'write-shot-prompts',
    name: 'Write shot prompts (bulk)',
    stage: 'studio',
    model: 'claude-sonnet-4-6',
    modelLabel: 'Claude Sonnet 4.6',
    triggeredBy: "Auto-fires once at the end of Blueprint, or when you click 'Rewrite all' in Studio.",
    summary: 'Writes visual + motion prompts per shot plus a continuity tag (cut vs prev_shot).',
    variables: [
      { name: 'shots', description: 'List of shots with id, direction, duration, cast, scene context' },
      { name: 'styleDNA', description: 'Style keywords' },
      { name: 'cast', description: 'Character descriptions' },
      { name: 'concept', description: 'Locked concept' },
      { name: 'userNote', description: 'Optional director note' },
      { name: 'previousBatchTail', description: 'Tail of previous batch for continuity context' },
    ],
    template: `You are a cinematographer writing shot-by-shot prompts for a devotional music video.

STYLE DNA (for context, do NOT include in prompts):
{{styleDNA}}

CHARACTERS:
{{castList}}

CONCEPT: {{concept.deity}} — {{concept.theme}}. Mood: {{concept.mood}}.
{{userNote ? "USER DIRECTION (apply to this rewrite): " + userNote : ""}}
{{previousBatchTail ? "PREVIOUS SHOTS (read-only context for continuity — do NOT rewrite these):\\n..." : ""}}

SHOTS:
{{shotList}}

For EACH shot, write using the write_shot_prompts tool:

- visualPrompt: What we SEE in the frame. 1-2 sentences.
  Include: composition, character physical details (from cast list), environment, action/pose.
  Reference characters by their mythological identity.
  Do NOT include art style, lighting, or color — the style system handles that.

- motionPrompt: How the camera and characters MOVE. 1 sentence.
  Example: "Slow dolly in as Mahalakshmi raises her abhaya mudra, lotus petals drift across frame"

- continuityFrom: How this shot relates to the one before it.
  - 'cut' = HARD CUT. This shot is visually independent — different angle/subject/framing/environment, or the first shot of a scene. Most shots should be 'cut'.
  - 'prev_shot' = CONTINUOUS. This shot visually flows from the previous one — same subject in same/adjacent framing, camera continuation, or an unbroken motion beat. Only mark 'prev_shot' when the cut is genuinely invisible.

  Use 'prev_shot' sparingly — music videos are mostly hard cuts. The first shot of a scene is ALWAYS 'cut'.

Match the IDs exactly.`,
    source: { file: 'server/services/claude.ts', lines: '296-347' },
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
      { name: 'styleDNA', description: 'Injected style keywords' },
      { name: 'styleImage', description: 'Locked style ref' },
      { name: 'characterRefs', description: 'One per cast member' },
      { name: 'environmentRef', description: "Locked environment ref if shot has one" },
      { name: 'prevShotEndFrame', description: 'Previous shot extracted last frame (if continuity = prev_shot)' },
      { name: 'continuityDescription', description: 'Text description of previous frame' },
      { name: 'userFeedback', description: 'Optional director note on regen' },
      { name: 'failedImage', description: 'Previous failed attempt (on regen with feedback)' },
    ],
    template: `Scene: {{visualPrompt}}

Style: {{styleDNA}}

Preserve character identity from character references (face, costume, ornaments must match). Match environment from environment reference. {{prevShotEndFrame ? "Continue visual flow from previous shot. " : ""}}Render in the style of the style reference image. If the style text description below conflicts with the style reference image, follow the image — it is the ground truth for lighting, color palette, and visual texture.

{{continuityDescription ? "Previous shot ended with: " + continuityDescription + "\\nThis shot should begin from that exact continuity state — matching pose, camera position, lighting, and mid-action beats — then transition into the scene described above." : ""}}

{{userFeedback ? "Director note: " + userFeedback : ""}}

Single cinematic frame. No text, no watermark.
Avoid: overly AI/CGI look, excessive intricate detail, generic fantasy. Should feel like a film still.

---
Reference chain (numbered images sent alongside this prompt):
  Image 1..N = Character: {name}  (one per cast member)
  Image N+1 = Style reference
  Image N+2 = Environment reference: {name}  (if set)
  Image N+3 = Last-scene continuity reference  (if continuity = prev_shot)
  Image N+4 = PREVIOUS ATTEMPT (rejected). Problems: {feedback}  (only on regen with feedback)

Priority: character identity > continuity > environment > style.`,
    source: { file: 'server/services/imagen.ts', lines: '310-388' },
  },
  {
    id: 'refine-shot-prompt',
    name: 'Refine shot prompt (with feedback)',
    stage: 'studio',
    model: 'claude-sonnet-4-6',
    modelLabel: 'Claude Sonnet 4.6 (vision)',
    triggeredBy: 'Fires when you add feedback on a shot and click Refine.',
    summary: 'Claude sees the failed image + feedback and rewrites the visual + motion prompts to fix the issues.',
    variables: [
      { name: 'currentVisualPrompt', description: 'Current visual prompt' },
      { name: 'currentMotionPrompt', description: 'Current motion prompt' },
      { name: 'feedback', description: 'Director feedback on what went wrong' },
      { name: 'failedImage', description: 'The rejected image' },
      { name: 'styleDNA', description: 'Style keywords' },
      { name: 'characterDescriptions', description: 'Cast list for this shot' },
    ],
    template: `You are a cinematographer fixing a shot that didn't come out right.

THE IMAGE ABOVE is the failed attempt. Study it carefully.

CURRENT PROMPT (what produced this image):
Visual: {{currentVisualPrompt}}
Motion: {{currentMotionPrompt}}

DIRECTOR FEEDBACK (what's wrong):
{{feedback}}

STYLE DNA: {{styleDNA}}

CHARACTERS IN SCENE:
{{characterDescriptions}}

REWRITE the visual prompt to fix the issues. Techniques to consider:
- Face not crisp → specify "sharp facial detail, close-up framing" or "medium close-up"
- Lighting too flat → specify lighting direction: "strong rim light from behind", "warm key light from left"
- Wrong composition → specify camera: "low angle looking up", "bird's eye view", "tight close-up"
- Style drift → reinforce the style DNA terms explicitly
- Character doesn't match → add specific physical details from the character description
- Too AI/generic → add grounding details: specific textures, materials, atmospheric effects

Do NOT just append the feedback. REWRITE the prompt from scratch, keeping what worked and fixing what didn't. Keep it 1-3 sentences — direct and visual.

Only change the motion prompt if the feedback specifically mentions movement or camera motion.`,
    source: { file: 'server/services/claude.ts', lines: '594-656' },
  },
  {
    id: 'chained-shot-refresh',
    name: 'Chained-shot refresh (prev-frame grounded)',
    stage: 'studio',
    model: 'claude-sonnet-4-6',
    modelLabel: 'Claude Sonnet 4.6 (vision)',
    triggeredBy: 'Fires automatically after a shot\'s video lands, when the next shot is tagged "prev_shot".',
    summary: "Claude sees the extracted last frame and rewrites the next shot's prompts so the handoff is grounded in what really happened.",
    variables: [
      { name: 'prevFrame', description: "Extracted last frame of the previous shot's video" },
      { name: 'currentVisualPrompt', description: "Next shot's current visual prompt" },
      { name: 'currentMotionPrompt', description: "Next shot's current motion prompt" },
      { name: 'styleDNA', description: 'Style keywords' },
      { name: 'characterDescriptions', description: 'Cast in the next shot' },
      { name: 'environmentName', description: 'Next shot environment (optional)' },
      { name: 'sceneNarrative', description: 'Next scene narrative (optional)' },
      { name: 'sceneLyrics', description: 'Lyrics for this moment (optional)' },
      { name: 'mood', description: 'Concept mood (optional)' },
      { name: 'shotDuration', description: 'Shot duration in seconds' },
    ],
    template: `You are a cinematographer chaining two shots seamlessly.

THE IMAGE ABOVE is the last frame of the PREVIOUS shot — literally where we end up.

THE NEXT SHOT was drafted blind (before the previous shot was rendered). Now that we can see the actual ending frame, rewrite the next shot's prompts so the continuity is grounded in what really happened.

CURRENT (draft) NEXT-SHOT PROMPT:
Visual: {{currentVisualPrompt}}
Motion: {{currentMotionPrompt}}

NEXT SHOT DURATION: {{shotDuration}}s
{{sceneNarrative ? "SCENE NARRATIVE: " + sceneNarrative : ""}}
{{sceneLyrics ? "LYRICS AT THIS MOMENT: " + sceneLyrics : ""}}
{{mood ? "MOOD: " + mood : ""}}
STYLE DNA: {{styleDNA}}
{{environmentName ? "ENVIRONMENT: " + environmentName : ""}}
{{characterDescriptions ? "CHARACTERS IN THIS SHOT:\\n" + characterDescriptions : ""}}

Rewrite both prompts. Keep the spirit of the draft, but:
- Start from the actual frame shown (composition, lighting, character pose, environment).
- Describe a natural continuation — camera can move or cut tight, but the first moment of this shot must match the frame.
- Keep it 1-3 sentences, direct and visual. No meta-commentary.`,
    source: { file: 'server/services/claude.ts', lines: '676-745' },
  },
  {
    id: 'shot-video-assembly',
    name: 'Shot video prompt (Veo/Seedance)',
    stage: 'studio',
    model: 'veo-3.1-* / seedance-2.0-*',
    modelLabel: 'Video model (Veo or Seedance)',
    triggeredBy: "Fires when you click the play icon on a shot or 'Generate all videos'.",
    summary: "Assembled inline from motion + scene brief + cast + mood + (optional) continuity description. Artist can override via the Video prompt tab.",
    variables: [
      { name: 'motionPrompt', description: "Shot's motion prompt" },
      { name: 'sceneNarrative', description: 'Scene narrative (truncated to 120 chars)' },
      { name: 'castNames', description: 'Comma-separated cast names in this shot' },
      { name: 'mood', description: 'Concept mood' },
      { name: 'continuityDescription', description: 'Optional — injected only when shot is tagged prev_shot' },
    ],
    template: `{{motionPrompt}}. {{sceneNarrative}}. Characters: {{castNames}}. {{mood}} mood.
{{continuityDescription ? "Starting state (from previous shot): " + continuityDescription : ""}}`,
    source: { file: 'server/routes/generate.ts', lines: '1377-1393' },
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
