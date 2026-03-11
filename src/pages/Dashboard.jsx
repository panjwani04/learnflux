import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { API } from '../lib/api';
import {
    Play, Clock, FileText, Search, BookOpen, UploadCloud,
    Bell, BarChart2, Layers, Trash2, RefreshCw
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { dbLessonToJs } from '../lib/supabase';
import './Dashboard.css';

const THUMB_COLORS = [
    'linear-gradient(135deg, #4f46e5, #7c3aed)',
    'linear-gradient(135deg, #0ea5e9, #6366f1)',
    'linear-gradient(135deg, #10b981, #0ea5e9)',
    'linear-gradient(135deg, #f59e0b, #ef4444)',
    'linear-gradient(135deg, #8b5cf6, #ec4899)',
];

function Dashboard() {
    const navigate  = useNavigate();
    const { user, getToken } = useAuth();
    const [query,   setQuery]   = useState('');
    const [lessons, setLessons] = useState([]);
    const [loading, setLoading] = useState(false);
    const [source,  setSource]  = useState('local');

    const loadLessons = async () => {
        setLoading(true);
        if (user) {
            try {
                const token = await getToken();
                const res = await fetch(`${API}/lessons`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                if (res.ok) {
                    const rows = await res.json();
                    setLessons(rows.map(dbLessonToJs));
                    setSource('db');
                    setLoading(false);
                    return;
                }
            } catch { /* fall through */ }
        }
        setLessons(JSON.parse(localStorage.getItem('learnflux_lessons') || '[]'));
        setSource('local');
        setLoading(false);
    };

    useEffect(() => { loadLessons(); }, [user]);

    const openLesson = (lesson) => {
        localStorage.setItem('learnflux_current', JSON.stringify(lesson));
        navigate('/result');
    };

    const deleteLesson = async (e, lesson) => {
        e.stopPropagation();
        if (!confirm(`Delete "${lesson.title}"?`)) return;
        if (source === 'db') {
            try {
                const token = await getToken();
                await fetch(`${API}/lessons/${lesson.id}`, {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${token}` }
                });
            } catch { /* ignore */ }
        } else {
            const updated = JSON.parse(localStorage.getItem('learnflux_lessons') || '[]')
                .filter(l => l.id !== lesson.id);
            localStorage.setItem('learnflux_lessons', JSON.stringify(updated));
        }
        setLessons(prev => prev.filter(l => l.id !== lesson.id));
    };

    const formatDate = (iso) => {
        if (!iso) return '';
        const d = new Date(iso), diff = Date.now() - d.getTime(), mins = Math.floor(diff / 60000);
        if (mins < 1) return 'Just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        return d.toLocaleDateString();
    };

    const estimateTime = (l) => {
        const words = ((l.explanation || '') + ' ' + (l.summary || '')).split(' ').length;
        return `~${Math.max(2, Math.round(words / 200))} min`;
    };

    const formatStudyTime = (secs) => {
        if (!secs) return '0m';
        const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
    };

    const now           = Date.now();
    const dueForReview  = lessons.filter(l => l.nextReviewDate && l.nextReviewDate <= now);
    const filtered      = [...lessons]
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .filter(l => l.title?.toLowerCase().includes(query.toLowerCase()));

    const totalStudySecs  = lessons.reduce((a, l) => a + (l.studyTime || 0), 0);
    const totalQuestions  = lessons.reduce((a, l) => a + (l.quiz?.length || 0), 0);
    const totalFlashcards = lessons.reduce((a, l) => a + (l.flashcards?.length || 0), 0);
    const scoredLessons   = lessons.filter(l => l.quizScore > 0);
    const avgScore        = scoredLessons.length
        ? Math.round(scoredLessons.reduce((a, l) => a + l.quizScore, 0) / scoredLessons.length)
        : 0;

    const LessonCard = ({ lesson, idx, badge }) => (
        <div className="lesson-card" onClick={() => openLesson(lesson)}>
            <div className="lesson-thumbnail" style={{ background: THUMB_COLORS[idx % THUMB_COLORS.length] }}>
                <div className="play-overlay-small"><Play size={24} fill="currentColor" /></div>
                {badge && <span className="review-badge">{badge}</span>}
                <span className="duration-badge">{estimateTime(lesson)}</span>
            </div>
            <div className="lesson-info">
                <div className="lesson-meta">
                    <span className="topic-badge">
                        {lesson.quiz?.length > 0 ? `${lesson.quiz.length} Qs` : 'Notes'}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        {lesson.reviewCount > 0 && <span className="reviewed-badge">#{lesson.reviewCount}</span>}
                        <button className="delete-btn" onClick={(e) => deleteLesson(e, lesson)} title="Delete lesson">
                            <Trash2 size={13} />
                        </button>
                    </div>
                </div>
                <h3 className="lesson-title">{lesson.title}</h3>
                {lesson.quizScore > 0 && (
                    <div className="score-bar-wrap">
                        <div className="score-bar-fill" style={{ width: `${lesson.quizScore}%` }} />
                        <span className="score-bar-label">{lesson.quizScore}% quiz</span>
                    </div>
                )}
                <div className="lesson-footer">
                    <span className="lesson-date"><Clock size={14} className="meta-icon" />{formatDate(lesson.date)}</span>
                    <span className="lesson-type"><FileText size={14} className="meta-icon" />PDF</span>
                </div>
            </div>
        </div>
    );

    return (
        <div className="dashboard-page fade-in">
            <div className="dashboard-header">
                <div>
                    <h1>My Study Library</h1>
                    <p className="subtitle">
                        {source === 'db' ? '☁ Cloud synced' : '💾 Saved locally'} · {lessons.length} lesson{lessons.length !== 1 ? 's' : ''}
                    </p>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    <button className="refresh-btn" onClick={loadLessons} title="Refresh" disabled={loading}>
                        <RefreshCw size={16} className={loading ? 'spin' : ''} />
                    </button>
                    <div className="search-bar">
                        <Search size={20} className="search-icon" />
                        <input type="text" placeholder="Search lessons..." className="search-input"
                            value={query} onChange={e => setQuery(e.target.value)} />
                    </div>
                </div>
            </div>

            <div className="dashboard-stats">
                <div className="stat-card">
                    <BookOpen size={22} className="stat-icon" />
                    <div className="stat-value">{lessons.length}</div>
                    <div className="stat-label">Total Lessons</div>
                </div>
                <div className="stat-card">
                    <Clock size={22} className="stat-icon" />
                    <div className="stat-value">{formatStudyTime(totalStudySecs)}</div>
                    <div className="stat-label">Study Time</div>
                </div>
                <div className="stat-card">
                    <BarChart2 size={22} className="stat-icon" />
                    <div className="stat-value">{totalQuestions}</div>
                    <div className="stat-label">Quiz Questions</div>
                </div>
                <div className="stat-card">
                    <Layers size={22} className="stat-icon" />
                    <div className="stat-value">{avgScore > 0 ? `${avgScore}%` : totalFlashcards}</div>
                    <div className="stat-label">{avgScore > 0 ? 'Avg Quiz Score' : 'Flashcards'}</div>
                </div>
            </div>

            {dueForReview.length > 0 && (
                <div className="lessons-section review-section">
                    <div className="section-title-row">
                        <h2><Bell size={20} className="section-title-icon" /> Due For Review</h2>
                        <span className="review-count-badge">{dueForReview.length}</span>
                    </div>
                    <div className="lessons-grid">
                        {dueForReview.map((lesson, idx) => (
                            <LessonCard key={lesson.id || idx} lesson={lesson} idx={idx} badge="Review" />
                        ))}
                    </div>
                </div>
            )}

            <div className="lessons-section">
                <h2>Recent Lessons</h2>
                {loading ? (
                    <div className="dashboard-empty">
                        <RefreshCw size={40} className="empty-icon spin" />
                        <p>Loading lessons...</p>
                    </div>
                ) : lessons.length === 0 ? (
                    <div className="dashboard-empty">
                        <BookOpen size={56} className="empty-icon" />
                        <h3>No lessons yet</h3>
                        <p>Upload your first PDF to get started.</p>
                        <button className="btn-primary" onClick={() => navigate('/upload')}>
                            <UploadCloud size={16} /> Upload PDF
                        </button>
                    </div>
                ) : filtered.length === 0 ? (
                    <p className="no-results">No lessons match "{query}"</p>
                ) : (
                    <div className="lessons-grid">
                        {filtered.map((lesson, idx) => (
                            <LessonCard key={lesson.id || idx} lesson={lesson} idx={idx} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

export default Dashboard;
