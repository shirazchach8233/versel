alter table public.quiz_attempts
  add column if not exists is_pyq boolean not null default false;

comment on column public.quiz_attempts.is_pyq is
  'Whether the attempt came from a Previous Year Question paper rather than Quiz Mode.';
