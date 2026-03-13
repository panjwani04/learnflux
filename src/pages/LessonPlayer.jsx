import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Pause, SkipBack, SkipForward, ChevronLeft, Repeat, BookOpen, Maximize2, Minimize2, Volume2 } from 'lucide-react';
import { API } from '../lib/api';
import './LessonPlayer.css';

/* ── Browser TTS fallback ── */
if (typeof window !== 'undefined') {
    speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
}

function pickMaleVoice(voices, langCode) {
    const maleNames = ['david', 'mark', 'james', 'daniel', 'google uk english male', 'microsoft david', 'microsoft mark', 'microsoft ravi', 'male'];
    const langVoices = voices.filter(v => v.lang === langCode || v.lang.startsWith(langCode.split('-')[0]));
    const male = langVoices.find(v => maleNames.some(m => v.name.toLowerCase().includes(m)));
    if (male) return male;
    if (langVoices.length > 0) return langVoices[0];
    return null;
}

function speakBrowser(text, language, onDone) {
    if (!('speechSynthesis' in window)) { onDone?.(); return; }
    const utterance  = new SpeechSynthesisUtterance(text);
    const voices     = speechSynthesis.getVoices();
    const langCode   = language === 'hi' ? 'hi-IN' : 'en-US';
    const selected   = pickMaleVoice(voices, langCode);
    utterance.lang   = langCode;
    utterance.pitch  = 0.9;
    utterance.rate   = 0.95;
    if (selected)    utterance.voice = selected;
    utterance.onend  = onDone || null;
    utterance.onerror = () => onDone?.();
    speechSynthesis.cancel();
    // Small delay ensures cancel() finishes before new speak() — fixes Chrome/iOS issues
    setTimeout(() => {
        try { speechSynthesis.speak(utterance); }
        catch { onDone?.(); }
    }, 50);
}

/* ── Image fetching ── */
function cleanKeyword(text) {
    if (!text) return 'education';
    const stop = new Set(['and','the','of','in','a','an','to','for','with','is','are','chapter','unit','lesson','part','section','introduction','class','std','cbse','ncert','by','from','on','as','or','its','their','this','that','these','those','how','what','why','when','where']);
    const clean = text.split(' ').filter(w => w.length > 2 && !stop.has(w.toLowerCase())).slice(0, 3).join(' ').trim();
    return clean || text.split(' ').slice(0, 2).join(' ');
}

async function fetchPexelsImage(keyword) {
    if (!keyword?.trim()) return null;
    try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(`${API}/search-image?q=${encodeURIComponent(keyword)}`, { signal: controller.signal });
        clearTimeout(t);
        if (!res.ok) return null;
        const data = await res.json();
        return data.url || null;
    } catch { return null; }
}

async function fetchWikiImage(keyword) {
    if (!keyword?.trim()) return null;
    try {
        const term = keyword.split(' ').slice(0, 2).join('_');
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 4000);
        const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term)}`, { signal: controller.signal });
        clearTimeout(t);
        if (!res.ok) return null;
        const data = await res.json();
        const src = data.thumbnail?.source;
        return src ? src.replace(/\/\d+px-/, '/800px-') : null;
    } catch { return null; }
}

function getPicsumUrl(keyword) {
    const seed = (keyword || 'study').replace(/\s+/g, '-').slice(0, 40);
    return `https://picsum.photos/seed/${seed}/900/500`;
}

async function fetchSlideImage(rawKeyword) {
    const keyword = cleanKeyword(rawKeyword);
    const pexels = await fetchPexelsImage(keyword);
    if (pexels) return pexels;
    const firstWord = keyword.split(' ')[0];
    if (firstWord && firstWord !== keyword) {
        const pexels2 = await fetchPexelsImage(firstWord);
        if (pexels2) return pexels2;
    }
    const wiki = await fetchWikiImage(keyword);
    if (wiki) return wiki;
    return getPicsumUrl(keyword);
}

