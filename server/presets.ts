export type SeedKind = 'audio' | 'script' | 'brief' | 'document' | 'idea';

export type CanonicalWorkflowRecipeKey = 'music_led' | 'scripted_narrative';
export type LegacyWorkflowRecipeKey = 'music_video' | 'anime_scripted';
export type WorkflowRecipeKey = CanonicalWorkflowRecipeKey | LegacyWorkflowRecipeKey;

export type WorkflowRecipe = {
  key: CanonicalWorkflowRecipeKey;
  label: string;
  primarySeed: SeedKind;
  acceptedSeeds: SeedKind[];
  summary: string;
  projectBriefRules: string;
  shotPlanRules: string;
};

export type PipelinePresetKey = 'music_video_default' | 'anime_default';

export type PipelinePreset = {
  key: PipelinePresetKey;
  workflowKey: CanonicalWorkflowRecipeKey;
  label: string;
  toolName: string;
  audience: string;
  source: {
    kind: SeedKind;
    rules: string;
  };
  concept: {
    directorIdentity: string;
    subjectField: string;
    subjectDescription: string;
    directionExamples: string[];
    rules: string;
  };
  script: {
    plannerIdentity: string;
    castRules: string;
    environmentRules: string;
    sceneRules: string;
    shotExamples: {
      good: string[];
      bad: string[];
    };
  };
  style: {
    dpIdentity: string;
    rules: string;
    brainstormTaste?: string;
    subjectPrompt: (subject: string) => string;
    presetBible?: string;
  };
  looks: {
    characterRules: string;
    environmentRules: string;
    qualityRules: string;
  };
  studio: {
    shotPromptRules: string;
    storyboardRules: string;
    videoPromptRules: string;
  };
  audio: {
    dialogueRules: string;
    soundRules: string;
    strategyRules: string;
  };
  defaults: {
    imageModel: string;
    storyboardProvider: string;
    videoModel: string;
    aspectRatio: string;
    pacing: number;
  };
};

export const WORKFLOW_KEY_ALIASES: Record<LegacyWorkflowRecipeKey, CanonicalWorkflowRecipeKey> = {
  music_video: 'music_led',
  anime_scripted: 'scripted_narrative',
};

export const normalizeWorkflowKey = (key?: string | null): CanonicalWorkflowRecipeKey | null => {
  if (!key) return null;
  if (key === 'music_led' || key === 'scripted_narrative') return key;
  return WORKFLOW_KEY_ALIASES[key as LegacyWorkflowRecipeKey] || null;
};

export const WORKFLOW_RECIPES: Record<CanonicalWorkflowRecipeKey, WorkflowRecipe> = {
  music_led: {
    key: 'music_led',
    label: 'Music-led',
    primarySeed: 'audio',
    acceptedSeeds: ['audio', 'brief', 'document', 'idea'],
    summary: 'Audio-first video production: analyze song, shape a concept, plan scenes and shots, generate refs, then produce clips and render.',
    projectBriefRules: 'Normalize uploaded audio, lyrics/SRT, artist notes, and optional documents into a music-video brief: title, language, meaning, musical sections, target audience, subject, emotion, constraints, and references.',
    shotPlanRules: 'Shot plans follow musical structure and timing. The track supplies duration and rhythm; each scene maps to a musical section.',
  },
  scripted_narrative: {
    key: 'scripted_narrative',
    label: 'Scripted Narrative',
    primarySeed: 'script',
    acceptedSeeds: ['script', 'brief', 'document', 'idea'],
    summary: 'Script-first anime production: parse script into scenes, shots, cast, and environments; use a preset style bible; then produce boards/clips.',
    projectBriefRules: 'Normalize the uploaded script or episode brief into logline, runtime target, scene list, character list, locations, dialogue/audio needs, continuity constraints, and production notes. Do not require lyrics or song structure.',
    shotPlanRules: 'Shot plans follow scene beats and dialogue/action timing rather than musical sections. Preserve the uploaded script unless the director asks for story changes.',
  },
};

