import crypto from 'crypto';

export const LOOK_ACTION_SPECS = {
  generate_candidates: {
    key: 'generate_candidates',
    title: 'Generate reference candidates',
    surface: 'looks',
    mutates: true,
    paid: true,
    description: 'Generate reusable character or environment reference candidates. Use note for soft direction, promptOverride for an exact final prompt, and guideAssetId after uploading an image as a visual guide.',
    input: {
      projectId: 'string',
      entityType: '"cast" | "environment"',
      entityIds: 'string[] — always an array, even for a single entity; use the cast/environment ids from project state',
      note: 'optional string',
      promptOverride: 'optional string; only one entityId may be used',
      guideAssetId: 'optional existing Mirage asset id (from /api/agent/uploads or a prior generation)',
      contextOverrides: 'optional context include/exclude controls, e.g. { includeStyleImage: false, includeProjectStyleDescription: false, styleNoteSections: { include: ["image"] } }',
    },
    examples: [{
      projectId: 'project_uuid',
      entityType: 'cast',
      entityIds: ['cast_member_uuid'],
      note: 'make the outfit simpler and closer to the locked style reference',
    }, {
      projectId: 'project_uuid',
      entityType: 'environment',
      entityIds: ['environment_uuid_a', 'environment_uuid_b'],
    }, {
      projectId: 'project_uuid',
      entityType: 'cast',
      entityIds: ['cast_member_uuid'],
      guideAssetId: 'asset_uuid_from_agent_upload',
      note: 'match this uploaded reference for identity; keep the locked style rendering',
    }, {
      projectId: 'project_uuid',
      entityType: 'cast',
      entityIds: ['cast_member_uuid'],
      promptOverride: 'Full-body reference of the character in a neutral pose on a plain soft background, rendered to match the locked style reference.',
    }],
  },
  list_candidates: {
    key: 'list_candidates',
    title: 'List reference candidates',
    surface: 'looks',
    mutates: false,
    paid: false,
    description: 'List generated candidate image URLs and asset IDs for one cast member or environment.',
    input: {
      projectId: 'string',
      entityType: '"cast" | "environment"',
      entityId: 'string',
    },
    examples: [{
      projectId: 'project_uuid',
      entityType: 'environment',
      entityId: 'environment_uuid',
    }],
  },
  import_reference_candidate: {
    key: 'import_reference_candidate',
    title: 'Import reference candidate',
    surface: 'looks',
    mutates: true,
    paid: false,
    description: 'Turn an uploaded/native image asset into a reviewable character or environment candidate card. Use after /api/agent/uploads when the artist should review the image before locking it.',
    input: {
      projectId: 'string',
      entityType: '"cast" | "environment"',
      entityId: 'string',
      sourceAssetId: 'uploaded asset id from /api/agent/uploads',
      note: 'optional short source/reason note',
    },
    examples: [{
      projectId: 'project_uuid',
      entityType: 'cast',
      entityId: 'cast_member_uuid',
      sourceAssetId: 'asset_uuid_from_agent_upload',
      note: 'Codex imagegen candidate; review before locking',
    }],
  },
  lock_reference: {
    key: 'lock_reference',
    title: 'Lock reference',
    surface: 'looks',
    mutates: true,
    paid: false,
    description: 'Set an existing Mirage asset as the canonical character or environment reference. Use after list_candidates or /api/agent/uploads.',
    input: {
      projectId: 'string',
      entityType: '"cast" | "environment"',
      entityId: 'string',
      sourceAssetId: 'string',
    },
    examples: [{
      projectId: 'project_uuid',
      entityType: 'cast',
      entityId: 'cast_member_uuid',
      sourceAssetId: 'asset_uuid',
    }],
  },
} as const;