/* ── Build slides ── */
function buildSlides(lesson) {
    const pts            = lesson.keyPoints       || [];
    const keyPointsHindi = lesson.keyPointsHindi  || [];
    const explHindi      = lesson.explanationHindi || [];
    const slides = [];

    slides.push({ type: 'intro', title: lesson.title, body: lesson.summary || '', bodyHindi: lesson.summaryHindi || '', keyword: lesson.title });

    pts.forEach((pt, i) => {
        slides.push({ type: 'point', index: i + 1, total: pts.length, body: pt, bodyHindi: keyPointsHindi[i] || '', keyword: pt.replace(/^(the|a|an|in|of|for|to)\s+/i, '').split(' ').slice(0, 4).join(' ') });
    });

    const explanationParagraphs = Array.isArray(lesson.explanation)
        ? lesson.explanation.filter(p => p && p.length > 20)
        : (lesson.explanation || '').split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 50);

    explanationParagraphs.forEach((para, i) => {
        slides.push({ type: 'explain', index: i + 1, body: para, bodyHindi: explHindi[i] || '', keyword: lesson.title });
    });

    if ((lesson.definitions || []).length > 0) {
        slides.push({ type: 'defs', defs: lesson.definitions, keyword: 'education vocabulary', body: lesson.definitions.map(d => `${d.term}: ${d.definition}`).join('. '), bodyHindi: '' });
    }

    return slides;
}

function cleanText(t) {
    return String(t || '').replace(/\s+/g, ' ').trim();
}

/* ── Fetch full lesson audio (one call per lesson) ── */
async function fetchLessonAudio(lessonId, narration, language) {
    if (!narration?.trim() || !lessonId) return null;
    try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 90000); // 90s — full lesson generation can be slow
        const res = await fetch(`${API}/generate-lesson-audio`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lessonId, narration, language }),
            signal: controller.signal,
        });
        clearTimeout(t);
        if (!res.ok) { console.warn('[audio] /generate-lesson-audio returned', res.status); return null; }
        const ct = res.headers.get('Content-Type') || '';
        if (ct.includes('audio')) return URL.createObjectURL(await res.blob());
        const data = await res.json();
        if (data.available === false) { console.log('[audio] ElevenLabs not configured'); return null; }
        console.warn('[audio] unexpected response', data);
        return null;
    } catch (e) {
        console.warn('[audio] fetchLessonAudio failed:', e.message);
        return null;
    }
}

/* ── iOS/mobile audio unlock ──────────────────────────────────────
   iOS Safari blocks audio from async callbacks. We must call both
   audio.play() AND speechSynthesis.speak() synchronously inside a
   user gesture (click) before any async audio can play.
─────────────────────────────────────────────────────────────────── */
let _iosUnlocked    = false;
let _speechUnlocked = false;
// 1ms silent MP3 — used to unlock the audio context on iOS
const SILENT_MP3 = 'data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU2LjM2LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDV1dXV1dXV1dXV1dXV1dXV1dXV1dXV6urq6urq6urq6urq6urq6urq6urq6v////////////////////////////////8AAAAATGF2YzU2LjQxAAAAAAAAAAAAAAAAJAAAAAAAAAAAASDs90hvAAAAAAAAAAAAAAAAAAAA//MUZAAAAAGkAAAAAAAAA0gAAAAATEFN//MUZAMAAAGkAAAAAAAAA0gAAAAARTMu//MUZAYAAAGkAAAAAAAAA0gAAAAAOTku//MUZAkAAAGkAAAAAAAAA0gAAAAANVVV';

/* iOS audio unlock — uses a SEPARATE temporary audio element so we never
   touch the main audioRef, which holds the lesson audio src.             */
function unlockAudio() {
    if (!_iosUnlocked) {
        _iosUnlocked = true;
        // Temporary element only — never overwrites the lesson audio element
        const tmp = new Audio(SILENT_MP3);
        tmp.play().catch(() => {});
    }
    if (!_speechUnlocked && 'speechSynthesis' in window) {
        _speechUnlocked = true;
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0; u.rate = 10;
        speechSynthesis.speak(u);
    }
}

