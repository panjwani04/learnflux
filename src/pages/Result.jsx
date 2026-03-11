import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { API } from '../lib/api';
import {
    FileText, BookOpen, HelpCircle, Layers, ChevronDown, ChevronUp,
    RotateCcw, Bot, Volume2, VolumeX, ClipboardList,
    PlayCircle, Download, GitBranch, Timer
} from 'lucide-react';
import MindMap from '../components/MindMap';
import { useAuth } from '../contexts/AuthContext';
import './Result.css';

function formatTimer(secs) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function Result() {
    const navigate = useNavigate();
    const { getToken } = useAuth();
    const raw = localStorage.getItem('learnflux_current');
    const lesson = raw ? JSON.parse(raw) : null;

    const [activeTab, setActiveTab] = useState('notes');
    const [revealedAnswers, setRevealedAnswers] = useState({});
    const [flipped, setFlipped] = useState({});
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [studyTime, setStudyTime] = useState(0);
    const [regenerating, setRegenerating] = useState(false);
    const [regenError, setRegenError] = useState('');

    const isIncomplete = lesson && (!lesson.keyPoints?.length || !lesson.quiz?.length);

    const handleRegenerate = async () => {
        if (!lesson?.documentText) return;
        setRegenerating(true);
        setRegenError('');
        try {
            const res = await fetch(`${API}/reanalyze`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ documentText: lesson.documentText, title: lesson.title }),
            });
            if (!res.ok) throw new Error((await res.json()).error || 'Failed');
            const fresh = await res.json();
            const merged = { ...lesson, ...fresh };
            localStorage.setItem('learnflux_current', JSON.stringify(merged));
            const lessons = JSON.parse(localStorage.getItem('learnflux_lessons') || '[]');
            const updated = lessons.map(l => l.id === lesson.id ? { ...l, ...fresh } : l);
            localStorage.setItem('learnflux_lessons', JSON.stringify(updated));
            window.location.reload();
        } catch (e) {
            setRegenError(e.message || 'Regeneration failed. Try again in a moment.');
        } finally {
            setRegenerating(false);
        }
    };

    // Study time timer + spaced repetition update
    useEffect(() => {
        if (!lesson) return;
        const start = Date.now();

        const timer = setInterval(() => {
            setStudyTime(Math.floor((Date.now() - start) / 1000));
        }, 1000);

        // Update spaced repetition data in localStorage
        const INTERVALS = [1, 3, 7, 14, 30]; // days
        const lessons = JSON.parse(localStorage.getItem('learnflux_lessons') || '[]');
        const rc = (lesson.reviewCount || 0) + 1;
        const days = INTERVALS[Math.min(rc - 1, INTERVALS.length - 1)];
        const nextReviewDate = Date.now() + days * 86400000;

        const updated = lessons.map(l => {
            if (l.id === lesson.id) {
                return { ...l, lastStudied: Date.now(), reviewCount: rc, nextReviewDate };
            }
            return l;
        });
        localStorage.setItem('learnflux_lessons', JSON.stringify(updated));

        // Sync review count to DB if lesson came from DB
        if (lesson.fromDB && lesson.id) {
            getToken().then(token => {
                if (!token) return;
                fetch(`${API}/lessons/${lesson.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({
                        review_count: rc,
                        last_studied_at: new Date().toISOString(),
                        next_review_at: new Date(nextReviewDate).toISOString(),
                    }),
                }).catch(() => {});
            });
        }

        return () => {
            clearInterval(timer);
            const elapsed = Math.floor((Date.now() - start) / 1000);
            if (elapsed < 3) return; // ignore accidental navigations

            // Update study time in localStorage
            const finalLessons = JSON.parse(localStorage.getItem('learnflux_lessons') || '[]');
            const saved = finalLessons.map(l => {
                if (l.id === lesson.id) {
                    return { ...l, studyTime: (l.studyTime || 0) + elapsed };
                }
                return l;
            });
            localStorage.setItem('learnflux_lessons', JSON.stringify(saved));

            // Sync study time to DB
            if (lesson.fromDB && lesson.id) {
                getToken().then(token => {
                    if (!token) return;
                    fetch(`${API}/lessons/${lesson.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                        body: JSON.stringify({ study_time_secs: (lesson.studyTime || 0) + elapsed }),
                    }).catch(() => {});
                });
            }
        };
    }, []);

    const toggleVoice = () => {
        if (window.speechSynthesis.speaking) {
            window.speechSynthesis.cancel();
            setIsSpeaking(false);
            return;
        }
        const text = lesson.explanation || lesson.summary || '';
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.9;
        utterance.onend = () => setIsSpeaking(false);
        utterance.onerror = () => setIsSpeaking(false);
        window.speechSynthesis.speak(utterance);
        setIsSpeaking(true);
    };

    const exportNotes = () => {
        const lines = [
            `# ${lesson.title}`,
            '',
            '## Summary',
            lesson.summary || '',
            '',
            '## Key Points',
            ...(lesson.keyPoints || []).map(p => `- ${p}`),
            '',
            '## Detailed Explanation',
            lesson.explanation || '',
            '',
            '## Important Definitions',
            ...(lesson.definitions || []).map(d => `**${d.term}**: ${d.definition}`),
            '',
            '## Quiz Questions',
            ...(lesson.quiz || []).map((q, i) =>
                `Q${i + 1}. ${q.question}\n${q.options.join('\n')}\nAnswer: ${q.answer}`
            ),
        ];
        const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(lesson.title || 'study-notes').replace(/[^a-z0-9]/gi, '-').toLowerCase()}.md`;
        a.click();
        URL.revokeObjectURL(url);
    };

    if (!lesson) {
        return (
            <div className="result-empty fade-in">
                <BookOpen size={64} className="empty-icon" />
                <h2>No lesson loaded</h2>
                <p>Upload a PDF to generate your AI study guide.</p>
                <button className="btn-primary" onClick={() => navigate('/upload')}>Upload PDF</button>
            </div>
        );
    }

    const toggleAnswer = (i) => setRevealedAnswers(prev => ({ ...prev, [i]: !prev[i] }));
    const toggleFlip = (i) => setFlipped(prev => ({ ...prev, [i]: !prev[i] }));

    const tabs = [
        { id: 'notes',      label: 'Study Notes',  icon: <FileText size={16} /> },
        { id: 'quiz',       label: 'Quiz',          icon: <HelpCircle size={16} /> },
        { id: 'flashcards', label: 'Flashcards',    icon: <Layers size={16} /> },
        { id: 'mindmap',    label: 'Mind Map',      icon: <GitBranch size={16} /> },
    ];

    return (
        <div className="result-page fade-in">
            <div className="result-header">
                <div className="result-header-left">
                    <h1>{lesson.title || 'Your AI Lesson'}</h1>
                    {studyTime > 0 && (
                        <span className="study-timer-badge">
                            <Timer size={13} /> {formatTimer(studyTime)}
                        </span>
                    )}
                </div>
                <button className="btn-secondary" onClick={() => navigate('/upload')}>
                    <RotateCcw size={16} /> New Upload
                </button>
            </div>

            {/* Action buttons */}
            <div className="result-actions">
                <button className="action-btn" onClick={() => navigate('/tutor')}>
                    <Bot size={16} /> Ask AI Tutor
                </button>
                <button className="action-btn" onClick={() => navigate('/quiz')}>
                    <ClipboardList size={16} /> Start Quiz
                </button>
                <button className="action-btn" onClick={() => navigate('/lesson')}>
                    <PlayCircle size={16} /> Watch Lesson
                </button>
                <button className={`action-btn ${isSpeaking ? 'active' : ''}`} onClick={toggleVoice}>
                    {isSpeaking ? <VolumeX size={16} /> : <Volume2 size={16} />}
                    {isSpeaking ? 'Stop' : 'Listen'}
                </button>
                <button className="action-btn" onClick={exportNotes}>
                    <Download size={16} /> Download Notes
                </button>
            </div>

            {/* ── Incomplete data banner ── */}
            {isIncomplete && (
                <div className="regen-banner">
                    <span>⚠️ Some content didn't load (AI rate limit). Click to regenerate.</span>
                    <button className="regen-btn" onClick={handleRegenerate} disabled={regenerating}>
                        {regenerating ? 'Regenerating…' : '🔄 Regenerate Content'}
                    </button>
                    {regenError && <span className="regen-error">{regenError}</span>}
                </div>
            )}

            {/* Tabs */}
            <div className="result-tabs">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
                        onClick={() => setActiveTab(tab.id)}
                    >
                        {tab.icon} {tab.label}
                    </button>
                ))}
            </div>

            {/* NOTES TAB */}
            {activeTab === 'notes' && (
                <div className="tab-content">
                    <div className="study-section">
                        <h3 className="section-heading">Summary</h3>
                        <p className="section-body">{lesson.summary}</p>
                    </div>

                    {lesson.keyPoints?.length > 0 && (
                        <div className="study-section">
                            <h3 className="section-heading">Key Points</h3>
                            <ul className="key-points-list">
                                {lesson.keyPoints.map((pt, i) => (
                                    <li key={i}>{pt}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <div className="study-section">
                        <h3 className="section-heading">Detailed Explanation</h3>
                        {Array.isArray(lesson.explanation)
                            ? lesson.explanation.map((p, i) => <p key={i} className="section-body">{p}</p>)
                            : <p className="section-body">{lesson.explanation}</p>
                        }
                    </div>

                    {lesson.definitions?.length > 0 && (
                        <div className="study-section">
                            <h3 className="section-heading">Important Definitions</h3>
                            <div className="definitions-grid">
                                {lesson.definitions.map((d, i) => (
                                    <div key={i} className="definition-card">
                                        <span className="def-term">{d.term}</span>
                                        <span className="def-meaning">{d.definition}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* QUIZ TAB */}
            {activeTab === 'quiz' && (
                <div className="tab-content">
                    {lesson.quiz?.length > 0 ? lesson.quiz.map((q, i) => (
                        <div key={i} className="quiz-card">
                            <p className="quiz-question"><span className="q-num">Q{i + 1}.</span> {q.question}</p>
                            <div className="quiz-options">
                                {q.options.map((opt, j) => {
                                    const letter = String.fromCharCode(65 + j);
                                    const isCorrect = letter === q.answer;
                                    const revealed = revealedAnswers[i];
                                    return (
                                        <div
                                            key={j}
                                            className={`quiz-option ${revealed ? (isCorrect ? 'correct' : 'wrong') : ''}`}
                                        >
                                            {opt}
                                        </div>
                                    );
                                })}
                            </div>
                            <button className="reveal-btn" onClick={() => toggleAnswer(i)}>
                                {revealedAnswers[i]
                                    ? <><ChevronUp size={14} /> Hide Answer</>
                                    : <><ChevronDown size={14} /> Show Answer</>
                                }
                            </button>
                        </div>
                    )) : <p className="empty-state">No quiz questions generated.</p>}
                </div>
            )}

            {/* FLASHCARDS TAB */}
            {activeTab === 'flashcards' && (
                <div className="tab-content flashcards-grid">
                    {lesson.flashcards?.length > 0 ? lesson.flashcards.map((fc, i) => (
                        <div
                            key={i}
                            className={`flashcard ${flipped[i] ? 'flipped' : ''}`}
                            onClick={() => toggleFlip(i)}
                        >
                            <div className="flashcard-inner">
                                <div className="flashcard-front">
                                    <span className="card-label">Question</span>
                                    <p>{fc.question}</p>
                                    <span className="card-hint">Click to reveal answer</span>
                                </div>
                                <div className="flashcard-back">
                                    <span className="card-label">Answer</span>
                                    <p>{fc.answer}</p>
                                </div>
                            </div>
                        </div>
                    )) : <p className="empty-state">No flashcards generated.</p>}
                </div>
            )}

            {/* MIND MAP TAB */}
            {activeTab === 'mindmap' && (
                <div className="tab-content">
                    <div className="study-section">
                        <h3 className="section-heading">Mind Map</h3>
                        <MindMap data={lesson.mindMap} />
                    </div>
                </div>
            )}
        </div>
    );
}

export default Result;