export const STORYBOARD_ACTION_SPECS = {
  generate_storyboard: {
    key: 'generate_storyboard',
    title: 'Generate storyboard',
    surface: 'storyboard',
    mutates: true,
    paid: true,
    description: 'Render a storyboard board for one shot from its saved storyboard prompt. dryRun returns the plan without spending.',
    input: {
      projectId: 'string',
      shotId: 'string',
      dryRun: 'optional boolean',
      artistNote: 'optional soft direction for image generation',
      modelOverride: 'optional storyboardProvider override',
      contextOverrides: 'optional per-call ref/style-note controls, e.g. { includeStyleImage: false, excludeCastRefs: ["cast_uuid"], includePreviousStoryboard: false, styleNoteSections: { exclude: ["motion"] } }',
    },
    examples: [{ projectId: 'project_uuid', shotId: 'shot_uuid', dryRun: true }],
  },
  bulk_generate_storyboards: {
    key: 'bulk_generate_storyboards',
    title: 'Bulk generate storyboards',
    surface: 'storyboard',
    mutates: true,
    paid: true,
    materializeForAgent: false,
    description: 'Generate missing/stale/error storyboard boards for selected shots. Use parallel_run for custom parallel batches.',
    input: {
      projectId: 'string',
      shotIds: 'optional string[]',
      force: 'optional boolean',
      artistNote: 'optional soft direction',
      modelOverride: 'optional storyboardProvider override',
      contextOverrides: 'optional per-call ref/style-note controls applied to each generated storyboard',
    },
    examples: [{ projectId: 'project_uuid', shotIds: ['shot_a', 'shot_b'], force: true }],
  },
  apply_storyboard_prompts: {
    key: 'apply_storyboard_prompts',
    title: 'Apply storyboard prompts',
    surface: 'storyboard',
    mutates: true,
    paid: false,
    description: 'Persist Codex-written storyboard prompt and cut-plan text. Accepts either structured shots[] or one scene markdown draft. Edit the saved text here when "make it brighter" / "less grungy" is really a prompt change; do not use refine_storyboard_image for prompt rewrites.',
    input: {
      projectId: 'string',
      shots: 'optional array of {shotId, storyboardPrompt, storyboardCutPlan?, baseHash?}',
      markdown: 'optional mirage-storyboard-scene-v1 markdown',
      force: 'optional boolean',
    },
    examples: [{ projectId: 'project_uuid', shots: [{ shotId: 'shot_uuid', storyboardPrompt: '...', storyboardCutPlan: '...' }] }],
  },
  refine_storyboard_image: {
    key: 'refine_storyboard_image',
    title: 'Refine storyboard image',
    surface: 'storyboard',
    mutates: true,
    paid: true,
    description: 'Edit the current storyboard image using a narrow positive edit instruction (image-edit mode, not prompt rewrite). Codex translates raw artist chat into a concrete one-axis change before calling this; do not forward "make it less grungy" / "make it brighter" style notes verbatim. If the prompt itself is wrong, use apply_storyboard_prompts instead.',
    input: {
      projectId: 'string',
      shotId: 'string',
      feedback: 'concise positive edit instruction written by Codex from artist intent — describes the specific visual change to apply while preserving everything else',
      previousVersionId: 'optional string',
      modelOverride: 'optional storyboardProvider override',
    },
    examples: [{ projectId: 'project_uuid', shotId: 'shot_uuid', feedback: 'Keep composition, characters, panel layout. Brighten lighting one stop; clean up the dirty grungy texture into a cleaner matte finish.' }],
  },
  import_storyboard_image: {
    key: 'import_storyboard_image',
    title: 'Import storyboard image',
    surface: 'storyboard',
    mutates: true,
    paid: false,
    description: 'Attach an uploaded/native image as a storyboard version for one shot, optionally locking that exact version. Use after /api/agent/uploads purpose=storyboard_image.',
    input: {
      projectId: 'string',
      shotId: 'string',
      sourceAssetId: 'uploaded asset id from /api/agent/uploads purpose=storyboard_image',
      lock: 'optional boolean; true locks the imported version immediately',
      note: 'optional short reason/source note',
    },
    examples: [{ projectId: 'project_uuid', shotId: 'shot_uuid', sourceAssetId: 'asset_uuid', lock: true }],
  },
  lock_storyboard: {
    key: 'lock_storyboard',
    title: 'Lock storyboard',
    surface: 'storyboard',
    mutates: true,
    paid: false,
    description: 'Mark one storyboard version as approved so current video generation can use it.',
    input: { projectId: 'string', shotId: 'string', versionId: 'optional string' },
    examples: [{ projectId: 'project_uuid', shotId: 'shot_uuid' }],
  },
  unlock_storyboard: {
    key: 'unlock_storyboard',
    title: 'Unlock storyboard',
    surface: 'storyboard',
    mutates: true,
    paid: false,
    description: 'Clear storyboard approval so the board can be regenerated or replaced.',
    input: { projectId: 'string', shotId: 'string' },
    examples: [{ projectId: 'project_uuid', shotId: 'shot_uuid' }],
  },
} as const;

