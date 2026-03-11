import { useAuth } from '../contexts/AuthContext';

export default function ProtectedRoute({ children }) {
    const { user, loading, signInWithWorkOS } = useAuth();

    if (loading) {
        return (
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                height: '60vh', color: 'var(--text-secondary)', fontSize: '1rem'
            }}>
                Loading...
            </div>
        );
    }

    if (!user) {
        return (
            <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', height: '60vh', gap: '16px', textAlign: 'center',
                padding: '0 1.5rem'
            }}>
                <h2 style={{ color: 'var(--text-primary)', margin: 0 }}>Sign in to continue</h2>
                <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
                    You need to be logged in to access this feature.
                </p>
                <button
                    className="btn-primary large"
                    onClick={signInWithWorkOS}
                    style={{ marginTop: '8px', minHeight: '48px', WebkitTapHighlightColor: 'transparent' }}
                >
                    Sign in with Learnflux
                </button>
            </div>
        );
    }

    return children;
}