export const PIPELINE_PRESETS: Record<PipelinePresetKey, PipelinePreset> = {
  music_video_default: {
    key: 'music_video_default',
    workflowKey: 'music_led',
    label: 'Music Video',
    toolName: 'Studio',
    audience: 'music-video artists, directors, and producers',
    source: {
      kind: 'audio',
      rules: 'Use uploaded audio, lyrics, musical structure, and director brief as the source of truth.',
    },
    concept: {
      directorIdentity: 'a visionary music video director across genres',
      subjectField: 'primary subject',
      subjectDescription: 'Primary artist, character, emotional subject, world, object, or visual premise',
      directionExamples: ['warehouse performance', 'neon night drive', 'memory montage', 'surreal dance film'],
      rules: `Visual style is decided in a separate phase. Do not include art style, color palette, or cinematography here. Focus on the music-video idea, emotional progression, visual world, and what the viewer follows.`,
    },
    script: {
      plannerIdentity: 'a practical music video director',
      castRules: 'Include only performers, characters, dancers, crowds, objects, or recurring figures actually needed. Descriptions are reusable physical identities, wardrobe, styling, silhouette, and role in the video.',
      environmentRules: 'Use 2-4 reusable locations that define the visual world. Descriptions are physical spaces only: landscape, architecture, set design, scale, lighting, atmosphere. No art style.',
      sceneRules: 'Let the track energy, lyrics, and structure decide whether this is performance, narrative, abstract, dance, documentary, editorial, or hybrid. Build progression across each scene: establish the idea, develop it with musical changes, land a memorable image or action.',
      shotExamples: {
        good: [
          'The singer crosses the empty soundstage as the neon signs flicker on',
          'Two dancers mirror each other across the train platform, then break into separate rhythms',
          'The band hits the chorus under hard white strobes as the crowd surges closer',
        ],
        bad: [
          'Slow dolly in on the singer',
          'Wide establishing shot of warehouse',
        ],
      },
    },
    style: {
      dpIdentity: 'a Director of Photography designing the visual language for a music video',
      rules: `Music video has no fixed medium. Animation, live-action, mixed media, motion graphics, photography, performance capture, projection, lo-fi formats, and editorial treatments can all fit when they serve the track and director intent.

Should feel like an intentional music-video production, not generic stock fantasy, AI-renderscape filler, or default-grade visual mood collage. Specificity beats genre cliché.`,
      brainstormTaste: `Cover a real range across mediums and aesthetics. Vary the medium, lighting language, texture, era reference, camera grammar, and production design across the four directions.

Each direction should sit in a clearly different production space. Avoid restating the same treatment with different adjectives.`,
      subjectPrompt: (subject) => `a music video about ${subject}`,
    },
    looks: {
      characterRules: 'Reusable character or performer reference: face, wardrobe, styling, silhouette, and identity should be clear. Avoid props or scene-specific action in hands unless essential to the identity.',
      environmentRules: 'Reusable environment or set reference: full space visible, no one-off action, no unrelated crowd unless the location depends on it.',
      qualityRules: 'Avoid: overly AI/CGI look, excessive intricate detail, generic fantasy, incoherent references. Should feel like a real production frame.',
    },
    studio: {
      shotPromptRules: 'Every shot must advance the musical or visual idea, not just restate the previous beat. Translate emotion into visible action, blocking, performance, environment change, or editorial rhythm.',
      storyboardRules: 'Use only objects, gestures, characters, performance choices, and set pieces that belong to the shot and references.',
      videoPromptRules: 'Do not invent a different object, set piece, performance action, or character blocking than the storyboard.',
    },
    audio: {
      dialogueRules: 'Music videos usually use the uploaded song as the primary audio. Do not invent spoken dialogue unless the director explicitly asks for narration, skits, or spoken inserts.',
      soundRules: 'Use ambient or sound-effect notes only when they clarify visual production. The song remains the timeline authority.',
      strategyRules: 'Audio Blueprint is skipped by default for music videos; any dialogue/TTS work is an explicit custom override.',
    },
    defaults: {
      imageModel: 'nano-banana-2',
      storyboardProvider: 'gpt-image-2',
      videoModel: 'seedance-2.0-fast',
      aspectRatio: '16:9',
      pacing: 8,
    },
  },
  anime_default: {
    key: 'anime_default',
    workflowKey: 'scripted_narrative',
    label: 'Anime',
    toolName: 'Anime Studio',
    audience: 'anime creators, showrunners, and episode directors',
    source: {
      kind: 'script',
      rules: 'Use the uploaded script, treatment, or episode brief as the source of truth. Do not require lyrics, audio analysis, or a music queue. Preserve story intent unless the director explicitly asks for adaptation.',
    },
    concept: {
      directorIdentity: 'an anime series director translating scripts into production-ready animated scenes',
      subjectField: 'central story premise',
      subjectDescription: 'The episode premise, protagonist conflict, emotional turn, or scene subject',
      directionExamples: ['quiet school rooftop confession', 'rain-soaked mecha launch', 'slice-of-life train ride', 'supernatural alley encounter'],
      rules: `If concepting is used, treat it as a production brief for the uploaded script, not a replacement story. Focus on episode intent, character stakes, scene progression, and what must be preserved.`,
    },
    script: {
      plannerIdentity: 'an anime episode director planning production scenes from a script',
      castRules: 'Extract named characters and recurring extras that appear on screen. Descriptions should support consistent anime character sheets: age range, silhouette, hair, outfit, expression baseline, role, and distinguishing marks. No scene action in the neutral reference description.',
      environmentRules: 'Extract reusable backgrounds and locations. Descriptions should support anime background boards: geography, layout, time of day, mood, key props, and continuity details. No camera style.',
      sceneRules: 'Follow the uploaded script beats. Preserve dialogue/action order unless asked to adapt. Use shots to clarify acting beats, reactions, reveals, action choreography, and continuity. Avoid inventing new plot turns, characters, or locations.',
      shotExamples: {
        good: [
          'Mina stops at the classroom doorway as the hallway noise drops behind her',
          'The mech cockpit lights wake one by one while Haru grips the cracked control yoke',
          'A close reaction beat catches Ren looking away before answering the confession',
        ],
        bad: [
          'Wide establishing shot of classroom',
          'Slow dolly in on protagonist',
        ],
      },
    },
    style: {
      dpIdentity: 'an anime art director defining production-ready visual language',
      rules: `Medium is anime: hand-illustrated frames, drawn linework, painted or flat-color rendering, animated camera and staging. The output reads as a drawn/animated frame, not as a photographed or photoreal object pretending to be one.

Do not let directions, descriptions, or generated frames drift into live-action photography, documentary stills, Polaroid or film-stock realism as the apparent medium. Technical ingredients like cel-shaded CG, 3D-assisted backgrounds, painted photoreal-leaning environments, and digital compositing are legitimate inside anime production when the final image still reads as anime.`,
      brainstormTaste: `Cover a real range across legitimate anime aesthetics. Each of the four directions should sit in a clearly different corner of the anime production space: modern flat-color digital, retro cel-painted television, soft watercolor or pastel illustration, harsh high-contrast graphic, photoreal-leaning painted backgrounds with anime characters, ink-and-wash or sketch-forward, stylized limited-animation looks. These are starting points, not a fixed menu; pick four that actually contrast with each other given this project.

Each direction must be distinct in palette, line treatment, rendering, lighting, and mood. Avoid restating the same look with different adjectives.`,
      subjectPrompt: (subject) => `the scripted anime project "${subject}"`,
      presetBible: 'Default anime look: clean 2D animation key art, expressive but consistent faces, readable silhouettes, detailed painted backgrounds, restrained camera motion, strong acting poses, no live-action photorealism.',
    },
    looks: {
      characterRules: 'Reusable anime character sheet/reference: clear face, hairstyle, outfit, silhouette, expression baseline, proportions, and distinguishing details. Neutral pose, no scene-specific props unless essential.',
      environmentRules: 'Reusable anime background board: full location visible, layout readable, lighting and atmosphere clear, no characters unless scale requires a tiny neutral figure.',
      qualityRules: 'Avoid: photoreal live-action look, 3D plastic finish, inconsistent facial structure, overrendered noise, unreadable costume detail, text, watermark, collage, or multiple panels.',
    },
    studio: {
      shotPromptRules: 'Every shot must clarify acting, story information, choreography, or emotional change. Translate inner emotion into facial acting, posture, timing, blocking, and environmental response.',
      storyboardRules: 'Storyboard panels should read like anime layout/key pose boards: clear acting beats, screen direction, continuity, and background geography. Avoid captions, speech bubbles, text, panel numbers, and manga-page effects unless requested.',
      videoPromptRules: 'Animate as a coherent anime shot or edited mini-sequence. Preserve character designs, background layout, screen direction, and action timing from the storyboard. Do not add live-action camera artifacts or unrelated VFX.',
    },
    audio: {
      dialogueRules: 'Preserve uploaded script dialogue whenever present. If the seed only has action beats, write concise production dialogue only when the shot clearly calls for speech. Never put delivery labels, camera notes, or speaker names inside spoken text.',
      soundRules: 'Use soundNotes for restrained ambient/SFX guidance that helps video generation. Do not build a full Foley timeline in v1.',
      strategyRules: 'Dialogue video mode is project-level: lipsync asks the video model to perform speech and lip movement natively from dialogue text; overlay uses generated TTS in the final render. Do not choose strategy per shot.',
    },
    defaults: {
      imageModel: 'nano-banana-2',
      storyboardProvider: 'gpt-image-2',
      videoModel: 'seedance-2.0-fast',
      aspectRatio: '16:9',
      pacing: 6,
    },
  },
};

