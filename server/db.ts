import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'storage', 'lahari.db');

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read/write performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema ─────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'Untitled',
    status TEXT NOT NULL DEFAULT 'uploaded',
    audio_path TEXT,
    lyrics TEXT,
    musical_structure TEXT,
    concept_options TEXT,
    locked_concept TEXT,
    style_description TEXT,
    style_asset_id TEXT,
    color_palette TEXT,
    meaning TEXT,
    video_mode TEXT DEFAULT 'montage',
    target_duration INTEGER DEFAULT 8,
    cost_estimate REAL DEFAULT 0,
    style_exploration TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS cast_members (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    reference_asset_id TEXT,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    category TEXT NOT NULL,
    file_path TEXT NOT NULL,
    prompt TEXT,
    metadata TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS scenes (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    section_label TEXT,
    start_time TEXT,
    end_time TEXT,
    lyrics TEXT,
    narrative_description TEXT,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS shots (
    id TEXT PRIMARY KEY,
    scene_id TEXT NOT NULL,
    visual_prompt TEXT,
    motion_prompt TEXT DEFAULT 'Cinematic camera movement',
    duration REAL DEFAULT 5,
    cast_ids TEXT DEFAULT '[]',
    image_asset_id TEXT,
    video_asset_id TEXT,
    image_status TEXT DEFAULT 'idle',
    video_status TEXT DEFAULT 'idle',
    critique TEXT,
    attempt_count INTEGER DEFAULT 0,
    use_next_as_end_frame INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS ai_calls (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt TEXT NOT NULL,
    reference_inputs TEXT,
    context_chain TEXT,
    response_summary TEXT,
    output_asset_ids TEXT,
    duration_ms INTEGER,
    cost_estimate REAL DEFAULT 0,
    error TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );
`);

// ─── New tables ──────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS environments (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    reference_asset_id TEXT,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );
`);

// ─── Migrations ──────────────────────────────────────────────────────

// Add meaning column (safe to re-run)
try { db.exec('ALTER TABLE projects ADD COLUMN meaning TEXT'); } catch {}

// Shot columns for end frame + lock + feedback + environment
try { db.exec('ALTER TABLE shots ADD COLUMN end_image_asset_id TEXT'); } catch {}
try { db.exec('ALTER TABLE shots ADD COLUMN end_image_status TEXT DEFAULT \'idle\''); } catch {}
try { db.exec('ALTER TABLE shots ADD COLUMN locked INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE shots ADD COLUMN user_feedback TEXT'); } catch {}
try { db.exec('ALTER TABLE shots ADD COLUMN environment_id TEXT'); } catch {}

// Extracted last frame from generated video — replaces end frame as continuity ref
try { db.exec('ALTER TABLE shots ADD COLUMN extracted_last_frame_asset_id TEXT'); } catch {}

// Vision description of the previous shot's extracted last frame — injected
// as continuity context into this shot's image + motion prompts.
try { db.exec('ALTER TABLE shots ADD COLUMN continuity_description TEXT'); } catch {}

// 'cut' (default) = hard cut, independent shot, can generate in parallel.
// 'prev_shot' = this shot continues from the previous shot's last frame.
try { db.exec("ALTER TABLE shots ADD COLUMN continuity_from TEXT DEFAULT 'cut'"); } catch {}

// Video model: 'veo-3.1' (default), 'seedance-2.0-fast', 'seedance-2.0', etc.
try { db.exec("ALTER TABLE projects ADD COLUMN video_model TEXT DEFAULT 'veo-3.1'"); } catch {}

// Style exploration persistence
try { db.exec('ALTER TABLE projects ADD COLUMN style_exploration TEXT'); } catch {}

export default db;
