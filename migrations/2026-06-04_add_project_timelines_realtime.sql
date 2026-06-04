ALTER TABLE lahari_project_timelines REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.lahari_project_timelines;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
