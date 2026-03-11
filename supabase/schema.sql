-- ══════════════════════════════════════════════════
-- StudyAI — Supabase Database Schema
-- Run this in: Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════

-- Lessons table (main content store)
create table if not exists public.lessons (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid references auth.users(id) on delete cascade not null,
    title           text not null default 'Untitled Lesson',
    summary         text,
    explanation     text,
    key_points      jsonb  default '[]'::jsonb,
    definitions     jsonb  default '[]'::jsonb,
    quiz            jsonb  default '[]'::jsonb,
    flashcards      jsonb  default '[]'::jsonb,
    mind_map        jsonb,
    document_url    text,
    document_text   text,
    -- Progress tracking
    study_time_secs integer  default 0,
    review_count    integer  default 0,
    best_quiz_score numeric  default 0,
    last_studied_at timestamptz,
    next_review_at  timestamptz,
    created_at      timestamptz default now(),
    updated_at      timestamptz default now()
);

-- Auto-update updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create or replace trigger lessons_updated_at
    before update on public.lessons
    for each row execute function public.set_updated_at();

-- Row Level Security
alter table public.lessons enable row level security;

create policy "Users can view own lessons"
    on public.lessons for select using (auth.uid() = user_id);

create policy "Users can insert own lessons"
    on public.lessons for insert with check (auth.uid() = user_id);

create policy "Users can update own lessons"
    on public.lessons for update using (auth.uid() = user_id);

create policy "Users can delete own lessons"
    on public.lessons for delete using (auth.uid() = user_id);

-- Supabase Storage bucket for PDFs
insert into storage.buckets (id, name, public)
values ('pdfs', 'pdfs', false)
on conflict (id) do nothing;

create policy "Authenticated users can upload PDFs"
    on storage.objects for insert
    with check (bucket_id = 'pdfs' and auth.role() = 'authenticated');

create policy "Users can access own PDFs"
    on storage.objects for select
    using (bucket_id = 'pdfs' and auth.uid()::text = (storage.foldername(name))[1]);