export const VIDEO_ACTION_SPECS = {
  import_keyframe_image: {
    key: 'import_keyframe_image',
    title: 'Import keyframe image',
    surface: 'video',
    mutates: true,
    paid: false,
    description: 'Attach an uploaded/native image as the shot start keyframe for keyframe-mode video. Use after /api/agent/uploads purpose=keyframe_image, or reuse any existing image asset in this project.',
    input: {
      projectId: 'string',
      shotId: 'string',
      sourceAssetId: 'uploaded or existing image asset id',
      note: 'optional short reason/source note',
    },
    examples: [{ projectId: 'project_uuid', shotId: 'shot_uuid', sourceAssetId: 'asset_uuid', note: 'Use artist-approved podcast still as the start keyframe.' }],
  },
  generate_video: {
    key: 'generate_video',
    title: 'Generate video',
    surface: 'video',
    mutates: true,
    paid: true,
    description: 'Generate the video clip for one shot. dryRun returns requirements, provider, cost, AND the composed prompt decomposed into segments (each with its source + the exact action that edits it) without spending — preview/audit before generating.',
    input: {
      projectId: 'string',
      shotId: 'string',
      dryRun: 'optional boolean',
      promptOverride: 'optional exact final video prompt',
      modelOverride: 'optional videoModel override',
      nativeAudioMode: 'optional "auto" | "off" | "on"; use "off" for silent lipsync video when final audio will be overlaid in render',
      recipeSlots: 'optional workflow recipe slot values, e.g. { pace, performance, ending, language } for Yapper or { musicSection, beatTiming, choreography } for music-led recipes; {dialogue} is filled from the shot audio plan when present',
      contextOverrides: 'optional per-slot include/exclude and storyboard-video ref controls, e.g. { includeShotBeat: false, includeCutPlan: false } or { includeEnvironmentRefs: ["env_uuid_a", "env_uuid_b"] }; preview the effect with dryRun first',
      acknowledgePreviousChargeRisk: 'required true only after a prior video attempt has an unknown or pending provider outcome; retry may spend again',
    },
    examples: [
      { projectId: 'project_uuid', shotId: 'shot_uuid', dryRun: true },
      { projectId: 'project_uuid', shotId: 'shot_uuid', dryRun: true, contextOverrides: { includeShotBeat: false } },
      { projectId: 'project_uuid', shotId: 'shot_uuid', dryRun: true, contextOverrides: { includeEnvironmentRefs: ['env_uuid_a', 'env_uuid_b'] } },
    ],
  },
  describe_video_prompt: {
    key: 'describe_video_prompt',
    title: 'Describe video prompt',
    surface: 'video',
    mutates: false,
    paid: false,
    description: 'Read what was actually sent for a shot\'s most recent video generation — the composed prompt decomposed into segments, each with its source and the exact action that edits it. Read-only. For "what would be sent now", use generate_video dryRun.',
    input: {
      projectId: 'string',
      shotId: 'string',
    },
    examples: [{ projectId: 'project_uuid', shotId: 'shot_uuid' }],
  },
  apply_video_prompt: {
    key: 'apply_video_prompt',
    title: 'Apply video prompt',
    surface: 'video',
    mutates: true,
    paid: false,
    description: 'Persist a Codex-written keyframe-mode motion prompt. This does not generate video.',
    input: {
      projectId: 'string',
      shotId: 'string',
      motionPrompt: 'string',
      baseHash: 'optional string',
      force: 'optional boolean',
    },
    examples: [{ projectId: 'project_uuid', shotId: 'shot_uuid', motionPrompt: 'Slow push-in; Ren barely breathes.' }],
  },
} as const;