export const DEFAULT_WORKFLOW_RECIPE_KEY: CanonicalWorkflowRecipeKey = 'music_led';
export const DEFAULT_PRESET_KEY: PipelinePresetKey = 'music_video_default';

export const getWorkflowRecipe = (key?: string | null): WorkflowRecipe => {
  const normalized = normalizeWorkflowKey(key);
  if (normalized) return WORKFLOW_RECIPES[normalized];
  return WORKFLOW_RECIPES[DEFAULT_WORKFLOW_RECIPE_KEY];
};

export const getPipelinePreset = (key?: string | null): PipelinePreset => {
  if (key && key in PIPELINE_PRESETS) return PIPELINE_PRESETS[key as PipelinePresetKey];
  return PIPELINE_PRESETS[DEFAULT_PRESET_KEY];
};

export const getRuntimePreset = (override?: string | null): PipelinePreset =>
  getPipelinePreset(override || process.env.PIPELINE_PRESET_KEY || DEFAULT_PRESET_KEY);

export const getProjectRuntimePreset = (
  project?: { preset_key?: string | null } | null,
  override?: string | null,
): PipelinePreset =>
  getRuntimePreset(override || project?.preset_key || null);

export const getPresetWorkflow = (preset: PipelinePreset): WorkflowRecipe =>
  getWorkflowRecipe(preset.workflowKey);

