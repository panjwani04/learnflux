import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL     = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// App works in guest mode (localStorage only) if Supabase is not configured
export const isSupabaseEnabled = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase = isSupabaseEnabled
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

// Maps DB snake_case columns → JS camelCase lesson object
export function dbLessonToJs(row) {
    return {
        id:             row.id,
        title:          row.title,
        summary:        row.summary,
        explanation:    row.explanation,
        keyPoints:      row.key_points   || [],
        definitions:    row.definitions  || [],
        quiz:           row.quiz         || [],
        flashcards:     row.flashcards   || [],
        mindMap:        row.mind_map     || null,
        documentText:   row.document_text || '',
        documentUrl:    row.document_url  || null,
        studyTime:      row.study_time_secs || 0,
        reviewCount:    row.review_count    || 0,
        quizScore:      row.best_quiz_score || 0,
        lastStudied:    row.last_studied_at ? new Date(row.last_studied_at).getTime() : null,
        nextReviewDate: row.next_review_at  ? new Date(row.next_review_at).getTime()  : null,
        date:           row.created_at,
        fromDB:         true,
    };
}