export const AUDIO_ACTION_SPECS = {
  apply_source_lyrics: {
    key: 'apply_source_lyrics',
    title: 'Apply source lyrics',
    surface: 'audio',
    mutates: true,
    paid: false,
    description: 'Persist canonical or artist-provided project-level source lyrics/text when audio transcription is partial, unavailable, or not worth rerunning.',
    input: {
      projectId: 'string',
      lyrics: 'full lyrics/source text to save on the project',
      source: 'optional source label or URL',
      note: 'optional operator note',
    },
    examples: [{ projectId: 'project_uuid', lyrics: '[0:00] First line...', source: 'artist-provided lyrics' }],
  },
  analyze_audio_transcribe: {
    key: 'analyze_audio_transcribe',
    title: 'Transcribe audio',
    surface: 'audio',
    mutates: true,
    paid: true,
    description: 'Opt-in audio transcription for audio-seed projects. Uploading audio does not run this automatically.',
    input: {
      projectId: 'string',
      language: 'optional language hint',
    },
    examples: [{ projectId: 'project_uuid', language: 'Telugu' }],
  },
  analyze_audio_structure: {
    key: 'analyze_audio_structure',
    title: 'Analyze audio structure',
    surface: 'audio',
    mutates: true,
    paid: true,
    description: 'Opt-in musical structure detection for audio-seed projects. Use only when the audio should drive scenes or pacing.',
    input: {
      projectId: 'string',
    },
    examples: [{ projectId: 'project_uuid' }],
  },
  generate_dialogue_audio: {
    key: 'generate_dialogue_audio',
    title: 'Generate dialogue audio',
    surface: 'audio',
    mutates: true,
    paid: true,
    description: 'Generate ElevenLabs TTS for selected pending/error dialogue lines. dryRun returns cost and missing voices without spending. Use voiceModel for a one-run ElevenLabs model override; otherwise project preferences.ttsModel is used.',
    input: {
      projectId: 'string',
      dryRun: 'optional boolean',
      shotIds: 'optional string[]',
      dialogueIds: 'optional string[]',
      characterIds: 'optional string[]',
      voiceModel: 'optional "eleven_multilingual_v2" | "eleven_v3"',
    },
    examples: [{ projectId: 'project_uuid', dryRun: true, shotIds: ['shot_uuid'] }, { projectId: 'project_uuid', voiceModel: 'eleven_v3' }],
  },
  voice_change_video: {
    key: 'voice_change_video',
    title: 'Voice-change video',
    surface: 'audio',
    mutates: true,
    paid: true,
    description: 'Post-process a native-dialogue video through ElevenLabs voice changer. Takes the active shot video or sourceVideoAssetId, cuts one or more timestamped speaker segments, voice-changes each segment, muxes a final MP4, and optionally makes it the active/canonical shot video. Use after native video dialogue generation, not instead of video generation.',
    input: {
      projectId: 'string',
      shotId: 'string',
      dryRun: 'optional boolean; returns duration/segment/cost estimate without spending',
      sourceVideoAssetId: 'optional raw video asset id; defaults to the active shot video',
      segments: 'array of {startMs?, endMs?, speakerId?, voiceId?, label?}; one segment may omit start/end to mean the whole clip',
      modelId: 'optional ElevenLabs speech-to-speech model; defaults to eleven_multilingual_sts_v2',
      removeBackgroundNoise: 'optional boolean',
      makeCanonical: 'optional boolean; default true updates the shot active video to the voice-changed MP4',
      note: 'optional short reason/cut-map note',
    },
    examples: [{
      projectId: 'project_uuid',
      shotId: 'shot_uuid',
      dryRun: true,
      segments: [{ speakerId: 'cast_member_uuid' }],
    }, {
      projectId: 'project_uuid',
      shotId: 'shot_uuid',
      segments: [
        { startMs: 0, endMs: 5200, speakerId: 'host_cast_uuid' },
        { startMs: 5400, endMs: 9800, speakerId: 'guest_cast_uuid' },
      ],
    }],
  },
  apply_audio_plan: {
    key: 'apply_audio_plan',
    title: 'Apply audio plan',
    surface: 'audio',
    mutates: true,
    paid: false,
    description: 'Persist Codex-written per-shot dialogue lines, optional line timing (startMs/endMs), sound notes, and lipsync/overlay strategy. Accepts structured shots[] or one audio-plan markdown draft.',
    input: {
      projectId: 'string',
      shots: 'optional array of {shotId, audioPlan, baseHash?}',
      markdown: 'optional Mirage audio-plan markdown',
      force: 'optional boolean',
    },
    examples: [{ projectId: 'project_uuid', markdown: '# Audio Plan Draft\\n...' }],
  },
  apply_cast_voice: {
    key: 'apply_cast_voice',
    title: 'Apply cast voice',
    surface: 'audio',
    mutates: true,
    paid: false,
    description: 'Assign an ElevenLabs voice ID to one cast member for overlay TTS generation.',
    input: {
      projectId: 'string',
      castMemberId: 'string',
      voiceProvider: '"elevenlabs"',
      voiceId: 'string',
      voiceName: 'optional string',
      baseHash: 'optional string',
      force: 'optional boolean',
    },
    examples: [{ projectId: 'project_uuid', castMemberId: 'cast_member_uuid', voiceProvider: 'elevenlabs', voiceId: 'eleven_voice_id' }],
  },
} as const;

