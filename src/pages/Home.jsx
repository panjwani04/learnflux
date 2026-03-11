import React from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Video, Zap, BrainCircuit } from 'lucide-react';
import './Home.css';

function Home() {
    return (
        <div className="home fade-in">
            {/* Hero Section */}
            <section className="hero">
                <div className="hero-content">
                    <div className="badge">AI-Powered Learning</div>
                    <h1 className="headline">Turn Your Study PDFs Into <span className="highlight">AI Video Lessons</span></h1>
                    <p className="subheadline">
                        Upload any PDF and get a simplified video explanation instantly.
                    </p>
                    <div className="hero-actions">
                        <Link to="/upload" className="btn-primary large">Upload PDF</Link>
                    </div>
                </div>
                <div className="hero-visual">
                    <div className="mock-video-player">
                        <div className="player-inner">
                            <BookOpen size={48} className="player-icon" />
                            <span>Generating your lesson...</span>
                        </div>
                    </div>
                </div>
            </section>

            {/* Features Section */}
            <section className="features">
                <h2 className="section-title">Why use Learnflux?</h2>
                <div className="feature-grid">
                    <div className="feature-card">
                        <div className="icon-wrapper"><BrainCircuit size={24} /></div>
                        <h3>AI PDF Analysis</h3>
                        <p>Our AI reads and understands your study materials in seconds.</p>
                    </div>
                    <div className="feature-card">
                        <div className="icon-wrapper"><Zap size={24} /></div>
                        <h3>Instant Explanations</h3>
                        <p>Complex concepts are broken down into easy-to-digest pieces.</p>
                    </div>
                    <div className="feature-card">
                        <div className="icon-wrapper"><Video size={24} /></div>
                        <h3>Auto-generated Videos</h3>
                        <p>Watch your PDF turn into an engaging slide-style video lesson.</p>
                    </div>
                    <div className="feature-card">
                        <div className="icon-wrapper"><BookOpen size={24} /></div>
                        <h3>Smart Summaries</h3>
                        <p>Get key bullet points alongside your video for quick review.</p>
                    </div>
                </div>
            </section>
        </div>
    );
}

export default Home;
