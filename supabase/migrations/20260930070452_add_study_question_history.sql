create table if not exists public.study_question_history (
  user_id uuid not null references public.users(id) on delete cascade,
  question_id text not null,
  topic text,
  viewed_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

comment on table public.study_question_history is
  'Durable per-user record of questions viewed in Study Mode.';

alter table public.study_question_history enable row level security;
revoke all on table public.study_question_history from anon, authenticated;
grant select, insert, update on table public.study_question_history to service_role;

create index if not exists study_question_history_user_topic_idx
  on public.study_question_history (user_id, topic);
