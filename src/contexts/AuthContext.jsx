import { createContext, useContext, useEffect, useState } from 'react';
import { API } from '../lib/api';

const AuthContext = createContext({});

const SESSION_KEY = 'learnflux_session';

// ── Local auth fallback (when WorkOS is not configured) ─────────────
const LOCAL_USERS_KEY = 'learnflux_users';

function simpleHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = Math.imul(31, h) + str.charCodeAt(i) | 0;
    return h.toString(36);
}

export function AuthProvider({ children }) {
    const [user,           setUser]           = useState(null);
    const [loading,        setLoading]        = useState(true);
    const [workosAvailable, setWorkosAvailable] = useState(false);

    // Check if WorkOS is configured on the backend
    useEffect(() => {
        fetch(`${API}/auth/url`)
            .then(r => r.json())
            .then(d => setWorkosAvailable(d.available === true))
            .catch(() => setWorkosAvailable(false));
    }, []);

    // Restore saved session on mount
    useEffect(() => {
        const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
        if (saved?.user) setUser(saved.user);
        setLoading(false);
    }, []);

    // ── WorkOS AuthKit ────────────────────────────────────────────────

    const signInWithWorkOS = () => {
        fetch(`${API}/auth/url`)
            .then(r => r.json())
            .then(data => {
                if (data.url) window.location.href = data.url;
            })
            .catch(err => {
                console.error('WorkOS sign-in failed:', err);
                alert('Unable to reach the sign-in server. Please try again.');
            });
    };

    // Called by AuthCallback after WorkOS redirects back with ?code=
    const exchangeCode = async (code) => {
        const res = await fetch(`${API}/auth/exchange`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
        });
        if (!res.ok) throw new Error('Failed to exchange code');
        const { user, accessToken, refreshToken } = await res.json();
        const session = { user, accessToken, refreshToken };
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        setUser(user);
        return user;
    };

    // ── Local auth fallback ───────────────────────────────────────────

    const signUp = async (email, password, name) => {
        if (!email || !password) throw new Error('Email and password are required.');
        if (password.length < 6)  throw new Error('Password must be at least 6 characters.');
        const users = JSON.parse(localStorage.getItem(LOCAL_USERS_KEY) || '[]');
        if (users.find(u => u.email.toLowerCase() === email.toLowerCase()))
            throw new Error('An account with this email already exists.');
        const newUser = {
            id: 'local_' + Date.now(),
            email: email.toLowerCase(),
            firstName: name || email.split('@')[0],
            password: simpleHash(password),
        };
        users.push(newUser);
        localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
        const sessionUser = { id: newUser.id, email: newUser.email, firstName: newUser.firstName };
        localStorage.setItem(SESSION_KEY, JSON.stringify({ user: sessionUser }));
        setUser(sessionUser);
        return { data: { user: sessionUser, session: { user: sessionUser } }, error: null };
    };

    const signIn = async (email, password) => {
        if (!email || !password) throw new Error('Email and password are required.');
        const users = JSON.parse(localStorage.getItem(LOCAL_USERS_KEY) || '[]');
        const found  = users.find(
            u => u.email.toLowerCase() === email.toLowerCase() && u.password === simpleHash(password)
        );
        if (!found) throw new Error('Invalid email or password.');
        const sessionUser = { id: found.id, email: found.email, firstName: found.firstName };
        localStorage.setItem(SESSION_KEY, JSON.stringify({ user: sessionUser }));
        setUser(sessionUser);
        return { data: { user: sessionUser, session: { user: sessionUser } }, error: null };
    };

    // ── Common ────────────────────────────────────────────────────────

    const signOut = () => {
        localStorage.removeItem(SESSION_KEY);
        setUser(null);
    };

    const getToken = () => {
        const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
        return saved?.accessToken || null;
    };

    return (
        <AuthContext.Provider value={{
            user,
            loading,
            workosAvailable,
            isSupabaseEnabled: true, // kept for NavBar compat
            signInWithWorkOS,
            exchangeCode,
            signIn,
            signUp,
            signOut,
            getToken,
        }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
