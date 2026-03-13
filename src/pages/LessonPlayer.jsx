import { useState, useEffect, useRef, useCallback } from 'react';
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

/* ── Audio cache ── */
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
    try {
        const controller = new AbortController();
        // 8-second timeout — prevents Render cold-start from blocking browser TTS fallback
        const t = setTimeout(() => controller.abort(), 8000);
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

function cacheAudio(key, text, language) {
    if (_audioCache.has(key)) return;
    _audioCache.set(key, 'pending');
    fetchAudio(text, language).then(url => {
        if (url) _audioCache.set(key, url);
        else     _audioCache.delete(key);
    });
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

    const [idx,          setIdx]         = useState(0);
    const [direction,    setDirection]   = useState('next'); // 'next' | 'prev'
    const [playing,      setPlaying]     = useState(false);
    const [autoAdv,      setAutoAdv]     = useState(true);
    const [bgImg,        setBgImg]       = useState(null);
    const [bgReady,      setBgReady]     = useState(false);
    const [language,     setLanguage]    = useState('en');
    const [audioLoading, setAudioLoading] = useState(false);
    const [fullscreen,   setFullscreen]  = useState(false);
    const [elapsed,      setElapsed]     = useState(0);   // seconds playing total
    const [slideElapsed, setSlideElapsed] = useState(0);  // seconds on current slide

    const stateRef    = useRef({ idx: 0, auto: true });
    const speakRef    = useRef(null);
    const langRef     = useRef('en');
    const audioRef    = useRef(null);
    const pollRef     = useRef(null);
    const genRef      = useRef(0);
    const containerRef = useRef(null);
    const timerRef    = useRef(null);
    const slideTimerRef = useRef(null);

    useEffect(() => { stateRef.current.idx  = idx;     }, [idx]);
    useEffect(() => { stateRef.current.auto = autoAdv; }, [autoAdv]);
    useEffect(() => { langRef.current       = language;}, [language]);

    useEffect(() => { speechSynthesis.getVoices(); }, []);

    /* Pre-generate audio for all slides */
    useEffect(() => {
        const lang = language;
        slides.forEach((s, si) => {
            const englishText = buildSlideText(s);
            const text = lang === 'hi' ? (s.bodyHindi || englishText) : englishText;
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

    /* Stop all audio */
    const stopAudio = useCallback(() => {
        genRef.current += 1;
        clearInterval(pollRef.current);
        setAudioLoading(false);
        if (audioRef.current) { audioRef.current.onended = null; audioRef.current.pause(); audioRef.current.src = ''; }
        speechSynthesis.cancel();
    }, []);

    useEffect(() => () => stopAudio(), [stopAudio]);

    /* Auto-start on load */
    useEffect(() => {
        if (slides.length > 0) {
            const t = setTimeout(() => speakRef.current?.(0), 1000);
            return () => clearTimeout(t);
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const doSpeak = useCallback((si) => {
        stopAudio();
        const s = slides[si];
        if (!s) return;

        const gen         = ++genRef.current;
        const wantHindi   = langRef.current === 'hi';
        const englishText = buildSlideText(s);
        const hindiText   = s.bodyHindi?.trim();
        const text        = wantHindi && hindiText ? hindiText : englishText;
        const lang        = wantHindi && hindiText ? 'hi' : 'en';
        const isStale     = () => genRef.current !== gen;

        const startTime = Date.now();
        const onDone = () => {
            if (isStale()) return;
            clearInterval(pollRef.current);
            setAudioLoading(false);
            const wait = Math.max(0, 5000 - (Date.now() - startTime));
            setTimeout(() => {
                if (isStale()) return;
                setPlaying(false);
                if (!stateRef.current.auto) return;
                const next = stateRef.current.idx + 1;
                if (next < slides.length) {
                    stateRef.current.idx = next;
                    setDirection('next');
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

        if (cached && cached !== 'pending') { playBlob(cached); return; }

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

    const goTo = (n, dir) => {
        if (n < 0 || n >= slides.length) return;
        stopAudio();
        setPlaying(false);
        setDirection(dir || (n > idx ? 'next' : 'prev'));
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
                            {audioLoading
                                ? (language === 'hi' ? 'AI आवाज़ तैयार हो रही है...' : 'Generating AI voice...')
                                : playing
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
                    <span>{playing ? 'Pause' : 'Play Lesson'}</span>
                </button>
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
