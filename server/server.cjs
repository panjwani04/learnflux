// ══════════════════════════════════════════════════════════════════
// Learnflux — Production Server
// Features: Supabase DB, auth middleware, document chunking,
//           parallel AI calls, multi-doc tutor, progress tracking
// ══════════════════════════════════════════════════════════════════

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const express  = require('express');
const multer   = require('multer');
const pdf      = require('pdf-parse');
const fs       = require('fs');
const cors     = require('cors');
const crypto      = require('crypto');
const nodemailer  = require('nodemailer');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const app = express();
app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

if (!fs.existsSync('uploads/')) fs.mkdirSync('uploads/');
const upload = multer({ dest: 'uploads/', limits: { fileSize: 50 * 1024 * 1024 } });

// ── Environment ────────────────────────────────────────────────────
const GROQ_API_KEY         = process.env.GROQ_API_KEY;
const PEXELS_API_KEY       = process.env.PEXELS_API_KEY       || '';
const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const WORKOS_API_KEY       = process.env.WORKOS_API_KEY       || '';
const WORKOS_CLIENT_ID     = process.env.WORKOS_CLIENT_ID     || '';
const WORKOS_REDIRECT_URI  = process.env.WORKOS_REDIRECT_URI  ||
    (process.env.NODE_ENV === 'production'
        ? 'https://learnflux-rho.vercel.app/auth/callback'
        : 'http://localhost:5173/auth/callback');

// ── TTS Providers ────────────────────────────────────────────────────
// Priority: Google Cloud TTS → OpenAI TTS → Microsoft Edge TTS (always free)
//
// Microsoft Edge TTS is the default — no API key, neural quality, free forever.
// Google / OpenAI keys override it when set.

const GOOGLE_TTS_API_KEY = process.env.GOOGLE_TTS_API_KEY || '';
const GTTS_VOICE_EN      = 'en-US-Wavenet-B';
const GTTS_VOICE_HI      = 'hi-IN-Wavenet-B';

const OPENAI_API_KEY     = process.env.OPENAI_API_KEY || '';
const OPENAI_TTS_VOICE   = 'onyx';

// Edge TTS voices (Microsoft neural, same engine as Azure TTS, free)
const EDGE_VOICE_EN      = 'en-US-GuyNeural';    // deep male English
const EDGE_VOICE_HI      = 'hi-IN-MadhurNeural'; // male Hindi

const AUDIO_BUCKET       = 'lesson-audio';
const audioCache         = new Map();      // key → { buf, contentType }
const audioInFlight      = new Map();      // key → Promise<{buf,contentType}>

const gttsConfigured   = !!GOOGLE_TTS_API_KEY;
const openaiConfigured = !!OPENAI_API_KEY;
// Edge TTS is always available — no key needed
console.log(
    gttsConfigured   ? '✓ Google Cloud TTS configured' :
    openaiConfigured ? `✓ OpenAI TTS configured — voice: ${OPENAI_TTS_VOICE}` :
                       '✓ Microsoft Edge TTS ready (free, neural quality)'
);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Unified TTS — Google → OpenAI → Microsoft Edge TTS */
async function generateTTS(text, language) {
    if (gttsConfigured)   { const buf = await generateGoogleTTS(text, language); return { buf, contentType: 'audio/mpeg' }; }
    if (openaiConfigured) return generateOpenAITTS(text, language);
    return generateEdgeTTS(text, language);
}

/** Generate MP3 audio via Google Cloud TTS REST API */
async function generateGoogleTTS(text, language) {
    const textSlice  = text.slice(0, 4800);
    const langCode   = language === 'hi' ? 'hi-IN' : 'en-US';
    const voiceName  = language === 'hi' ? GTTS_VOICE_HI : GTTS_VOICE_EN;
    console.log(`[TTS] Google TTS | lang=${language} | voice=${voiceName} | chars=${textSlice.length}`);
    const res = await fetch(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_TTS_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: { text: textSlice }, voice: { languageCode: langCode, name: voiceName, ssmlGender: 'MALE' }, audioConfig: { audioEncoding: 'MP3', speakingRate: 0.92, pitch: -1.0 } }) }
    );
    if (!res.ok) { const e = await res.text(); throw new Error(`Google TTS ${res.status}: ${e}`); }
    const data = await res.json();
    if (!data.audioContent) throw new Error('Google TTS returned no audioContent');
    const buf = Buffer.from(data.audioContent, 'base64');
    console.log(`[TTS] ✓ Google TTS ${buf.length} bytes`);
    return buf;
}

