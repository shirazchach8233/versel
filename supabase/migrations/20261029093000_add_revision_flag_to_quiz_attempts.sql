alter table public.quiz_attempts
  add column if not exists is_revision boolean not null default false;

comment on column public.quiz_attempts.is_revision is
  'Whether the attempt was launched from Study Review rather than the regular Quiz Mode.';