export const CONCEPT_ACTION_SPECS = {
  apply_concept: {
    key: 'apply_concept',
    title: 'Apply concept',
    surface: 'concept',
    mutates: true,
    paid: false,
    description: 'Persist a Codex-written locked concept object. Reapplying is the edit path.',
    input: {
      projectId: 'string',
      concept: '{ title, direction, description, mood? }',
      baseHash: 'optional string',
      force: 'optional boolean',
    },
    examples: [{ projectId: 'project_uuid', concept: { title: 'Quiet Signal', direction: '...', description: '...' } }],
  },
} as const;

export const SCRIPT_ACTION_SPECS = {
  apply_script: {
    key: 'apply_script',
    title: 'Apply script',
    surface: 'script',
    mutates: true,
    paid: false,
    description: 'Persist project cast, environments, scenes, and shots. Accepts structured script JSON or one Mirage script markdown draft.',
    input: {
      projectId: 'string',
      script: 'optional structured script object',
      markdown: 'optional mirage-script-v1 markdown',
      baseFingerprint: 'optional string',
      force: 'optional boolean; bypasses fingerprint drift only',
      allowDownstreamVisualWipe: 'dangerous optional boolean; required to replace topology when generated references, boards, videos, or locks exist',
    },
    examples: [{ projectId: 'project_uuid', markdown: '---\\nformat: mirage-script-v1\\n...' }],
  },
  apply_text_edits: {
    key: 'apply_text_edits',
    title: 'Apply text edits',
    surface: 'script',
    mutates: true,
    paid: false,
    description: 'Persist low-blast-radius wording edits on existing scenes/shots only. Use after references, boards, or videos exist. Cannot add/delete/re-ID topology; direction changes mark board/video stale, dialogue changes mark audio stale.',
    input: {
      projectId: 'string',
      edits: 'array of {shotId?, sceneId?, sceneTitle?, direction?, dialogue?: [{dialogueId, text}]} keyed only by existing IDs',
    },
    examples: [{
      projectId: 'project_uuid',
      edits: [{
        shotId: 'shot_uuid',
        direction: 'The Boss crosses the red room slowly, keeping her knife hand hidden.',
        dialogue: [{ dialogueId: 'dialogue_uuid', text: 'You should have stayed gone.' }],
      }],
    }],
  },
  add_shot: {
    key: 'add_shot',
    title: 'Add shot',
    surface: 'script',
    mutates: true,
    paid: false,
    description: 'Insert one shot into an existing scene without rebuilding the whole script. Preserves existing refs, boards, videos, and locks; only the affected scene order and continuity-neighbor stale state change.',
    input: {
      projectId: 'string',
      sceneId: 'existing scene ID',
      afterShotId: 'optional shot ID in the same scene; insert after it',
      beforeShotId: 'optional shot ID in the same scene; insert before it',
      direction: 'required visible shot direction',
      durationSec: 'optional seconds; defaults to 8; Seedance/storyboard shots must be <=15',
      castIds: 'optional existing cast IDs',
      environmentId: 'optional existing environment ID',
      continuityFrom: 'optional cut | prev_shot',
      workflowMode: 'optional auto | storyboard | keyframe',
      visualPrompt: 'optional exact visual prompt if already written',
      motionPrompt: 'optional exact motion prompt if already written',
      storyboardPrompt: 'optional exact storyboard prompt if already written',
      storyboardCutPlan: 'optional storyboard cut plan paired with storyboardPrompt',
    },
    examples: [{
      projectId: 'project_uuid',
      sceneId: 'scene_uuid',
      afterShotId: 'shot_uuid',
      direction: 'Padma leans toward the podcast mic, raises one hand, and begins the punchline.',
      durationSec: 8,
      castIds: ['padma_uuid'],
      environmentId: 'studio_uuid',
      workflowMode: 'keyframe',
    }],
  },
  delete_shot: {
    key: 'delete_shot',
    title: 'Delete shot',
    surface: 'script',
    mutates: true,
    paid: false,
    description: 'Remove one shot from an existing scene without rebuilding the whole script. Refuses by default when the shot has frames, boards, videos, audio, locks, or asset rows; pass force only after explicit approval. Forced deletes detach paid asset rows with recovery metadata instead of hard-deleting them.',
    input: {
      projectId: 'string',
      shotId: 'existing shot ID',
      force: 'optional boolean; required when this shot has downstream generated work',
      note: 'optional deletion reason for the journal/event log',
    },
    examples: [{ projectId: 'project_uuid', shotId: 'shot_uuid', force: false }],
  },
  apply_shot_prompts: {
    key: 'apply_shot_prompts',
    title: 'Apply shot prompts',
    surface: 'script',
    mutates: true,
    paid: false,
    description: 'Persist Codex-written visual, motion, direction, or continuity prompt text for one or more shots. This is the prompt-edit path; use it when the artist asks for a tonal/wording change rather than a media regenerate.',
    input: {
      projectId: 'string',
      shots: 'array of {shotId, visualPrompt?, motionPrompt?, direction?, continuityFrom?, baseHash?}',
      force: 'optional boolean',
    },
    examples: [{ projectId: 'project_uuid', shots: [{ shotId: 'shot_uuid', motionPrompt: 'Slow push-in.' }] }],
  },
  apply_shot_workflow_modes: {
    key: 'apply_shot_workflow_modes',
    title: 'Apply shot workflow modes',
    surface: 'script',
    mutates: true,
    paid: false,
    description: 'Persist per-shot workflow path overrides: auto, storyboard, or keyframe.',
    input: {
      projectId: 'string',
      shots: 'array of {shotId, workflowMode, note?}',
    },
    examples: [{ projectId: 'project_uuid', shots: [{ shotId: 'shot_uuid', workflowMode: 'storyboard' }] }],
  },
} as const;

