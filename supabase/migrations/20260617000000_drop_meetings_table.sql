-- Remove the meetings/calendar feature. The meetings table (calendar events +
-- AI briefs) is no longer used; the prepare-meeting and sync-calendar edge
-- functions are removed and the calendar.readonly OAuth scope is dropped.
-- CASCADE clears the table's RLS policies and any dependent objects.
DROP TABLE IF EXISTS public.meetings CASCADE;
