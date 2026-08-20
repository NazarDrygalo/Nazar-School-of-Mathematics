-- Add idempotent delivery tracking for weekly family activity summaries.
-- Run after 20260820222420_progress_email_notifications.sql.

alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_event_type_check;

alter table public.notification_deliveries
  add constraint notification_deliveries_event_type_check
  check (event_type in (
    'session_created',
    'session_updated',
    'session_reminder',
    'change_requested',
    'change_resolved',
    'assignment_created',
    'assignment_submitted',
    'assignment_reviewed',
    'assignment_revision_requested',
    'progress_recorded',
    'weekly_family_digest'
  ));

comment on table public.notification_deliveries is
  'Idempotent delivery history for workflow, reminder, and weekly family digest emails. Browser roles cannot write this table.';
