import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, Bot, User, ArrowLeft, AlertCircle, Database } from 'lucide-react';
import { API } from '../lib/api';
import './Tutor.css';

function Tutor() {
    const navigate = useNavigate();
    const lesson = JSON.parse(localStorage.getItem("learnflux_current") || 'null');

    const allLessons = JSON.parse(localStorage.getItem('learnflux_lessons') || '[]');
    const documentText = lesson?.documentText || localStorage.getItem("documentText") || '';
    const allDocuments = allLessons
        .filter(l => l.documentText)
        .map(l => ({ title: l.title, text: l.documentText }));
    // docIds for RAG retrieval — all lessons that have IDs and document text
    const docIds = allLessons.filter(l => l.id && l.documentText).map(l => l.id);

    const [messages, setMessages] = useState([
        {
            role: 'ai',
            text: lesson
                ? `Hi! I've read "${lesson.title}"${allDocuments.length > 1 ? ` and ${allDocuments.length - 1} other lesson(s)` : ''}. Ask me anything — I'm here to help!`
                : "Hi! Upload a PDF first so I have some material to help you with."
        }
    ]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [lastQuestion, setLastQuestion] = useState('');
    const [ragActive, setRagActive] = useState(false);
    const bottomRef = useRef(null);

    // Auto-index all documents on mount (in case server restarted and lost in-memory index)
    useEffect(() => {
        const toIndex = allLessons.filter(l => l.id && l.documentText);
        if (toIndex.length === 0) return;
        toIndex.forEach(l => {
            fetch(`${API}/index`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ docId: l.id, documentText: l.documentText }),
            }).catch(() => {});
        });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const askQuestion = async (question) => {
        if (!question || loading) return;

        setError(null);
        setLastQuestion(question);
        setMessages(prev => [...prev, { role: 'user', text: question }]);
        setLoading(true);

        try {
            const res = await fetch(`${API}/ask`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question, docIds, documentText, allDocuments })
            });

            const data = await res.json();
            if (!res.ok || data.error) throw new Error(data.error || 'Server error');

            if (data.ragUsed) setRagActive(true);
            setMessages(prev => [...prev, { role: 'ai', text: data.answer, ragUsed: data.ragUsed }]);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const sendMessage = () => {
        const question = input.trim();
        if (!question) return;
        setInput('');
        askQuestion(question);
    };

    const handleKey = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    return (
        <div className="tutor-page fade-in">
            <div className="tutor-header">
                <button className="back-btn" onClick={() => navigate('/result')}>
                    <ArrowLeft size={18} /> Back to Notes
                </button>
                <div className="tutor-title">
                    <Bot size={22} className="tutor-icon" />
                    <div>
                        <h1>AI Tutor</h1>
                        {lesson && <p className="tutor-doc">{lesson.title}{allDocuments.length > 1 ? ` + ${allDocuments.length - 1} more` : ''}</p>}
                    </div>
                </div>
                {ragActive && (
                    <div className="tutor-rag-badge" title="Answers are powered by RAG — retrieving the most relevant chunks from your documents">
                        <Database size={13} /> RAG Active
                    </div>
                )}
                {!documentText && (
                    <div className="tutor-warning">
                        <AlertCircle size={16} />
                        No document loaded — upload a PDF first.
                    </div>
                )}
            </div>

            <div className="chat-window">
                <div className="chat-messages">
                    {messages.map((msg, i) => (
                        <div key={i} className={`chat-bubble ${msg.role} ${msg.isError ? 'error' : ''}`}>
                            <div className="bubble-avatar">
                                {msg.role === 'ai' ? <Bot size={16} /> : <User size={16} />}
                            </div>
                            <div className="bubble-text">
                                {msg.text}
                                {msg.ragUsed && (
                                    <span className="rag-source-tag"><Database size={11} /> Retrieved from your documents</span>
                                )}
                            </div>
                        </div>
                    ))}

                    {loading && (
                        <div className="chat-bubble ai">
                            <div className="bubble-avatar"><Bot size={16} /></div>
                            <div className="bubble-text typing">
                                <span /><span /><span />
                            </div>
                        </div>
                    )}
                    <div ref={bottomRef} />
                </div>

                <div className="chat-input-bar">
                    {error && (
                        <div className="chat-error-row">
                            <p className="chat-error"><AlertCircle size={14} /> {error}</p>
                            {lastQuestion && (
                                <button
                                    className="retry-btn"
                                    onClick={() => { setError(null); askQuestion(lastQuestion); }}
                                    disabled={loading}
                                >
                                    Retry
                                </button>
                            )}
                        </div>
                    )}
                    <div className="chat-input-row">
                        <textarea
                            className="chat-input"
                            placeholder="Ask anything about the document..."
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={handleKey}
                            rows={1}
                            disabled={loading}
                        />
                        <button
                            className="send-btn"
                            onClick={sendMessage}
                            disabled={loading || !input.trim()}
                        >
                            <Send size={18} />
                        </button>
                    </div>
                    <p className="input-hint">Press Enter to send · Shift+Enter for new line</p>
                </div>
            </div>
        </div>
    );
}

export default Tutor;