/** Generate MP3 via OpenAI TTS */
async function generateOpenAITTS(text, language) {
    const textSlice = text.slice(0, 4096);
    console.log(`[TTS] OpenAI TTS | voice=${OPENAI_TTS_VOICE} | lang=${language} | chars=${textSlice.length}`);
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'tts-1', input: textSlice, voice: OPENAI_TTS_VOICE, response_format: 'mp3', speed: 0.95 }),
    });
    if (!res.ok) { const e = await res.text(); throw new Error(`OpenAI TTS ${res.status}: ${e}`); }
    const buf = Buffer.from(await res.arrayBuffer());
    console.log(`[TTS] ✓ OpenAI TTS ${buf.length} bytes`);
    return { buf, contentType: 'audio/mpeg' };
}

/** Generate MP3 via Microsoft Edge TTS — free, neural voices, no API key needed */
async function generateEdgeTTS(text, language) {
    const voice = language === 'hi' ? EDGE_VOICE_HI : EDGE_VOICE_EN;
    console.log(`[TTS] Edge TTS | voice=${voice} | chars=${text.length}`);
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const chunks = [];
    const { audioStream } = tts.toStream(text);
    await new Promise((resolve, reject) => {
        audioStream.on('data',  chunk => chunks.push(chunk));
        audioStream.on('end',   resolve);
        audioStream.on('error', reject);
    });
    const buf = Buffer.concat(chunks);
    console.log(`[TTS] ✓ Edge TTS ${buf.length} bytes`);
    return { buf, contentType: 'audio/mpeg' };
}

// ── Welcome Email ────────────────────────────────────────────────
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || 'Learnflux <noreply@learnflux.io>';

let mailTransport = null;
if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    mailTransport = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    console.log('✓ SMTP email configured');
} else {
    console.log('⚠  SMTP not configured — welcome emails disabled');
}

// Track users who already received a welcome email (persists for server lifetime)
const welcomedUsers = new Set();

async function sendWelcomeEmail(user) {
    if (!mailTransport) return;
    const email = user.email;
    if (!email || welcomedUsers.has(email)) return;
    welcomedUsers.add(email);

    const name = user.firstName || user.email.split('@')[0];
    try {
        await mailTransport.sendMail({
            from: SMTP_FROM,
            to: email,
            subject: 'Welcome to Learnflux! 🎓',
            html: `
                <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
                    <h1 style="color:#6366f1;">Welcome to Learnflux, ${name}!</h1>
                    <p>Thanks for signing up. You now have access to all features:</p>
                    <ul>
                        <li><strong>Upload PDFs</strong> — Get AI-powered notes, summaries & quizzes</li>
                        <li><strong>AI Tutor</strong> — Ask questions about your study material</li>
                        <li><strong>Flashcards & Mind Maps</strong> — Visual study aids</li>
                        <li><strong>Lesson Player</strong> — Watch AI-generated video lessons</li>
                    </ul>
                    <p>Start by uploading your first PDF!</p>
                    <p style="color:#94a3b8;font-size:0.85rem;margin-top:30px;">— The Learnflux Team</p>
                </div>
            `,
        });
        console.log(`[Email] Welcome email sent to ${email}`);
    } catch (err) {
        console.error(`[Email] Failed to send welcome email to ${email}:`, err.message);
    }
}

async function groqWithRetry(prompt, maxTokens, retries = 4) {
    const delays = [8000, 12000, 20000, 30000]; // progressive back-off
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await groqFast(prompt, maxTokens);
        } catch (e) {
            const is429 = e.message?.includes('429') || e.message?.includes('rate') || e.message?.includes('Rate limit');
            if (is429 && attempt < retries) {
                const wait = delays[attempt] || 30000;
                console.warn(`[AI] Rate limit hit, waiting ${wait / 1000}s before retry ${attempt + 1}/${retries}...`);
                await sleep(wait);
            } else {
                // Tag the error so callers know it was a rate-limit exhaustion
                if (is429) e.rateLimited = true;
                throw e;
            }
        }
    }
}