function buildSlideText(s) {
    if (!s) return '';
    return s.type === 'intro'   ? `${s.title}. ${s.body}` :
           s.type === 'point'   ? `Key point ${s.index} of ${s.total}. ${s.body}` :
           s.type === 'explain' ? (s.body || '') :
           `Key definitions. ${(s.defs || []).map(d => `${d.term}: ${d.definition}`).join('. ')}`;
}

async function fetchAudio(text, language) {
    if (!text?.trim()) return null;
    try {
        const controller = new AbortController();
        // 12-second timeout — enough for OpenAI TTS (~2-4s), falls to browser TTS on failure
        const t = setTimeout(() => controller.abort(), 12000);
        const res = await fetch(`${API}/generate-audio`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, language }),
            signal: controller.signal,
        });
        clearTimeout(t);
        const ct = res.headers.get('Content-Type') || '';
        if (res.ok && ct.includes('audio')) return URL.createObjectURL(await res.blob());
        return null;
    } catch { return null; }
}


/* ── Format seconds to M:SS ── */
function fmtTime(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
}

/* ── AI Avatar ── */
function AIAvatar({ speaking }) {
    return (
        <div className={`av-wrap${speaking ? ' av-on' : ''}`}>
            <div className="av-ring" />
            <div className="av-body">
                <svg viewBox="0 0 100 100" className="av-face">
                    <circle cx="50" cy="50" r="50" fill="#0a120a" />
                    <circle cx="50" cy="40" r="26" fill="#0f1f0f" stroke="#3ddc84" strokeWidth="1.5" />
                    <ellipse cx="40" cy="36" rx="4.5" ry={speaking ? 5.5 : 3.5} fill="#3ddc84" />
                    <ellipse cx="60" cy="36" rx="4.5" ry={speaking ? 5.5 : 3.5} fill="#3ddc84" />
                    <circle cx="41" cy="37" r="2" fill="#070d07" /><circle cx="61" cy="37" r="2" fill="#070d07" />
                    <circle cx="42" cy="35.5" r="1" fill="white" opacity="0.8" /><circle cx="62" cy="35.5" r="1" fill="white" opacity="0.8" />
                    {speaking
                        ? <ellipse cx="50" cy="50" rx="8" ry="5" fill="#3ddc84" />
                        : <path d="M42 50 Q50 57 58 50" stroke="#3ddc84" strokeWidth="2.5" fill="none" strokeLinecap="round" />
                    }
                    <path d="M10 100 Q18 72 38 70 L62 70 Q82 72 90 100 Z" fill="#0f1f0f" stroke="#3ddc84" strokeWidth="1.5" />
                    <circle cx="50" cy="84" r="9" fill="#3ddc84" />
                    <text x="50" y="88.5" textAnchor="middle" fill="#070d07" fontSize="9" fontWeight="bold" fontFamily="sans-serif">AI</text>
                </svg>
            </div>
            {speaking && (
                <div className="av-bars">
                    {[0,1,2,3,4].map(i => <div key={i} className="av-bar" style={{ '--i': i }} />)}
                </div>
            )}
        </div>
    );
}

/* ── Slide type config ── */
const SLIDE_STYLE = {
    intro:   { overlay: 'rgba(7,13,7,0.62)',  accent: '#3ddc84', label: 'Overview'    },
    point:   { overlay: 'rgba(7,13,7,0.60)',  accent: '#3ddc84', label: 'Key Point'   },
    explain: { overlay: 'rgba(7,13,7,0.60)',  accent: '#f59e0b', label: 'Explanation' },
    defs:    { overlay: 'rgba(7,13,7,0.60)',  accent: '#a78bfa', label: 'Definitions' },
};

