// Central API base URL — reads from env, falls back to localhost for dev
export const API = import.meta.env.VITE_API_URL || 'http://localhost:5000';