export const STYLE_ACTION_SPECS = {
  generate_style_candidates: {
    key: 'generate_style_candidates',
    title: 'Generate style candidates',
    surface: 'style',
    mutates: true,
    paid: true,
    description: 'Generate reusable style reference candidates. Agent-native path: pass Codex-written directions[] to skip backend style brainstorming and render each direction. Use guideAssetId for upload-as-guide, note for web/direct soft direction, or promptOverride for one exact candidate.',
    input: {
      projectId: 'string',
      note: 'optional string',
      promptOverride: 'optional exact final style prompt; returns one candidate',
      directions: 'optional array of {title?, description}; skips brainstorm and renders each direction',
      guideAssetId: 'optional uploaded style guide asset id',
      count: 'optional 1-4',
      contextOverrides: 'optional context controls, e.g. { includeConcept: false, includeProjectStyleDescription: false, includeGuideAsset: false, styleNoteSections: { include: ["image"] } }',
    },
    examples: [{ projectId: 'project_uuid', directions: [{ title: 'Clean Anime Ink', description: 'Crisp character lines, soft painted backgrounds, bright daylight palette, low-grit texture.' }] }],
  },
  identify_style: {
    key: 'identify_style',
    title: 'Identify style',
    surface: 'style',
    mutates: false,
    paid: true,
    materializeForAgent: false,
    description: 'Analyze the locked or provided style asset and return a concise style description for artist confirmation.',
    input: {
      projectId: 'string',
      assetId: 'optional style asset id; defaults to locked style',
    },
    examples: [{ projectId: 'project_uuid' }],
  },
  apply_style_direction: {
    key: 'apply_style_direction',
    title: 'Apply style direction',
    surface: 'style',
    mutates: true,
    paid: false,
    description: 'Persist style direction text and/or lock an existing style asset as the project style. When locking a style asset with empty style text, Mirage auto-identifies a concise style description.',
    input: {
      projectId: 'string',
      style: '{ styleDescription?, styleGenerationPrompt?, colorPalette?, sourceAssetId? }',
      baseHash: 'optional string',
      force: 'optional boolean',
    },
    examples: [{ projectId: 'project_uuid', style: { sourceAssetId: 'asset_uuid', styleDescription: 'soft luminous anime portrait style' } }],
  },
} as const;

