ALTER TABLE lahari_projects
  ADD COLUMN IF NOT EXISTS storyboard_provider TEXT DEFAULT 'gpt-image-2';

ALTER TABLE lahari_shots
  ADD COLUMN IF NOT EXISTS storyboard_prompt TEXT,
  ADD COLUMN IF NOT EXISTS storyboard_cut_plan TEXT,
  ADD COLUMN IF NOT EXISTS storyboard_prompt_status TEXT DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS storyboard_prompt_user_feedback TEXT;
