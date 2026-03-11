import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Pause, SkipBack, SkipForward, ChevronLeft, Repeat, BookOpen } from 'lucide-react';
import './LessonPlayer.css';

/* ── Browser TTS fallback (used when ElevenLabs is not configured) ── */
if (typeof window !== 'undefined') {
    speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
}

function pickMaleVoice(voices, langCode) {
    // Known male voice names across browsers
    const maleNames = ['david', 'mark', 'james', 'daniel', 'google uk english male', 'microsoft david', 'microsoft mark', 'microsoft ravi', 'male'];
    const langVoices = voices.filter(v => v.lang === langCode || v.lang.startsWith(langCode.split('-')[0]));
    // Try to find a male voice by name
    const male = langVoices.find(v => maleNames.some(m => v.name.toLowerCase().includes(m)));
    if (male) return male;
    // For Hindi, pick any available Hindi voice
    if (langVoices.length > 0) return langVoices[0];
    return null;
}

function speakBrowser(text, language, onDone) {
    const utterance  = new SpeechSynthesisUtterance(text);
    const voices     = speechSynthesis.getVoices();
    const langCode   = language === 'hi' ? 'hi-IN' : 'en-US';
    const selected   = pickMaleVoice(voices, langCode);
    utterance.lang   = langCode;
    utterance.pitch  = 0.9;  // slightly lower pitch for deeper male tone
    utterance.rate   = 0.95; // slightly slower for clarity
    if (selected)    utterance.voice = selected;
    if (onDone)      utterance.onend = onDone;
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
}

/* ── Image fetching ──────────────────────────────────────────── */
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
        const res = await fetch(`http://localhost:5000/search-image?q=${encodeURIComponent(keyword)}`, { signal: controller.signal });
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

/* ── Build slides ────────────────────────────────────────────── */
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

/* ── Clean text helper ───────────────────────────────────────── */
function cleanText(t) {
    return String(t || '').replace(/\s+/g, ' ').trim();
}

/* ── Module-level audio cache (persists across navigations) ──── */
// Values: blob URL string = ready, 'pending' = generating, absent = not started
const _audioCache = new Map();

function buildSlideText(s) {
    if (!s) return '';
    return s.type === 'intro'   ? `${s.title}. ${s.body}` :
           s.type === 'point'   ? `Key point ${s.index} of ${s.total}. ${s.body}` :
           s.type === 'explain' ? (s.body || '') :
           `Key definitions. ${(s.defs || []).map(d => `${d.term}: ${d.definition}`).join('. ')}`;
}

async function fetchAudio(text, language) {
    if (!text?.trim()) return null;
    console.log('Selected language:', language);
    console.log('Text sent to audio generator:', text);
    console.log(`[Audio] Fetching ${language.toUpperCase()} audio | "${text.slice(0, 80)}..."`);
    try {
        const res = await fetch('http://localhost:5000/generate-audio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, language }),
        });
        const ct = res.headers.get('Content-Type') || '';
        if (res.ok && ct.includes('audio')) {
            console.log(`[Audio] ✓ ${language.toUpperCase()} audio received`);
            return URL.createObjectURL(await res.blob());
        }
        if (res.ok) console.warn('[Audio] Server returned JSON (ElevenLabs not configured) — using browser TTS');
        else        console.error('[Audio] Server error', res.status, await res.text().catch(() => ''));
        return null;
    } catch (e) { console.error('[Audio] Fetch failed:', e.message); return null; }
}

function cacheAudio(key, text, language) {
    if (_audioCache.has(key)) return; // already cached or generating
    _audioCache.set(key, 'pending');
    fetchAudio(text, language).then(url => {
        if (url) _audioCache.set(key, url);
        else     _audioCache.delete(key); // clear pending so it can retry
    });
}