export const SYSTEM_ACTION_SPECS = {
  list_workflows: {
    key: 'list_workflows',
    title: 'List workflows',
    surface: 'system',
    mutates: false,
    paid: false,
    description: 'List named Mirage workflow recipes such as Yapper or HF music-video planning. Use this when an artist asks to apply a repeatable production format before writing prompts by hand.',
    input: {},
    examples: [{}],
  },
  apply_project_workflow: {
    key: 'apply_project_workflow',
    title: 'Apply project workflow',
    surface: 'system',
    mutates: true,
    paid: false,
    description: 'Apply one named workflow recipe to a project. This writes the recipe-owned prompt override(s), real project preferences, and durable workflow metadata so future generation can fill slots instead of rewriting the wrapper.',
    input: {
      projectId: 'string',
      name: 'workflow recipe name, e.g. "yapper" or "hf_music_video"',
    },
    examples: [{ projectId: 'project_uuid', name: 'hf_music_video' }],
  },
  apply_project_settings: {
    key: 'apply_project_settings',
    title: 'Apply project settings',
    surface: 'system',
    mutates: true,
    paid: false,
    description: 'Persist project-level format settings such as aspectRatio before visual generation. Use this for portrait/landscape/square project format, not model/provider preferences.',
    input: {
      projectId: 'string',
      settings: '{ aspectRatio?: "16:9" | "9:16" | "1:1" }',
      allowExistingVisualsStale: 'optional boolean; required to change format after visual assets exist',
    },
    examples: [{ projectId: 'project_uuid', settings: { aspectRatio: '9:16' } }],
  },
  rename_project: {
    key: 'rename_project',
    title: 'Rename project',
    surface: 'system',
    mutates: true,
    paid: false,
    description: 'Rename the project shell title shown in project lists, the sidebar, and the web studio header. Use this when the working title has diverged from the concept title and the artist confirms the new name. Does not touch concept, script, or any other graph content.',
    input: {
      projectId: 'string',
      title: 'string, 1-160 chars',
    },
    examples: [{ projectId: 'project_uuid', title: 'Beautiful Killers' }],
  },
  apply_project_preferences: {
    key: 'apply_project_preferences',
    title: 'Apply project preferences',
    surface: 'system',
    mutates: true,
    paid: false,
    description: 'Persist project-level model/provider preferences such as textProvider, imageModel, storyboardProvider, videoModel, and ttsModel.',
    input: {
      projectId: 'string',
      preferences: '{ textProvider?, imageModel?, storyboardProvider?, videoModel?, ttsModel? }',
      baseHash: 'optional string',
    },
    examples: [{ projectId: 'project_uuid', preferences: { videoModel: 'seedance-2.0-fast', ttsModel: 'eleven_v3' } }],
  },
  apply_project_style_notes: {
    key: 'apply_project_style_notes',
    title: 'Apply project style notes',
    surface: 'system',
    mutates: true,
    paid: false,
    description: 'Persist per-surface project style notes learned during production — the editable taste/technique memory the project graph carries into every relevant call. Use this when the same phrasing or technique keeps improving outputs and should become project data rather than a per-call note. Lighter than apply_project_prompt_override (that one carries a full recipe; this one carries phrasing fragments).',
    input: {
      projectId: 'string',
      styleNotes: '{ image?, storyboard?, motion?, script?, dialogue?, audio?, modelPhrases? }',
      baseHash: 'optional string',
    },
    examples: [{
      projectId: 'project_uuid',
      styleNotes: {
        image: 'Flat deadpan anime lighting, clean gray bunker palette, crisp simple shadows.',
        storyboard: 'Use readable 2x3 panel boards with restrained blocking and no decorative camera drama.',
      },
    }],
  },
  apply_project_prompt_override: {
    key: 'apply_project_prompt_override',
    title: 'Apply project prompt override',
    surface: 'system',
    mutates: true,
    paid: false,
    description: 'Persist a project-scoped complete prompt recipe override for one declared kind. Use when the same complete per-call promptOverride keeps working and should become the project default. For repeated phrasing or per-surface taste fragments, prefer apply_project_style_notes (lighter, graph-data, composer-injected).',
    input: {
      projectId: 'string',
      kind: 'prompt override kind',
      body: 'string',
      baseHash: 'optional string',
    },
    examples: [{ projectId: 'project_uuid', kind: 'character_looks', body: 'Keep character references compact and faithful to the locked style.' }],
  },
  revert_project_prompt_override: {
    key: 'revert_project_prompt_override',
    title: 'Revert project prompt override',
    surface: 'system',
    mutates: true,
    paid: false,
    description: 'Remove or roll back a project-scoped prompt recipe override so the engine uses the previous active recipe or global default.',
    input: {
      projectId: 'string',
      kind: 'prompt override kind',
      baseHash: 'optional string',
    },
    examples: [{ projectId: 'project_uuid', kind: 'storyboard' }],
  },
} as const;

