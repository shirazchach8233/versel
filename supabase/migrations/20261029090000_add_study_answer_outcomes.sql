alter table public.study_question_history
  add column if not exists is_correct boolean,
  add column if not exists selected_answer integer,
  add column if not exists answered_at timestamptz;

comment on column public.study_question_history.is_correct is
  'Whether the user selected the official answer while viewing the question in Study Mode.';
