import { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import './Auth.css';

export default function Auth() {
    const { signInWithWorkOS } = useAuth();

    useEffect(() => {
        signInWithWorkOS();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div className="auth-page fade-in">
            <div className="auth-container">
                <div className="auth-header">
                    <h1>Redirecting&hellip;</h1>
                    <p>Taking you to the sign-in page.</p>
                </div>
            </div>
        </div>
    );
}