// ── Supabase Admin Client (optional) ──────────────────────────────
let db = null;
if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    const { createClient } = require('@supabase/supabase-js');
    db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false }
    });
    console.log('✓ Supabase connected');
} else {
    console.log('⚠  Supabase not configured — running in guest mode (localStorage only)');
}

// ── Helpers ────────────────────────────────────────────────────────
// groqFast  — llama-3.1-8b-instant  : 30,000 TPM (used for structured upload/reanalyze calls)
// groq      — llama-3.3-70b-versatile : 6,000 TPM  (used for tutor where quality matters)
async function groqCall(prompt, maxTokens, model) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
            max_tokens: maxTokens,
        })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`Groq ${res.status}: ${json.error?.message}`);
    let content = json.choices[0].message.content || '';
    content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    return content;
}
async function groq(prompt, maxTokens = 2048)     { return groqCall(prompt, maxTokens, 'llama-3.3-70b-versatile'); }
async function groqFast(prompt, maxTokens = 2048) { return groqCall(prompt, maxTokens, 'llama-3.1-8b-instant');    }

function parseJSON(raw, fallback) {
    if (!raw) return fallback;
    // Strip any remaining DeepSeek <think> blocks and markdown fences
    let cleaned = raw
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
    try {
        return JSON.parse(cleaned);
    } catch {
        // Extract first complete JSON object from the text
        try {
            const start = cleaned.indexOf('{');
            const end   = cleaned.lastIndexOf('}');
            if (start !== -1 && end !== -1 && end > start) {
                return JSON.parse(cleaned.slice(start, end + 1));
            }
        } catch { /* fall through */ }
        return fallback;
    }
}

// ── RAG: In-memory chunk store ───────────────────────────────────────
// docStore: Map<docId, [{text, index}]>
// Persists for the life of the server process; survives route changes.
const docStore = new Map();

function splitIntoChunks(text, size = 1200, overlap = 150) {
    // Prefer paragraph-based splitting for natural boundaries
    const paras = text.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 30);
    const chunks = [];
    let buf = '';
    for (const para of paras) {
        if (buf.length > 0 && (buf + '\n\n' + para).length > size) {
            chunks.push(buf.trim());
            // keep last ~overlap chars as context bridge into next chunk
            const tail = buf.slice(-overlap);
            buf = tail + '\n\n' + para;
        } else {
            buf = buf ? buf + '\n\n' + para : para;
        }
    }
    if (buf.trim().length > 50) chunks.push(buf.trim());

    // Fallback: character-based if paragraph splitting produced < 2 chunks
    if (chunks.length < 2) {
        chunks.length = 0;
        for (let i = 0; i < text.length; i += size - overlap) {
            const c = text.slice(i, i + size).trim();
            if (c.length > 50) chunks.push(c);
        }
    }
    return chunks.map((text, index) => ({ text, index }));
}

const STOP_WORDS = new Set(['the','a','an','in','on','at','to','for','of','and','or','is','are','was','were','be','been','have','has','had','do','does','did','will','would','could','should','this','that','it','its','with','by','from','as','but','not','they','we','you','he','she','his','her']);

