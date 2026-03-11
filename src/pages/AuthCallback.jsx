import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function AuthCallback() {
    const [searchParams]   = useSearchParams();
    const { exchangeCode } = useAuth();
    const navigate         = useNavigate();
    const done             = useRef(false);
    const [errMsg, setErrMsg] = useState('');

    useEffect(() => {
        if (done.current) return;
        done.current = true;

        const code  = searchParams.get('code');
        const error = searchParams.get('error');

        if (error) {
            setErrMsg(searchParams.get('error_description') || error);
            return;
        }
        if (!code) {
            navigate('/auth');
            return;
        }

        exchangeCode(code)
            .then(() => navigate('/dashboard'))
            .catch(err => setErrMsg(err.message || 'Authentication failed.'));
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    if (errMsg) {
        return (
            <div className="auth-page fade-in">
                <div className="auth-container">
                    <div className="auth-header">
                        <h1>Sign-in failed</h1>
                        <p>{errMsg}</p>
                    </div>
                    <button className="btn-primary full-width" onClick={() => navigate('/auth')}>
                        Back to sign in
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="auth-page fade-in">
            <div className="auth-container">
                <div className="auth-header">
                    <h1>Signing you in&hellip;</h1>
                    <p>Please wait while we complete authentication.</p>
                </div>
            </div>
        </div>
    );
}
