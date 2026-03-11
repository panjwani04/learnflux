import { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { LogOut, User, Menu, X } from 'lucide-react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import Upload from './pages/Upload';
import Result from './pages/Result';
import Auth from './pages/Auth';
import Tutor from './pages/Tutor';
import Quiz from './pages/Quiz';
import LessonPlayer from './pages/LessonPlayer';
import AuthCallback from './pages/AuthCallback';
import './index.css';

function NavBar() {
    const { user, signOut, signInWithWorkOS } = useAuth();
    const [menuOpen, setMenuOpen] = useState(false);
    const handleSignOut = async () => {
        setMenuOpen(false);
        await signOut();
    };

    const closeMenu = () => setMenuOpen(false);

    // Close menu on navigation
    const handleNavClick = () => setMenuOpen(false);

    return (
        <nav className="navbar">
            <Link to="/" className="brand" onClick={closeMenu}>Learnflux</Link>

            {/* Mobile overlay */}
            <div
                className={`nav-overlay${menuOpen ? ' open' : ''}`}
                onClick={closeMenu}
            />

            {/* Hamburger toggle */}
            <button
                className="nav-toggle"
                onClick={() => setMenuOpen(o => !o)}
                aria-label="Toggle menu"
            >
                {menuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>

            <div className={`nav-links${menuOpen ? ' open' : ''}`}>
                <Link to="/upload"    className="nav-link" onClick={handleNavClick}>Upload</Link>
                <Link to="/dashboard" className="nav-link" onClick={handleNavClick}>Dashboard</Link>
                <Link to="/tutor"     className="nav-link" onClick={handleNavClick}>AI Tutor</Link>
                {user ? (
                    <>
                        <span className="nav-user">
                            <User size={14} />
                            {user.email?.split('@')[0] || user.firstName}
                        </span>
                        <button className="nav-signout" onClick={handleSignOut}>
                            <LogOut size={15} /> Sign out
                        </button>
                    </>
                ) : (
                    <button className="btn-primary" onClick={() => { closeMenu(); signInWithWorkOS(); }}>Login</button>
                )}
            </div>
        </nav>
    );
}

function AppRoutes() {
    return (
        <div className="app-container">
            <NavBar />
            <main className="main-content">
                <Routes>
                    <Route path="/"        element={<Home />} />
                    <Route path="/auth"    element={<Auth />} />
                    <Route path="/auth/callback" element={<AuthCallback />} />
                    <Route path="/upload"  element={<ProtectedRoute><Upload /></ProtectedRoute>} />
                    <Route path="/result"  element={<ProtectedRoute><Result /></ProtectedRoute>} />
                    <Route path="/tutor"   element={<ProtectedRoute><Tutor /></ProtectedRoute>} />
                    <Route path="/quiz"    element={<ProtectedRoute><Quiz /></ProtectedRoute>} />
                    <Route path="/lesson"  element={<ProtectedRoute><LessonPlayer /></ProtectedRoute>} />
                    <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                </Routes>
            </main>
        </div>
    );
}

function App() {
    return (
        <Router>
            <AuthProvider>
                <AppRoutes />
            </AuthProvider>
        </Router>
    );
}

export default App;
