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
      entityIds: 'string[]',
      note: 'optional string',
      promptOverride: 'optional string; only one entityId may be used',
      guideAssetId: 'optional existing Mirage asset id',
    },
    examples: [{
      projectId: 'project_uuid',
      entityType: 'cast',
      entityIds: ['cast_member_uuid'],
      note: 'make the outfit simpler and closer to the locked style reference',
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
    },
    examples: [{ projectId: 'project_uuid', shotId: 'shot_uuid', dryRun: true }],
  },
  bulk_generate_storyboards: {
    key: 'bulk_generate_storyboards',
    title: 'Bulk generate storyboards',
    surface: 'storyboard',
    mutates: true,
    paid: true,
    description: 'Generate missing/stale/error storyboard boards for selected shots. Use parallel_run for custom parallel batches.',
    input: {
      projectId: 'string',
      shotIds: 'optional string[]',
      force: 'optional boolean',
      artistNote: 'optional soft direction',
      modelOverride: 'optional storyboardProvider override',
    },
    examples: [{ projectId: 'project_uuid', shotIds: ['shot_a', 'shot_b'], force: true }],
  },
  apply_storyboard_prompts: {
    key: 'apply_storyboard_prompts',
    title: 'Apply storyboard prompts',
    surface: 'storyboard',
    mutates: true,
    paid: false,
    description: 'Persist storyboard prompt/cut-plan text. Accepts either structured shots[] or one scene markdown draft.',
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
    description: 'Edit the current storyboard image using artist feedback. This is image-edit mode, not prompt text persistence.',
    input: {
      projectId: 'string',
      shotId: 'string',
      feedback: 'string',
      previousVersionId: 'optional string',
      modelOverride: 'optional storyboardProvider override',
    },
    examples: [{ projectId: 'project_uuid', shotId: 'shot_uuid', feedback: 'make the pose less dramatic' }],
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
  generate_video: {
    key: 'generate_video',
    title: 'Generate video',
    surface: 'video',
    mutates: true,
    paid: true,
    description: 'Generate the video clip for one shot. dryRun returns requirements, provider, and cost without spending.',
    input: {
      projectId: 'string',
      shotId: 'string',
      dryRun: 'optional boolean',
      promptOverride: 'optional exact final video prompt',
      modelOverride: 'optional videoModel override',
    },
    examples: [{ projectId: 'project_uuid', shotId: 'shot_uuid', dryRun: true }],
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
  generate_dialogue_audio: {
    key: 'generate_dialogue_audio',
    title: 'Generate dialogue audio',
    surface: 'audio',
    mutates: true,
    paid: true,
    description: 'Generate ElevenLabs TTS for selected pending/error dialogue lines. dryRun returns cost and missing voices without spending.',
    input: {
      projectId: 'string',
      dryRun: 'optional boolean',
      shotIds: 'optional string[]',
      dialogueIds: 'optional string[]',
      characterIds: 'optional string[]',
    },
    examples: [{ projectId: 'project_uuid', dryRun: true, shotIds: ['shot_uuid'] }],
  },
  apply_audio_plan: {
    key: 'apply_audio_plan',
    title: 'Apply audio plan',
    surface: 'audio',
    mutates: true,
    paid: false,
    description: 'Persist per-shot dialogue, sound notes, and lipsync/overlay strategy. Accepts structured shots[] or one audio-plan markdown draft.',
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

export const ALL_ACTION_SPECS = {
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
