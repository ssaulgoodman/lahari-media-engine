-- Persist which renderer path was used and why FFmpeg fell back. This makes
-- render performance diagnosable from lahari_renders without tailing Modal.
alter table lahari_renders
  add column if not exists render_engine text,
  add column if not exists ffmpeg_fallback_reason text;

create index if not exists lahari_renders_render_engine_idx
  on lahari_renders(render_engine, created_at desc);
