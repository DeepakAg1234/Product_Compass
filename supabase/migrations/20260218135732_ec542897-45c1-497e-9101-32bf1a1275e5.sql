-- Add unique constraint for calendar event upsert
ALTER TABLE public.meetings
ADD CONSTRAINT meetings_user_id_calendar_event_id_key UNIQUE (user_id, calendar_event_id);