export const getDefaultPresetForWorkflow = (workflowKey?: string | null): PipelinePreset => {
  const workflow = getWorkflowRecipe(workflowKey);
  const match = Object.values(PIPELINE_PRESETS).find((preset) => preset.workflowKey === workflow.key);
  return match || getPipelinePreset();
};

export const resolveProjectIntake = (opts: {
  workflowKey?: string | null;
  seedKind?: string | null;
  presetKey?: string | null;
}): { workflow: WorkflowRecipe; seedKind: SeedKind; preset: PipelinePreset } => {
  if (opts.workflowKey && !normalizeWorkflowKey(opts.workflowKey)) {
    const err = new Error(`Unknown workflow "${opts.workflowKey}".`);
    (err as any).statusCode = 400;
    throw err;
  }
  if (opts.presetKey && !(opts.presetKey in PIPELINE_PRESETS)) {
    const err = new Error(`Unknown preset "${opts.presetKey}".`);
    (err as any).statusCode = 400;
    throw err;
  }

  const preset = opts.presetKey
    ? getPipelinePreset(opts.presetKey)
    : getDefaultPresetForWorkflow(opts.workflowKey);
  const workflow = getWorkflowRecipe(opts.workflowKey || preset.workflowKey);

  if (preset.workflowKey !== workflow.key) {
    const err = new Error(`Preset "${preset.key}" is for workflow "${preset.workflowKey}", not "${workflow.key}".`);
    (err as any).statusCode = 400;
    throw err;
  }

  const seedKind = (opts.seedKind || workflow.primarySeed) as SeedKind;
  if (!workflow.acceptedSeeds.includes(seedKind)) {
    const err = new Error(`Seed "${seedKind}" is not accepted by workflow "${workflow.key}".`);
    (err as any).statusCode = 400;
    throw err;
  }

  return { workflow, seedKind, preset };
};

export const presetSubject = (concept: any, fallback: string, preset: PipelinePreset): string =>
  concept?.subject || concept?.primarySubject || concept?.deity || concept?.title || fallback || preset.label;