export const ALL_ACTION_SPECS = {
  ...CONCEPT_ACTION_SPECS,
  ...SCRIPT_ACTION_SPECS,
  ...STYLE_ACTION_SPECS,
  ...SYSTEM_ACTION_SPECS,
  ...LOOK_ACTION_SPECS,
  ...STORYBOARD_ACTION_SPECS,
  ...VIDEO_ACTION_SPECS,
  ...AUDIO_ACTION_SPECS,
} as const;

export type ActionKey = keyof typeof ALL_ACTION_SPECS;
export type ActionSurface = typeof ALL_ACTION_SPECS[ActionKey]['surface'];

export const ACTION_KEYS = Object.keys(ALL_ACTION_SPECS) as [ActionKey, ...ActionKey[]];
export const ACTION_SURFACES = [...new Set(Object.values(ALL_ACTION_SPECS).map((spec) => spec.surface))] as [ActionSurface, ...ActionSurface[]];

export const actionSpec = (actionKey?: string | null) => (
  actionKey ? ALL_ACTION_SPECS[actionKey as ActionKey] : undefined
);

export const isPaidActionKey = (actionKey?: string | null) => Boolean(actionSpec(actionKey)?.paid);

export const actionSpecsForSurface = (surface?: ActionSurface | null) =>
  Object.values(ALL_ACTION_SPECS).filter((spec) => !surface || spec.surface === surface);

export type MirageActionSpec = typeof ALL_ACTION_SPECS[ActionKey];

export const isMaterializedAgentActionSpec = (spec: MirageActionSpec) =>
  !('materializeForAgent' in spec) || spec.materializeForAgent !== false;

export const summarizeActionSpec = (spec: MirageActionSpec) => ({
  key: spec.key,
  title: spec.title,
  surface: spec.surface,
  paid: spec.paid,
  mutates: spec.mutates,
  summary: spec.description,
  detailTool: 'describe_action',
  detailInput: { actionKey: spec.key },
});

export const buildActionSchemaPayload = (actions = actionSpecsForSurface()) => ({
  actions,
  count: actions.length,
});

export const buildActionSchemaIndex = (actions = actionSpecsForSurface()) => ({
  actions: actions.map(summarizeActionSpec),
  count: actions.length,
  surfaces: ACTION_SURFACES,
});

const stableJson = (value: unknown): string => {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object') {
      return Object.keys(item as Record<string, unknown>)
        .sort()
        .reduce((acc, key) => {
          acc[key] = normalize((item as Record<string, unknown>)[key]);
          return acc;
        }, {} as Record<string, unknown>);
    }
    return item;
  };
  return JSON.stringify(normalize(value));
};

export const buildActionsHash = (): string =>
  crypto.createHash('sha256').update(stableJson(buildActionSchemaPayload().actions)).digest('hex');
