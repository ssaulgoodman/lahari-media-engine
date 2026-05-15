-- Per-user, per-song mnemonic labels. Shows on the queue dashboard next to
-- the (often long, often Sanskrit) song name. One row per (user, song) — a
-- user can only have one note per song; new note overwrites the old via
-- upsert. Empty/whitespace note → row is deleted entirely (see PUT route).
--
-- Why per song_id and not queue_id: notes stick to the SONG. Priority shuffles
-- and re-queues can rotate queue ids; the artist's "this is the sculptor video"
-- should survive.
--
-- 200-char limit because these are mnemonics, not essays. Keeps the row small
-- and the dashboard render predictable.

create table if not exists public.lahari_song_notes (
  user_id uuid not null references auth.users(id) on delete cascade,
  song_id uuid not null,
  note text not null check (length(note) <= 200 and length(trim(note)) > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, song_id)
);

-- Dashboard query path is "give me all of this user's notes" — single index
-- on user_id covers it.
create index if not exists lahari_song_notes_user_idx
  on public.lahari_song_notes (user_id);