function tokenize(text) {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function bm25Score(queryTokens, docTokens, docLen, avgDocLen, docFreqs, totalDocs, k1 = 1.5, b = 0.75) {
    const tf = {};
    for (const t of docTokens) tf[t] = (tf[t] || 0) + 1;
    let score = 0;
    for (const qt of queryTokens) {
        if (!tf[qt]) continue;
        const idf = Math.log((totalDocs - (docFreqs[qt] || 0) + 0.5) / ((docFreqs[qt] || 0) + 0.5) + 1);
        const tfNorm = (tf[qt] * (k1 + 1)) / (tf[qt] + k1 * (1 - b + b * docLen / avgDocLen));
        score += idf * tfNorm;
    }
    return score;
}

function retrieveChunks(query, chunks, topK = 5) {
    if (!chunks || chunks.length === 0) return [];
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return chunks.slice(0, topK);

    const tokenizedChunks = chunks.map(c => tokenize(c.text));
    const avgDocLen = tokenizedChunks.reduce((s, t) => s + t.length, 0) / tokenizedChunks.length;

    // Pre-compute document frequencies
    const docFreqs = {};
    for (const tokens of tokenizedChunks) {
        const seen = new Set();
        for (const t of tokens) { if (!seen.has(t)) { docFreqs[t] = (docFreqs[t] || 0) + 1; seen.add(t); } }
    }

    return chunks
        .map((c, i) => ({ ...c, score: bm25Score(queryTokens, tokenizedChunks[i], tokenizedChunks[i].length, avgDocLen, docFreqs, chunks.length) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
}

// ── Single-call AI pipeline ─────────────────────────────────────────
// Sample beginning + middle + end so large PDFs are represented fully.
// llama-3.1-8b-instant: 30k TPM — 10k chars ≈ 2500 tokens input, well within limit.
function sampleDocument(text, maxChars = 10000) {
    if (text.length <= maxChars) return text;
    const third = Math.floor(maxChars / 3);
    const mid   = Math.floor(text.length / 2);
    const start  = text.slice(0, third);
    const middle = text.slice(mid - Math.floor(third / 2), mid + Math.floor(third / 2));
    const end    = text.slice(text.length - third);
    return `[BEGINNING]\n${start}\n\n[MIDDLE]\n${middle}\n\n[END]\n${end}`;
}

function buildStudyPrompt(text) {
    return `You are an expert teacher. Analyze this study material and return ONLY valid JSON — no other text, no markdown fences.

Return exactly this JSON structure filled with real content from the document:
{"title":"document title","summary":"4-5 sentence summary of the document","keyPoints":["key point 1","key point 2","key point 3","key point 4","key point 5"],"explanation":["paragraph explaining main concepts","paragraph with more detail and examples","paragraph with conclusions and applications"],"definitions":[{"term":"Term1","definition":"definition of term1"},{"term":"Term2","definition":"definition of term2"},{"term":"Term3","definition":"definition of term3"}],"flashcards":[{"question":"question 1","answer":"answer 1"},{"question":"question 2","answer":"answer 2"},{"question":"question 3","answer":"answer 3"},{"question":"question 4","answer":"answer 4"},{"question":"question 5","answer":"answer 5"}],"quiz":[{"question":"question 1","options":["A. option","B. option","C. option","D. option"],"answer":"A"},{"question":"question 2","options":["A. option","B. option","C. option","D. option"],"answer":"B"},{"question":"question 3","options":["A. option","B. option","C. option","D. option"],"answer":"C"},{"question":"question 4","options":["A. option","B. option","C. option","D. option"],"answer":"D"},{"question":"question 5","options":["A. option","B. option","C. option","D. option"],"answer":"A"}],"mindMap":{"topic":"main topic","nodes":[{"title":"subtopic 1","children":["detail","detail","detail"]},{"title":"subtopic 2","children":["detail","detail"]},{"title":"subtopic 3","children":["detail","detail","detail"]},{"title":"subtopic 4","children":["detail","detail"]}]},"summaryHindi":"4-5 sentence summary in Hindi script","keyPointsHindi":["key point 1 in Hindi","key point 2 in Hindi","key point 3 in Hindi"],"explanationHindi":["explanation paragraph 1 in Hindi","explanation paragraph 2 in Hindi"]}

Rules:
- Return ONLY the JSON object
- Fill ALL fields with real content from the document
- quiz "answer" must be exactly "A", "B", "C", or "D"
- Write summaryHindi, keyPointsHindi, explanationHindi in Devanagari script

Study material:
${text}`;
}

async function processDocument(text, fallbackTitle) {
    const context = sampleDocument(text, 10000);
    console.log(`[AI] Single call — doc: ${text.length} chars, sampled: ${context.length} chars`);
    let raw;
    let rateLimited = false;
    try {
        raw = await groqWithRetry(buildStudyPrompt(context), 2500);
    } catch (e) {
        if (e.rateLimited) {
            console.warn('[AI] All retries exhausted due to rate limit — returning empty lesson');
            rateLimited = true;
        } else {
            throw e;
        }
    }
    const data = raw ? parseJSON(raw, null) : null;

    if (!data) {
        console.warn('[AI] Failed to parse response. Raw start:', raw?.slice(0, 200));
        return { title: fallbackTitle, summary: '', keyPoints: [], explanation: [], definitions: [], quiz: [], flashcards: [], mindMap: null, summaryHindi: '', keyPointsHindi: [], explanationHindi: [], rateLimited };
    }

    const toArr = (v) => Array.isArray(v) ? v : (typeof v === 'string' && v ? [v] : []);
    const result = {
        title:            data.title            || fallbackTitle,
        summary:          data.summary          || '',
        keyPoints:        toArr(data.keyPoints),
        explanation:      toArr(data.explanation),
        definitions:      Array.isArray(data.definitions) ? data.definitions.filter(d => d.term && d.definition) : [],
        quiz:             Array.isArray(data.quiz)        ? data.quiz        : [],
        flashcards:       Array.isArray(data.flashcards)  ? data.flashcards  : [],
        mindMap:          data.mindMap?.nodes?.length > 0 ? data.mindMap     : null,
        summaryHindi:     data.summaryHindi     || '',
        keyPointsHindi:   toArr(data.keyPointsHindi),
        explanationHindi: toArr(data.explanationHindi),
    };
    // Flag as incomplete if critical fields missing (partial parse)
    const incomplete = !result.keyPoints.length || !result.quiz.length;
    if (incomplete) result.rateLimited = rateLimited || true;
    console.log(`[AI] Done — points:${result.keyPoints.length} quiz:${result.quiz.length} flashcards:${result.flashcards.length} mindMap:${!!result.mindMap} rateLimited:${!!result.rateLimited}`);
    return result;
}

// ── Auth Middleware ─────────────────────────────────────────────────
async function optionalAuth(req, _res, next) {
    req.user = null;
    if (!db) return next();
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return next();
    try {
        const { data: { user }, error } = await db.auth.getUser(token);
        if (!error && user) req.user = user;
    } catch { /* pass */ }
    next();
}

async function requireAuth(req, res, next) {
    await optionalAuth(req, res, () => {});
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
    next();
}

// ── Routes ──────────────────────────────────────────────────────────
app.get('/', (_req, res) => res.json({ status: 'Learnflux server running', db: !!db }));

// ── POST /upload ─────────────────────────────────────────────────────
app.post('/upload', upload.single('file'), optionalAuth, async (req, res) => {
    try {
        const buf  = fs.readFileSync(req.file.path);
        const data = await pdf(buf);
        fs.unlink(req.file.path, () => {});

        const fullText     = data.text;
        const documentText = fullText.slice(0, 60000); // stored for tutor
        const fileName     = req.file?.originalname?.replace(/\.pdf$/i, '') || 'Study Notes';
        console.log(`[PDF] ${fullText.length} chars total`);

        const lesson = {
            ...await processDocument(fullText, fileName),
            documentText,
        };

        // ── Save to Supabase if user is authenticated ────────────────
        if (db && req.user) {
            const { data: row, error } = await db.from('lessons').insert({
                user_id:      req.user.id,
                title:        lesson.title,
                summary:      lesson.summary,
                explanation:  lesson.explanation,
                key_points:   lesson.keyPoints,
                definitions:  lesson.definitions,
                quiz:         lesson.quiz,
                flashcards:   lesson.flashcards,
                mind_map:     lesson.mindMap,
                document_text: documentText,
            }).select('id').single();

            if (!error && row) lesson.id = row.id; // use Supabase UUID as lesson id
        }

        res.json(lesson);

    } catch (err) {
        console.error('Upload error:', err.message);
        res.status(500).json({ error: 'AI processing temporarily unavailable. Please try again.' });
    }
});

// ── GET /lessons — fetch all lessons for authenticated user ──────────
app.get('/lessons', requireAuth, async (req, res) => {
    const { data, error } = await db
        .from('lessons')
        .select('*')
        .eq('user_id', req.user.id)
        .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
});

// ── GET /lessons/:id — single lesson ────────────────────────────────
app.get('/lessons/:id', requireAuth, async (req, res) => {
    const { data, error } = await db
        .from('lessons')
        .select('*')
        .eq('id', req.params.id)
        .eq('user_id', req.user.id)
        .single();

    if (error) return res.status(404).json({ error: 'Lesson not found.' });
    res.json(data);
});

// ── PATCH /lessons/:id — update progress (study time, review, score) ─
app.patch('/lessons/:id', requireAuth, async (req, res) => {
    const allowed = ['study_time_secs', 'review_count', 'best_quiz_score', 'last_studied_at', 'next_review_at'];
    const updates = {};
    for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (!Object.keys(updates).length) return res.json({ ok: true });

    const { data, error } = await db
        .from('lessons')
        .update(updates)
        .eq('id', req.params.id)
        .eq('user_id', req.user.id)
        .select()
        .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// ── DELETE /lessons/:id ─────────────────────────────────────────────
app.delete('/lessons/:id', requireAuth, async (req, res) => {
    const { error } = await db
        .from('lessons')
        .delete()
        .eq('id', req.params.id)
        .eq('user_id', req.user.id);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// ── POST /index — chunk & store document for RAG ─────────────────────
app.post('/index', optionalAuth, (req, res) => {
    const { docId, documentText } = req.body;
    if (!docId || !documentText) return res.status(400).json({ error: 'docId and documentText required.' });
    const chunks = splitIntoChunks(documentText);
    docStore.set(String(docId), chunks);
    console.log(`[RAG] Indexed docId=${docId} → ${chunks.length} chunks`);
    res.json({ ok: true, chunks: chunks.length });
});

// ── POST /ask — RAG-powered AI tutor ─────────────────────────────────
app.post('/ask', optionalAuth, async (req, res) => {
    try {
        const { question, docIds, documentText, allDocuments } = req.body;
        if (!question) return res.status(400).json({ error: 'No question provided.' });

        let context = '';
        let ragUsed = false;

        // ── RAG path: retrieve relevant chunks from indexed documents ──
        const ids = Array.isArray(docIds) ? docIds.map(String) : [];
        // Gather chunks: use specified docIds, or all indexed docs as fallback
        const allChunks = ids.length > 0
            ? ids.flatMap(id => docStore.get(id) || [])
            : [...docStore.values()].flat();

        if (allChunks.length > 0) {
            const topChunks = retrieveChunks(question, allChunks, 5);
            context = topChunks.map((c, i) => `[Excerpt ${i + 1}]\n${c.text}`).join('\n\n');
            ragUsed = true;
            console.log(`[RAG] Retrieved ${topChunks.length} chunks (scores: ${topChunks.map(c => c.score?.toFixed(2)).join(', ')})`);
        }
        // ── Fallback: use raw text sent from client ────────────────────
        else if (allDocuments && Array.isArray(allDocuments) && allDocuments.length > 1) {
            context = allDocuments
                .slice(0, 3)
                .map((doc, i) => `[Document ${i + 1}: "${doc.title}"]\n${(doc.text || '').slice(0, 8000)}`)
                .join('\n\n---\n\n');
        } else {
            context = (documentText || '').slice(0, 10000);
        }

        const prompt = `You are a helpful AI tutor helping a student understand their study material.

Use the following context to answer the question accurately and clearly. If the answer is not in the context, say so honestly.

Context:
${context}

Student's question: ${question}

Answer:`;

        const answer = await groq(prompt, 1500);
        res.json({ answer, ragUsed, chunks: ragUsed ? allChunks.length : 0 });
    } catch (err) {
        console.error('Ask error:', err.message);
        let userMsg = 'AI tutor error. Please try again in a moment.';
        const isRateLimit = err.message?.includes('429') || err.message?.includes('rate') || err.rateLimited;
        if (isRateLimit) userMsg = 'Rate limit reached — please wait 15–30 seconds and try again.';
        else if (err.message?.includes('401')) userMsg = 'AI service authentication failed. Check the API key.';
        else if (err.message?.includes('503') || err.message?.includes('overloaded')) userMsg = 'AI service is busy. Please try again in a few seconds.';
        res.status(500).json({ error: userMsg });
    }
});

// ── POST /reanalyze — regenerate lesson from stored documentText ──────
app.post('/reanalyze', optionalAuth, async (req, res) => {
    try {
        const { documentText: rawText, title: origTitle } = req.body;
        if (!rawText) return res.status(400).json({ error: 'No document text provided.' });
        console.log('[Reanalyze] Starting single-call reanalysis...');
        const result = await processDocument(rawText, origTitle || 'Study Notes');
        res.json({ ...result, documentText: rawText });
    } catch (err) {
        console.error('Reanalyze error:', err.message);
        res.status(500).json({ error: 'Regeneration failed. Please try again.' });
    }
});

// ── POST /generate-audio — per-slide TTS (Google or HuggingFace) ─────
app.post('/generate-audio', async (req, res) => {
    const { text, language = 'en' } = req.body;
    if (!text) return res.status(400).json({ error: 'text required' });
    // Edge TTS is always available — never return { available: false } for per-slide audio

    const provider   = gttsConfigured ? 'gtts' : openaiConfigured ? 'openai' : 'edge';
    const cacheKey   = `${provider}:${language}:${crypto.createHash('md5').update(text).digest('hex')}`;
    const storagePath = `${cacheKey}.mp3`;

    const serve = ({ buf, contentType }) => { res.set('Content-Type', contentType); res.send(buf); };

    // 1 — in-memory cache (fastest)
    if (audioCache.has(cacheKey)) {
        console.log(`[TTS] ✓ memory hit ${cacheKey}`);
        return serve(audioCache.get(cacheKey));
    }

    // 2 — deduplicate concurrent requests for the same text
    if (audioInFlight.has(cacheKey)) {
        try {
            return serve(await audioInFlight.get(cacheKey));
        } catch { return res.status(500).json({ error: 'TTS generation failed' }); }
    }

    // 3 — Supabase Storage (survives server restarts), with 5s timeout
    if (db) {
        try {
            const { data: stored, error: dlErr } = await Promise.race([
                db.storage.from(AUDIO_BUCKET).download(storagePath),
                new Promise((_, rej) => setTimeout(() => rej(new Error('storage timeout')), 5000)),
            ]);
            if (!dlErr && stored) {
                const buf = Buffer.from(await stored.arrayBuffer());
                const contentType = 'audio/mpeg';
                const entry = { buf, contentType };
                audioCache.set(cacheKey, entry);
                console.log(`[TTS] ✓ storage hit ${cacheKey} (${buf.length} bytes)`);
                return serve(entry);
            }
        } catch (e) { console.warn('[TTS] storage check skipped:', e.message); }
    }

    // 4 — Generate via configured TTS provider (deduplicated)
    const genPromise = (async () => {
        const entry = await generateTTS(text, language);
        audioCache.set(cacheKey, entry);

        // Persist to Supabase Storage (non-blocking)
        if (db) {
            db.storage.from(AUDIO_BUCKET)
                .upload(storagePath, entry.buf, { contentType: entry.contentType, upsert: false })
                .then(({ error }) => { if (error) console.warn('[TTS] storage upload:', error.message); })
                .catch(() => {});
        }
        return entry;
    })();

    audioInFlight.set(cacheKey, genPromise);
    try {
        serve(await genPromise);
    } catch (err) {
        console.error('[TTS] /generate-audio failed:', err.message);
        res.status(500).json({ error: 'TTS generation failed', details: err.message });
    } finally {
        audioInFlight.delete(cacheKey);
    }
});

// ── POST /generate-lesson-audio — full-lesson audio (all providers) ──────
// Generates one MP3 for the entire lesson. Edge TTS handles unlimited length.
app.post('/generate-lesson-audio', async (req, res) => {
    const { lessonId, narration, language = 'en' } = req.body;
    if (!narration || !lessonId) return res.status(400).json({ error: 'lessonId and narration required' });

    const cacheKey    = `lesson-${lessonId}-${language}`;
    const storagePath = `${cacheKey}.mp3`;
    const serve       = ({ buf, contentType }) => { res.set('Content-Type', contentType); res.send(buf); };

    // 1 — in-memory
    if (audioCache.has(cacheKey)) {
        console.log(`[TTS] ✓ lesson memory hit: ${cacheKey}`);
        return serve(audioCache.get(cacheKey));
    }

    // 2 — in-flight deduplication
    if (audioInFlight.has(cacheKey)) {
        try { return serve(await audioInFlight.get(cacheKey)); }
        catch { return res.status(500).json({ error: 'TTS generation failed' }); }
    }

    // 3 — Supabase Storage (5s timeout)
    if (db) {
        try {
            const { data: stored, error: dlErr } = await Promise.race([
                db.storage.from(AUDIO_BUCKET).download(storagePath),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
            ]);
            if (!dlErr && stored) {
                const buf = Buffer.from(await stored.arrayBuffer());
                const entry = { buf, contentType: 'audio/mpeg' };
                audioCache.set(cacheKey, entry);
                console.log(`[TTS] ✓ lesson storage hit: ${cacheKey} (${buf.length} bytes)`);
                return serve(entry);
            }
        } catch (e) { console.warn(`[TTS] storage check skipped (${e.message}), generating...`); }
    }

    // 4 — Generate via Google or OpenAI TTS (full lesson narration)
    console.log(`[TTS] generating lesson audio | id=${lessonId} | lang=${language}`);
    const genPromise = (async () => {
        const entry = await generateTTS(narration, language);
        audioCache.set(cacheKey, entry);

        // Persist to Supabase (non-blocking)
        if (db) {
            db.storage.from(AUDIO_BUCKET)
                .upload(storagePath, entry.buf, { contentType: entry.contentType, upsert: true })
                .then(({ error }) => {
                    if (error) console.warn('[TTS] Supabase upload failed:', error.message);
                    else       console.log(`[TTS] ✓ lesson audio saved to storage: ${storagePath}`);
                }).catch(() => {});
        }
        return entry;
    })();

    audioInFlight.set(cacheKey, genPromise);
    try {
        serve(await genPromise);
    } catch (err) {
        console.error('[TTS] lesson audio generation failed:', err.message);
        res.status(500).json({ error: 'TTS generation failed', details: err.message });
    } finally {
        audioInFlight.delete(cacheKey);
    }
});

// ── GET /search-image — Pexels image proxy ───────────────────────────
app.get('/search-image', async (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q || !PEXELS_API_KEY) return res.json({ url: null });
    try {
        const resp = await fetch(
            `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=5&orientation=landscape`,
            { headers: { Authorization: PEXELS_API_KEY } }
        );
        if (!resp.ok) return res.json({ url: null });
        const data = await resp.json();
        const url = data.photos?.[0]?.src?.large2x || data.photos?.[0]?.src?.large || null;
        res.json({ url });
    } catch (e) {
        console.error('[Pexels]', e.message);
        res.json({ url: null });
    }
});

// ── WorkOS AuthKit ──────────────────────────────────────────────────
let workos = null;
if (WORKOS_API_KEY && WORKOS_CLIENT_ID) {
    try {
        const { WorkOS } = require('@workos-inc/node');
        workos = new WorkOS(WORKOS_API_KEY);
        console.log('✓ WorkOS AuthKit configured');
    } catch (e) {
        console.warn('⚠  @workos-inc/node missing — run: npm install @workos-inc/node');
    }
} else {
    console.log('⚠  WORKOS_API_KEY / WORKOS_CLIENT_ID not set — WorkOS auth disabled');
}

// GET /auth/url — returns the WorkOS AuthKit authorization URL
app.get('/auth/url', (req, res) => {
    if (!workos) return res.json({ available: false });
    try {
        const url = workos.userManagement.getAuthorizationUrl({
            clientId: WORKOS_CLIENT_ID,
            redirectUri: WORKOS_REDIRECT_URI,
            provider: 'authkit',
        });
        res.json({ available: true, url });
    } catch (e) {
        console.error('[WorkOS] getAuthorizationUrl error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// POST /auth/exchange — exchanges an authorization code for a user session
app.post('/auth/exchange', async (req, res) => {
    if (!workos) return res.status(503).json({ error: 'WorkOS not configured' });
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Missing code' });
    try {
        const { user, accessToken, refreshToken } = await workos.userManagement.authenticateWithCode({
            clientId: WORKOS_CLIENT_ID,
            code,
        });
        // Send welcome email for first-time users (non-blocking)
        sendWelcomeEmail(user);
        res.json({ user, accessToken, refreshToken });
    } catch (e) {
        console.error('[WorkOS] authenticateWithCode error:', e.message);
        res.status(401).json({ error: e.message });
    }
});

// GET /auth/me — verify a WorkOS access token and return the user
app.get('/auth/me', async (req, res) => {
    if (!workos) return res.status(503).json({ error: 'WorkOS not configured' });
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No token' });
    try {
        const { user } = await workos.userManagement.loadSealedSession({
            sessionData: token,
            cookiePassword: WORKOS_API_KEY,
        });
        res.json({ user });
    } catch (e) {
        res.status(401).json({ error: 'Invalid session' });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Learnflux server running on port ${PORT}`));
