import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { UploadCloud, FileText, CheckCircle, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../lib/api';
import './Upload.css';

function Upload() {
    const [dragActive, setDragActive] = useState(false);
    const [file, setFile] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [stage, setStage] = useState('');
    const [error, setError] = useState(null);
    const [slowWarning, setSlowWarning] = useState(false);
    const inputRef = useRef(null);
    const navigate = useNavigate();
    const { getToken } = useAuth();

    const STAGES = [
        { at: 10,  label: 'Uploading PDF...' },
        { at: 30,  label: 'Extracting text...' },
        { at: 55,  label: 'AI analyzing document...' },
        { at: 75,  label: 'Generating study notes...' },
        { at: 85,  label: 'AI rate limit — retrying shortly...' },
        { at: 90,  label: 'Almost there — waiting for AI...' },
    ];

    const handleDrag = function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") {
            setDragActive(true);
        } else if (e.type === "dragleave") {
            setDragActive(false);
        }
    };

  const processFile = (selectedFile) => {
    if (selectedFile && selectedFile.type === "application/pdf") {
      setError(null);
      setFile(selectedFile);
      uploadToServer(selectedFile);
    } else {
      setError("Please upload a valid PDF file.");
    }
  };

    const handleDrop = function (e) {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            processFile(e.dataTransfer.files[0]);
        }
    };

    const handleChange = function (e) {
        e.preventDefault();
        if (e.target.files && e.target.files[0]) {
            processFile(e.target.files[0]);
        }
    };

    const onButtonClick = () => {
        if (!uploading) {
            inputRef.current.click();
        }
    };

const uploadToServer = async (selectedFile) => {
  setUploading(true);
  setProgress(0);
  setStage('Uploading PDF...');
  setSlowWarning(false);
  const slowTimer = setTimeout(() => setSlowWarning(true), 25000);

  const formData = new FormData();
  formData.append("file", selectedFile);

  // Attach auth token so server can save lesson to DB for logged-in users
  const token = await getToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  let currentProgress = 0;
  const progressInterval = setInterval(() => {
    // Below 83%: fast approach; above 83%: crawl slowly up to 96% (covers retry waits)
    const cap = currentProgress < 83 ? 83 : 96;
    const speed = currentProgress < 83 ? 0.07 : 0.008;
    currentProgress += (cap - currentProgress) * speed;
    const rounded = Math.min(96, Math.round(currentProgress));
    setProgress(rounded);
    const activeStage = [...STAGES].reverse().find(s => rounded >= s.at);
    if (activeStage) setStage(activeStage.label);
  }, 400);

  try {
    const response = await fetch(`${API}/upload`, {
      method: "POST",
      headers,
      body: formData
    });

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error("Server error (status " + response.status + "). Make sure the server is running.");
    }

    const data = await response.json();

    if (!response.ok || data.error) {
      throw new Error(data.error || "Server error");
    }

    clearInterval(progressInterval);
    clearTimeout(slowTimer);
    setSlowWarning(false);
    setStage('Complete!');

    const lesson = {
      ...data,
      id: Date.now(),
      title: data.title || selectedFile.name.replace(/\.pdf$/i, ''),
      date: new Date().toISOString(),
    };

    localStorage.setItem("learnflux_current", JSON.stringify(lesson));
    localStorage.setItem("documentText", lesson.documentText || '');
    const existing = JSON.parse(localStorage.getItem("learnflux_lessons") || "[]");
    existing.unshift(lesson);
    localStorage.setItem("learnflux_lessons", JSON.stringify(existing.slice(0, 50)));

    // Index document chunks for RAG (non-blocking — fires and forgets)
    if (lesson.documentText) {
      fetch(`${API}/index`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId: lesson.id, documentText: lesson.documentText }),
      }).catch(() => {});
    }

    setProgress(100);
    setTimeout(() => navigate('/result'), 1000);

  } catch (err) {
    clearInterval(progressInterval);
    clearTimeout(slowTimer);
    setSlowWarning(false);
    setUploading(false);
    setFile(null);
    setProgress(0);
    setStage('');
    setError(err.message);
  }
};

    return (
        <div className="upload-page fade-in">
            <div className="upload-container">
                <h1 className="upload-title">Upload your PDF materials</h1>
                <p className="upload-subtitle">We'll analyze your document and generate a full AI study guide.</p>

                {error && (
                    <div className="upload-error">
                        <AlertCircle size={18} />
                        <span>{error}</span>
                    </div>
                )}

                <form
                    className={`drop-zone ${dragActive ? "drag-active" : ""} ${file ? "file-selected" : ""}`}
                    onDragEnter={handleDrag}
                    onDragLeave={handleDrag}
                    onDragOver={handleDrag}
                    onDrop={handleDrop}
                    onClick={onButtonClick}
                >
                    <input
                        ref={inputRef}
                        type="file"
                        accept="application/pdf"
                        className="file-input"
                        onChange={handleChange}
                    />

                    {!file && (
                        <div className="drop-zone-content">
                            <UploadCloud size={64} className="upload-icon" />
                            <h3>Drag & drop your PDF here</h3>
                            <p>or click to browse files</p>
                        </div>
                    )}

                    {file && !uploading && (
                        <div className="drop-zone-content">
                            <FileText size={64} className="file-icon" />
                            <h3>{file.name}</h3>
                            <p>{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                        </div>
                    )}

                    {uploading && slowWarning && (
                        <div className="upload-rate-warning">
                            ⚠️ AI is busy — auto-retrying. Please wait, this may take up to 60 seconds.
                        </div>
                    )}

                    {uploading && (
                        <div className="upload-progress-container">
                            <div className="progress-header">
                                <FileText size={24} className="file-icon-small" />
                                <span className="file-name">{file.name}</span>
                                {progress >= 100 && <CheckCircle size={24} className="success-icon" />}
                            </div>
                            <div className="progress-bar-bg">
                                <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
                            </div>
                            <div className="progress-stages">
                                {STAGES.map((s) => (
                                    <span
                                        key={s.at}
                                        className={`stage-dot ${progress >= s.at ? 'active' : ''}`}
                                    />
                                ))}
                            </div>
                            <p className="progress-text">
                                {progress < 100 ? `${stage} ${Math.round(progress)}%` : 'Complete! Redirecting...'}
                            </p>
                        </div>
                    )}
                </form>
            </div>
        </div>
    );
}

export default Upload;