/* ── Main component ── */
function LessonPlayer() {
    const navigate   = useNavigate();
    const lesson     = JSON.parse(localStorage.getItem('learnflux_current') || 'null');
    const slides     = lesson ? buildSlides(lesson) : [];

    const [idx,           setIdx]          = useState(0);
    const [direction,     setDirection]    = useState('next'); // 'next' | 'prev'
    const [playing,       setPlaying]      = useState(false);
    const [autoAdv,       setAutoAdv]      = useState(true);
    const [bgImg,         setBgImg]        = useState(null);
    const [bgReady,       setBgReady]      = useState(false);
    const [language,      setLanguage]     = useState('en');
    const [fullscreen,    setFullscreen]   = useState(false);
    const [elapsed,       setElapsed]      = useState(0);
    const [slideElapsed,  setSlideElapsed] = useState(0);
    const [lessonAudioUrl, setLessonAudioUrl] = useState(null);  // objectURL from /generate-lesson-audio
    const [audioReady,    setAudioReady]   = useState(false);    // true once <audio> can play
    const [audioFetching, setAudioFetching] = useState(false);  // true while /generate-lesson-audio is in progress

    const stateRef      = useRef({ idx: 0, auto: true });
    const speakRef      = useRef(null);
    const langRef       = useRef('en');
    const audioRef      = useRef(null);   // lesson audio element (full-lesson mp3)
    const slideAudioRef = useRef(null);   // temporary per-slide Audio() for doSpeak
    const genRef        = useRef(0);
    const containerRef  = useRef(null);
    const timerRef      = useRef(null);
    const slideTimerRef = useRef(null);

    useEffect(() => { stateRef.current.idx  = idx;     }, [idx]);
    useEffect(() => { stateRef.current.auto = autoAdv; }, [autoAdv]);
    useEffect(() => { langRef.current       = language;}, [language]);

    useEffect(() => { speechSynthesis.getVoices(); }, []);

    /* Fraction (0–1) where each slide starts in the full lesson audio */
    const slideFractions = useMemo(() => {
        const lengths = slides.map(s => {
            const lang = language === 'hi' && s.bodyHindi ? 'hi' : 'en';
            return (lang === 'hi' ? s.bodyHindi : buildSlideText(s)).length;
        });
        const total = lengths.reduce((a, b) => a + b, 0) || 1;
        let cum = 0;
        return lengths.map(len => { const f = cum / total; cum += len; return f; });
    }, [slides, language]);

    /* Fetch ONE audio file for the entire lesson — fires once per language change */
    useEffect(() => {
        if (!lesson?.id) return;
        setLessonAudioUrl(null);
        setAudioReady(false);
        const narration = slides.map(s => {
            const lang = language === 'hi' && s.bodyHindi ? 'hi' : 'en';
            return lang === 'hi' ? s.bodyHindi : buildSlideText(s);
        }).join('. ');
        console.log(`[audio] fetching lesson audio | id=${lesson.id} | lang=${language} | chars=${narration.length}`);
        setAudioFetching(true);
        fetchLessonAudio(lesson.id, narration, language).then(url => {
            setAudioFetching(false);
            if (url) { console.log('[audio] ✓ lesson audio ready'); setLessonAudioUrl(url); }
            else      { console.log('[audio] ElevenLabs unavailable — using browser TTS'); }
        });
    }, [language]); // eslint-disable-line react-hooks/exhaustive-deps

    /* When lessonAudioUrl arrives, wire up the <audio> element */
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio || !lessonAudioUrl) { setAudioReady(false); return; }
        audio.src = lessonAudioUrl;
        audio.load();
        const onCanPlay = () => setAudioReady(true);
        const onEnded   = () => setPlaying(false);
        audio.addEventListener('canplay', onCanPlay);
        audio.addEventListener('ended',   onEnded);
        return () => {
            audio.removeEventListener('canplay', onCanPlay);
            audio.removeEventListener('ended',   onEnded);
        };
    }, [lessonAudioUrl]);

    /* Auto-advance slides based on audio playback position */
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;
        const handler = () => {
            if (!audio.duration || !stateRef.current.auto) return;
            const frac    = audio.currentTime / audio.duration;
            let   newIdx  = 0;
            for (let i = slideFractions.length - 1; i >= 0; i--) {
                if (frac >= slideFractions[i]) { newIdx = i; break; }
            }
            if (newIdx !== stateRef.current.idx) {
                const dir = newIdx > stateRef.current.idx ? 'next' : 'prev';
                stateRef.current.idx = newIdx;
                setDirection(dir);
                setIdx(newIdx);
            }
        };
        audio.addEventListener('timeupdate', handler);
        return () => audio.removeEventListener('timeupdate', handler);
    }, [slideFractions]);

    /* Background image per slide */
    useEffect(() => {
        if (!slides[idx]?.keyword) return;
        setBgImg(null); setBgReady(false);
        let alive = true;
        fetchSlideImage(slides[idx].keyword).then(url => { if (alive && url) setBgImg(url); });
        return () => { alive = false; };
    }, [idx]);

    /* Global elapsed timer — runs while playing */
    useEffect(() => {
        if (playing) {
            timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
        } else {
            clearInterval(timerRef.current);
        }
        return () => clearInterval(timerRef.current);
    }, [playing]);

    /* Per-slide elapsed timer — resets on slide change */
    useEffect(() => {
        setSlideElapsed(0);
        if (playing) {
            slideTimerRef.current = setInterval(() => setSlideElapsed(e => e + 1), 1000);
        }
        return () => clearInterval(slideTimerRef.current);
    }, [idx, playing]);

    /* Fullscreen change listener */
    useEffect(() => {
        const handler = () => setFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', handler);
        return () => document.removeEventListener('fullscreenchange', handler);
    }, []);

    const toggleFullscreen = () => {
        if (!fullscreen) {
            containerRef.current?.requestFullscreen?.();
        } else {
            document.exitFullscreen?.();
        }
    };

    /* Stop all audio — pause lesson element, destroy per-slide element, cancel TTS */
    const stopAudio = useCallback(() => {
        genRef.current += 1;
        if (audioRef.current) { audioRef.current.pause(); }
        if (slideAudioRef.current) { slideAudioRef.current.pause(); slideAudioRef.current = null; }
        speechSynthesis.cancel();
    }, []);

    useEffect(() => () => stopAudio(), [stopAudio]);

    /* Per-slide TTS — tries server audio (HF/Google) first, then browser TTS */
    const doSpeak = useCallback(async (si) => {
        const s = slides[si];
        if (!s) return;
        const gen       = ++genRef.current;
        const wantHindi = langRef.current === 'hi';
        const text      = wantHindi && s.bodyHindi?.trim() ? s.bodyHindi : buildSlideText(s);
        const lang      = wantHindi && s.bodyHindi?.trim() ? 'hi' : 'en';
        const isStale   = () => genRef.current !== gen;

        const onDone = () => {
            if (isStale()) return;
            setTimeout(() => {
                if (isStale()) return;
                setPlaying(false);
                if (!stateRef.current.auto) return;
                const next = stateRef.current.idx + 1;
                if (next < slides.length) {
                    stateRef.current.idx = next;
                    setDirection('next');
                    setIdx(next);
                    setTimeout(() => { if (!isStale()) speakRef.current?.(next); }, 800);
                }
            }, 1000);
        };

        setPlaying(true);

        // Try server TTS (Google or HuggingFace) — falls back to browser TTS on timeout/error
        const audioUrl = await fetchAudio(text, lang);
        if (isStale()) return; // user clicked stop while fetching

        if (audioUrl) {
            // Use a fresh Audio element — never touch audioRef (reserved for lesson audio)
            const audio = new Audio(audioUrl);
            slideAudioRef.current = audio;
            const cleanup = () => {
                slideAudioRef.current = null;
                URL.revokeObjectURL(audioUrl);
                audio.removeEventListener('ended', onEnded);
                audio.removeEventListener('error', onError);
            };
            const onEnded = () => { cleanup(); onDone(); };
            const onError = () => { cleanup(); speakBrowser(text, lang, onDone); };
            audio.addEventListener('ended', onEnded);
            audio.addEventListener('error', onError);
            audio.play().catch(() => { cleanup(); speakBrowser(text, lang, onDone); });
        } else {
            speakBrowser(text, lang, onDone);
        }
    }, [slides]);

    useEffect(() => { speakRef.current = doSpeak; }, [doSpeak]);

    const togglePlay = () => {
        // MUST call unlockAudio synchronously — iOS blocks audio from async callbacks
        unlockAudio();
        if (playing) {
            stopAudio();
            setPlaying(false);
        } else if (lessonAudioUrl && audioReady) {
            // Lesson audio ready — seek to current slide start and play
            const audio = audioRef.current;
            if (audio?.duration) {
                audio.currentTime = slideFractions[idx] * audio.duration;
            }
            audio.play().catch(() => doSpeak(idx));
            setPlaying(true);
        } else {
            // Lesson audio still loading — fall back to browser TTS
            stopAudio();
            doSpeak(idx);
        }
    };

    const goTo = (n, dir) => {
        if (n < 0 || n >= slides.length) return;
        unlockAudio();
        setDirection(dir || (n > idx ? 'next' : 'prev'));
        setIdx(n);
        if (lessonAudioUrl && audioRef.current?.duration) {
            // Seek lesson audio to the new slide's start position
            audioRef.current.currentTime = slideFractions[n] * audioRef.current.duration;
        }
        if (!playing) stopAudio();
    };

    if (!lesson || slides.length === 0) {
        return (
            <div className="lp-empty fade-in">
                <BookOpen size={56} style={{ color: 'var(--text-secondary)' }} />
                <h2>No lesson loaded</h2>
                <p>Upload a PDF first to watch a lesson.</p>
                <button className="btn-primary" onClick={() => navigate('/upload')}>Upload PDF</button>
            </div>
        );
    }

    const slide       = slides[idx];
    const ss          = SLIDE_STYLE[slide.type] || SLIDE_STYLE.intro;
    const pct         = ((idx + 1) / slides.length) * 100;
    const displayText = language === 'hi' && slide.bodyHindi ? slide.bodyHindi : (slide.body || '');
    // Estimate ~45s per slide
    const totalEst    = slides.length * 45;

    return (
        <div className={`lp-page fade-in${fullscreen ? ' lp-fs' : ''}`} ref={containerRef}>

            <audio ref={audioRef} style={{ display: 'none' }} />

            {/* ── Top bar ── */}
            <div className="lp-topbar">
                <button className="lp-back" onClick={() => { stopAudio(); navigate('/result'); }}>
                    <ChevronLeft size={16} /> Back
                </button>
                <span className="lp-lesson-name">{lesson.title}</span>
                <div className="lp-lang-toggle">
                    <span className="lp-lang-label">🌐</span>
                    <button className={`lp-lang-btn${language === 'en' ? ' active' : ''}`}
                        onClick={() => { stopAudio(); setPlaying(false); langRef.current = 'en'; setLanguage('en'); }}>EN</button>
                    <button className={`lp-lang-btn${language === 'hi' ? ' active' : ''}`}
                        onClick={() => { stopAudio(); setPlaying(false); langRef.current = 'hi'; setLanguage('hi'); }}>हिंदी</button>
                </div>
                <button className={`lp-auto${autoAdv ? ' on' : ''}`} onClick={() => setAutoAdv(v => !v)}>
                    <Repeat size={13} /> Auto {autoAdv ? 'On' : 'Off'}
                </button>
                <button className="lp-fs-btn" onClick={toggleFullscreen} title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
                    {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                </button>
            </div>

            {/* ── Progress bar ── */}
            <div className="lp-prog-wrap">
                <div className="lp-prog-track">
                    <div className={`lp-prog-fill${playing ? ' playing' : ''}`}
                        style={{ width: `${pct}%`, '--accent': ss.accent }} />
                </div>
                <div className="lp-time-row">
                    <span className="lp-counter">{idx + 1} / {slides.length} slides</span>
                    <span className="lp-timer">
                        <Volume2 size={11} style={{ opacity: playing ? 1 : 0.4 }} />
                        {fmtTime(elapsed)} · ~{fmtTime(totalEst)}
                    </span>
                </div>
            </div>

            {/* ── Main stage ── */}
            <div className="lp-stage" key={idx} data-dir={direction}>

                {bgImg && (
                    <img src={bgImg} className={`lp-bg${bgReady ? ' ready' : ''}`}
                        onLoad={() => setBgReady(true)} onError={() => setBgImg(null)} alt="" />
                )}
                <div className="lp-overlay" style={{ background: ss.overlay }} />

                {/* Slide content */}
                <div className="lp-inner">
                    <span className="lp-badge" style={{ color: ss.accent, borderColor: ss.accent }}>
                        {ss.label}{slide.index ? ` ${slide.index}/${slide.total ?? slide.index}` : ''}
                    </span>

                    {slide.type === 'intro' && (
                        <div className="lp-body">
                            <h2 className="lp-big-title">{cleanText(slide.title)}</h2>
                            <p className="lp-body-text slide-text">{cleanText(displayText)}</p>
                        </div>
                    )}
                    {slide.type === 'point' && (
                        <div className="lp-body lp-point-body">
                            <div className="lp-bg-num" style={{ color: ss.accent }}>{slide.index}</div>
                            <p className="lp-point-text slide-text">{cleanText(displayText)}</p>
                            <div className="lp-pdots">
                                {Array.from({ length: slide.total }, (_, i) => (
                                    <div key={i} className={`lp-pdot${i < slide.index ? ' done' : ''}${i === slide.index - 1 ? ' cur' : ''}`}
                                        style={i === slide.index - 1 ? { background: ss.accent } : {}} />
                                ))}
                            </div>
                        </div>
                    )}
                    {slide.type === 'explain' && (
                        <div className="lp-body">
                            <p className="lp-explain-text slide-text">{cleanText(displayText)}</p>
                        </div>
                    )}
                    {slide.type === 'defs' && (
                        <div className="lp-body">
                            <div className="lp-defs-grid">
                                {(slide.defs || []).map((d, i) => (
                                    <div key={i} className="lp-def" style={{ '--delay': `${i * 100}ms`, borderLeftColor: ss.accent }}>
                                        <span className="lp-def-term">{d.term}</span>
                                        <span className="lp-def-def">{d.definition}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* ── AI Presenter bar ── */}
                <div className="lp-presenter-bar">
                    <AIAvatar speaking={playing} />
                    <div className="lp-caption-wrap">
                        <span className="lp-caption-label" style={{ color: ss.accent }}>
                            AI Presenter · {language === 'hi' ? 'हिंदी' : 'English'}
                        </span>
                        <p className="lp-caption">
                            {playing
                                ? (language === 'hi' ? 'बोल रहे हैं — ध्यान से सुनें...' : 'Speaking — listen carefully...')
                                : (() => { const t = displayText; return t.slice(0, 120) + (t.length > 120 ? '...' : ''); })()
                            }
                        </p>
                    </div>
                    {/* Per-slide time */}
                    <span className="lp-slide-time">{fmtTime(slideElapsed)}</span>
                </div>
            </div>

            {/* ── Controls ── */}
            <div className="lp-controls">
                <button className="lp-nav" onClick={() => goTo(idx - 1, 'prev')} disabled={idx === 0}>
                    <SkipBack size={18} />
                </button>
                <button className={`lp-play${playing ? ' active' : ''}`} onClick={togglePlay}>
                    {playing ? <Pause size={22} /> : <Play size={22} fill="currentColor" />}
                    <span>{playing ? 'Pause' : audioFetching ? 'Preparing audio...' : audioReady ? 'Play Lesson' : 'Play Lesson'}</span>
                </button>
                {audioFetching && (
                    <span style={{ fontSize: '0.7rem', color: 'var(--accent-color)', opacity: 0.75, marginTop: '4px', display: 'block', textAlign: 'center' }}>
                        ✦ Generating AI voice...
                    </span>
                )}
                <button className="lp-nav" onClick={() => goTo(idx + 1, 'next')} disabled={idx === slides.length - 1}>
                    <SkipForward size={18} />
                </button>
            </div>

            {/* ── Slide dot navigation ── */}
            <div className="lp-dots">
                {slides.map((s, i) => (
                    <button key={i} className={`lp-dot tp-${s.type}${i === idx ? ' active' : ''}`}
                        onClick={() => goTo(i)} title={`Slide ${i + 1}`} />
                ))}
            </div>
        </div>
    );
}

export default LessonPlayer;
