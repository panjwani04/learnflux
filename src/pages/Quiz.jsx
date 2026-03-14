import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle, XCircle, Trophy, RotateCcw } from 'lucide-react';
import './Quiz.css';

function Quiz() {
    const navigate = useNavigate();
    const lesson = JSON.parse(localStorage.getItem("learnflux_current") || 'null');
    const quiz = lesson?.quiz || [];

    const [current, setCurrent] = useState(0);
    const [selected, setSelected] = useState(null);
    const [score, setScore] = useState(0);
    const [finished, setFinished] = useState(false);
    const [answers, setAnswers] = useState([]);

    if (!lesson) {
        return (
            <div className="quiz-empty fade-in">
                <Trophy size={64} className="empty-icon" />
                <h2>No lesson loaded</h2>
                <p>Upload a PDF to generate quiz questions.</p>
                <button className="btn-primary" onClick={() => navigate('/upload')}>Upload PDF</button>
            </div>
        );
    }

    if (quiz.length === 0) {
        return (
            <div className="quiz-empty fade-in">
                <Trophy size={64} className="empty-icon" />
                <h2>No quiz questions</h2>
                <p>Quiz questions couldn't be generated for this lesson. Try re-uploading the PDF.</p>
                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
                    <button className="btn-secondary" onClick={() => navigate('/result')}>Back to Notes</button>
                    <button className="btn-primary" onClick={() => navigate('/upload')}>Re-upload PDF</button>
                </div>
            </div>
        );
    }

    const q = quiz[current];
    const isLast = current === quiz.length - 1;

    // Normalize answer: AI sometimes returns full text instead of "A"/"B"/"C"/"D"
    const getCorrectLetter = (question) => {
        const ans = (question.answer || '').trim();
        if (/^[A-D]$/i.test(ans)) return ans.toUpperCase();
        const prefixMatch = ans.match(/^([A-D])[.)]\s*/i);
        if (prefixMatch) return prefixMatch[1].toUpperCase();
        const idx = question.options.findIndex(opt =>
            opt.replace(/^[A-D][.)]\s*/i, '').trim().toLowerCase() === ans.toLowerCase()
        );
        return idx !== -1 ? String.fromCharCode(65 + idx) : ans;
    };

    const correctLetter = getCorrectLetter(q);

    const selectAnswer = (letter) => {
        if (selected !== null) return;
        setSelected(letter);
    };

    const next = () => {
        const isCorrect = selected === correctLetter;
        const newAnswers = [...answers, { question: q.question, selected, correct: q.answer, isCorrect }];
        setAnswers(newAnswers);
        if (isCorrect) setScore(s => s + 1);

        if (isLast) {
            setFinished(true);
        } else {
            setCurrent(c => c + 1);
            setSelected(null);
        }
    };

    const restart = () => {
        setCurrent(0);
        setSelected(null);
        setScore(0);
        setFinished(false);
        setAnswers([]);
    };

    const pct = Math.round((score / quiz.length) * 100);

    if (finished) {
        return (
            <div className="quiz-page fade-in">
                <div className="quiz-header">
                    <button className="back-btn" onClick={() => navigate('/result')}>
                        <ArrowLeft size={18} /> Back to Notes
                    </button>
                    <h1>Quiz Complete</h1>
                </div>

                <div className="score-card">
                    <Trophy size={56} className={`trophy ${pct >= 60 ? 'gold' : 'silver'}`} />
                    <div className="score-value">{score}/{quiz.length}</div>
                    <div className="score-pct">{pct}% correct</div>
                    <p className="score-msg">
                        {pct === 100 ? '🎉 Perfect score!' :
                         pct >= 80 ? 'Great job! Almost perfect.' :
                         pct >= 60 ? 'Good effort! Keep studying.' :
                         'Keep practicing — you\'ll get there!'}
                    </p>

                    <div className="quiz-actions">
                        <button className="btn-primary" onClick={restart}>
                            <RotateCcw size={16} /> Retry Quiz
                        </button>
                        <button className="btn-secondary" onClick={() => navigate('/result')}>
                            Back to Notes
                        </button>
                    </div>
                </div>

                <div className="quiz-review">
                    <h3>Review</h3>
                    {answers.map((a, i) => (
                        <div key={i} className={`review-item ${a.isCorrect ? 'correct' : 'wrong'}`}>
                            <div className="review-icon">
                                {a.isCorrect
                                    ? <CheckCircle size={18} />
                                    : <XCircle size={18} />}
                            </div>
                            <div className="review-body">
                                <p className="review-q">Q{i + 1}. {a.question}</p>
                                {!a.isCorrect && (
                                    <p className="review-answer">
                                        Your answer: <span className="wrong-ans">{a.selected}</span>
                                        {' · '}Correct: <span className="correct-ans">{a.correct}</span>
                                    </p>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="quiz-page fade-in">
            <div className="quiz-header">
                <button className="back-btn" onClick={() => navigate('/result')}>
                    <ArrowLeft size={18} /> Back to Notes
                </button>
                <h1>{lesson.title}</h1>
            </div>

            <div className="quiz-progress-row">
                <span className="q-counter">Question {current + 1} of {quiz.length}</span>
                <span className="q-score">Score: {score}</span>
            </div>
            <div className="quiz-progress-bar">
                <div className="quiz-progress-fill" style={{ width: `${(current / quiz.length) * 100}%` }} />
            </div>

            <div className="question-card">
                <p className="question-text">{q.question}</p>

                <div className="options-list">
                    {q.options.map((opt, j) => {
                        const letter = String.fromCharCode(65 + j);
                        let cls = 'option-btn';
                        if (selected !== null) {
                            if (letter === correctLetter) cls += ' correct';
                            else if (letter === selected) cls += ' wrong';
                            else cls += ' dimmed';
                        }
                        return (
                            <button key={j} className={cls} onClick={() => selectAnswer(letter)}>
                                <span className="opt-letter">{letter}</span>
                                <span className="opt-text">{opt.replace(/^[A-D]\.\s*/, '')}</span>
                                {selected !== null && letter === correctLetter && <CheckCircle size={16} className="opt-icon" />}
                                {selected !== null && letter === selected && letter !== correctLetter && <XCircle size={16} className="opt-icon" />}
                            </button>
                        );
                    })}
                </div>

                {selected !== null && (
                    <div className={`answer-feedback ${selected === correctLetter ? 'correct' : 'wrong'}`}>
                        {selected === correctLetter ? '✓ Correct!' : `✗ Correct answer: ${correctLetter}`}
                    </div>
                )}

                <button
                    className="next-btn btn-primary"
                    onClick={next}
                    disabled={selected === null}
                >
                    {isLast ? 'Finish Quiz' : 'Next Question →'}
                </button>
            </div>
        </div>
    );
}

export default Quiz;