/* ── AI Avatar ───────────────────────────────────────────────── */
function AIAvatar({ speaking }) {
    return (
        <div className={`av-wrap${speaking ? ' av-on' : ''}`}>
            <div className="av-ring" />
            <div className="av-body">
                <svg viewBox="0 0 100 100" className="av-face">
                    <circle cx="50" cy="50" r="50" fill="#1e1b4b" />
                    <circle cx="50" cy="40" r="26" fill="#312e81" stroke="#6366f1" strokeWidth="1.5" />
                    <ellipse cx="40" cy="36" rx="4.5" ry={speaking ? 5.5 : 3.5} fill="#a5b4fc" />
                    <ellipse cx="60" cy="36" rx="4.5" ry={speaking ? 5.5 : 3.5} fill="#a5b4fc" />
                    <circle cx="41" cy="37" r="2" fill="#0f172a" /><circle cx="61" cy="37" r="2" fill="#0f172a" />
                    <circle cx="42" cy="35.5" r="1" fill="white" opacity="0.8" /><circle cx="62" cy="35.5" r="1" fill="white" opacity="0.8" />
                    {speaking
                        ? <ellipse cx="50" cy="50" rx="8" ry="5" fill="#4f46e5" />
                        : <path d="M42 50 Q50 57 58 50" stroke="#6366f1" strokeWidth="2.5" fill="none" strokeLinecap="round" />
                    }
                    <path d="M10 100 Q18 72 38 70 L62 70 Q82 72 90 100 Z" fill="#312e81" stroke="#6366f1" strokeWidth="1.5" />
                    <circle cx="50" cy="84" r="9" fill="#4f46e5" />
                    <text x="50" y="88.5" textAnchor="middle" fill="white" fontSize="9" fontWeight="bold" fontFamily="sans-serif">AI</text>
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

/* ── Slide type config ───────────────────────────────────────── */
const SLIDE_STYLE = {
    intro:   { overlay: 'rgba(10,6,40,0.58)',  accent: '#6366f1', label: 'Overview'    },
    point:   { overlay: 'rgba(2,18,10,0.58)',  accent: '#10b981', label: 'Key Point'   },
    explain: { overlay: 'rgba(18,10,0,0.58)',  accent: '#f59e0b', label: 'Explanation' },
    defs:    { overlay: 'rgba(18,2,16,0.58)',  accent: '#ec4899', label: 'Definitions' },
};

/* ── Main component ──────────────────────────────────────────── */
function LessonPlayer() {
    const navigate = useNavigate();
    const lesson   = JSON.parse(localStorage.getItem('learnflux_current') || 'null');
    const slides   = lesson ? buildSlides(lesson) : [];

    const [idx,          setIdx]         = useState(0);
    const [playing,      setPlaying]     = useState(false);
    const [autoAdv,      setAutoAdv]     = useState(true);
    const [bgImg,        setBgImg]       = useState(null);
    const [bgReady,      setBgReady]     = useState(false);
    const [language,     setLanguage]    = useState('en');
    const [audioLoading, setAudioLoading] = useState(false);

    const stateRef = useRef({ idx: 0, auto: true });
    const speakRef = useRef(null);
    const langRef  = useRef('en');
    const audioRef = useRef(null); // <audio> element
    const pollRef  = useRef(null); // interval ID for pending-audio poll
    const genRef   = useRef(0);    // generation counter — incremented on every slide change/stop

    useEffect(() => { stateRef.current.idx  = idx;     }, [idx]);
    useEffect(() => { stateRef.current.auto = autoAdv; }, [autoAdv]);
    useEffect(() => { langRef.current       = language;}, [language]);

    /* Trigger async voice load on mount */
    useEffect(() => { speechSynthesis.getVoices(); }, []);

    /* Pre-generate audio for ALL slides when language changes (fires on mount too) */
    useEffect(() => {
        const lang = language;
        console.log('Generating audio for language:', lang);
        slides.forEach((s, si) => {
            const englishText = buildSlideText(s);
            const text = lang === 'hi' ? (s.bodyHindi || englishText) : englishText;
            console.log(`[PreGen] Slide ${si} | lang=${lang} | text="${text.slice(0, 80)}"`);
            cacheAudio(`${si}-${lang}`, text, lang);
        });
    }, [language, slides]); // eslint-disable-line react-hooks/exhaustive-deps

    /* Background image per slide */
    useEffect(() => {
        if (!slides[idx]?.keyword) return;
        setBgImg(null); setBgReady(false);
        let alive = true;
        fetchSlideImage(slides[idx].keyword).then(url => { if (alive && url) setBgImg(url); });
        return () => { alive = false; };
    }, [idx]);

    /* Stop all audio (ElevenLabs + browser TTS + pending poll) */
    const stopAudio = useCallback(() => {
        genRef.current += 1; // invalidate any pending onDone callbacks
        clearInterval(pollRef.current);
        setAudioLoading(false);
        if (audioRef.current) { audioRef.current.onended = null; audioRef.current.pause(); audioRef.current.src = ''; }
        speechSynthesis.cancel();
    }, []);

    /* Cancel audio on unmount */
    useEffect(() => () => stopAudio(), [stopAudio]);

    /* Auto-start on load */
    useEffect(() => {
        if (slides.length > 0) {
            const t = setTimeout(() => speakRef.current?.(0), 1000);
            return () => clearTimeout(t);
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const doSpeak = useCallback((si) => {
        stopAudio(); // cancel any previous speech first
        const s = slides[si];
        if (!s) return;

        const gen         = ++genRef.current; // new generation for this speak call
        const wantHindi   = langRef.current === 'hi';
        const englishText = buildSlideText(s);
        const hindiText   = s.bodyHindi?.trim();
        // Use Hindi text+lang only if we actually have Hindi content; otherwise fall back to English
        const text        = wantHindi && hindiText ? hindiText : englishText;
        const lang        = wantHindi && hindiText ? 'hi' : 'en';

        /* Check if this generation is still current */
        const isStale = () => genRef.current !== gen;

        /* Minimum 5 s per slide so it doesn't flash past */
        const startTime = Date.now();
        const onDone = () => {
            if (isStale()) return; // slide changed — ignore
            clearInterval(pollRef.current);
            setAudioLoading(false);
            const wait = Math.max(0, 5000 - (Date.now() - startTime));
            setTimeout(() => {
                if (isStale()) return; // slide changed during wait
                setPlaying(false);
                if (!stateRef.current.auto) return;
                const next = stateRef.current.idx + 1;
                if (next < slides.length) {
                    stateRef.current.idx = next;
                    setIdx(next);
                    setTimeout(() => { if (!isStale()) speakRef.current?.(next); }, 1200);
                }
            }, wait);
        };

        setPlaying(true);

        const key    = `${si}-${lang}`;
        const cached = _audioCache.get(key);

        const playBlob = (url) => {
            if (isStale()) return;
            setAudioLoading(false);
            audioRef.current.src     = url;
            audioRef.current.onended = onDone;
            audioRef.current.onerror = () => { if (!isStale()) speakBrowser(text, lang, onDone); };
            audioRef.current.play().catch(() => { if (!isStale()) speakBrowser(text, lang, onDone); });
        };

        /* ── Already cached and ready ── */
        if (cached && cached !== 'pending') { playBlob(cached); return; }

        /* ── Currently generating — poll until ready ── */
        if (cached === 'pending') {
            setAudioLoading(true);
            pollRef.current = setInterval(() => {
                if (isStale()) { clearInterval(pollRef.current); return; }
                const v = _audioCache.get(key);
                if (v && v !== 'pending') { clearInterval(pollRef.current); playBlob(v); }
                else if (!v)             { clearInterval(pollRef.current); setAudioLoading(false); speakBrowser(text, lang, onDone); }
            }, 200);
            return;
        }

        /* ── Not in cache — generate on demand ── */
        setAudioLoading(true);
        _audioCache.set(key, 'pending');
        fetchAudio(text, lang).then(url => {
            if (isStale()) return;
            if (url) { _audioCache.set(key, url); playBlob(url); }
            else     { _audioCache.delete(key);   setAudioLoading(false); speakBrowser(text, lang, onDone); }
        }).catch(() => {
            if (isStale()) return;
            _audioCache.delete(key); setAudioLoading(false); speakBrowser(text, lang, onDone);
        });

    }, [slides, stopAudio]);

    useEffect(() => { speakRef.current = doSpeak; }, [doSpeak]);

    const togglePlay = () => {
        if (playing) { stopAudio(); setPlaying(false); }
        else         { doSpeak(idx); }
    };

    const goTo = (n) => {
        if (n < 0 || n >= slides.length) return;
        stopAudio();
        setPlaying(false);
        setIdx(n);
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

    const slide = slides[idx];
    const ss    = SLIDE_STYLE[slide.type] || SLIDE_STYLE.intro;
    const pct   = ((idx + 1) / slides.length) * 100;
    const displayText = language === 'hi' && slide.bodyHindi ? slide.bodyHindi : (slide.body || '');

    return (
        <div className="lp-page fade-in">

            {/* Hidden audio element for ElevenLabs playback */}
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
            </div>

            {/* ── Progress bar ── */}
            <div className="lp-prog-track">
                <div className="lp-prog-fill" style={{ width: `${pct}%`, background: ss.accent }} />
            </div>
            <div className="lp-counter-row">
                <span className="lp-counter">{idx + 1} / {slides.length} slides</span>
            </div>

            {/* ── Main stage ── */}
            <div className="lp-stage" key={idx}>

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
                        <span className="lp-caption-label">AI Presenter · {language === 'hi' ? 'हिंदी' : 'English'}</span>
                        <p className="lp-caption">
                            {audioLoading
                                ? (language === 'hi' ? 'AI आवाज़ तैयार हो रही है...' : 'Generating AI voice...')
                                : playing
                                    ? (language === 'hi' ? 'बोल रहे हैं — ध्यान से सुनें...' : 'Speaking — listen carefully...')
                                    : (() => { const t = displayText; return t.slice(0, 120) + (t.length > 120 ? '...' : ''); })()
                            }
                        </p>
                    </div>
                </div>
            </div>

            {/* ── Controls ── */}
            <div className="lp-controls">
                <button className="lp-nav" onClick={() => goTo(idx - 1)} disabled={idx === 0}>
                    <SkipBack size={18} />
                </button>
                <button className={`lp-play${playing ? ' active' : ''}`} onClick={togglePlay}>
                    {playing ? <Pause size={22} /> : <Play size={22} fill="currentColor" />}
                    {playing ? 'Pause' : 'Play Lesson'}
                </button>
                <button className="lp-nav" onClick={() => goTo(idx + 1)} disabled={idx === slides.length - 1}>
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
