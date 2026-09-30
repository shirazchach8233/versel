create table if not exists public.quiz_question_history (
  user_id uuid not null references public.users(id) on delete cascade,
  question_id text not null,
  topic text,
  viewed_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

comment on table public.quiz_question_history is
  'Durable per-user record of questions displayed in Quiz Mode, including unfinished quizzes.';

alter table public.quiz_question_history enable row level security;
revoke all on table public.quiz_question_history from anon, authenticated;
grant select, insert, update on table public.quiz_question_history to service_role;

create index if not exists quiz_question_history_user_topic_idx
  on public.quiz_question_history (user_id, topic);
