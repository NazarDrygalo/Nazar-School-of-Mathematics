-- Idempotent delivery tracking for scheduled-session reminder emails.
-- Run after 20260818170000_portal_onboarding.sql and
-- 20260813_workflow_notifications.sql.

alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_event_type_check;

alter table public.notification_deliveries
  add constraint notification_deliveries_event_type_check
  check (event_type in (
    'session_created',
    'session_updated',
    'session_reminder',
    'change_requested',
    'change_resolved'
  ));

alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_recipient_role_check;

alter table public.notification_deliveries
  add constraint notification_deliveries_recipient_role_check
  check (recipient_role in ('administrator', 'parent', 'student', 'tutor'));

comment on table public.notification_deliveries is
  'Idempotent delivery history for workflow and scheduled-session emails. Browser roles cannot write this table.';
