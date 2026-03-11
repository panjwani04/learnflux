import './MindMap.css';

const COLORS = [
    { bg: 'rgba(99,102,241,0.08)', border: 'rgba(99,102,241,0.35)', dot: '#6366f1' },
    { bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.35)', dot: '#10b981' },
    { bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.35)', dot: '#f59e0b' },
    { bg: 'rgba(236,72,153,0.08)', border: 'rgba(236,72,153,0.35)', dot: '#ec4899' },
];

function MindMap({ data }) {
    if (!data || !data.nodes?.length) {
        return <p className="empty-state">No mind map data available.</p>;
    }

    return (
        <div className="mindmap-wrapper">
            <div className="mindmap-center-row">
                <div className="mindmap-topic-card">{data.topic}</div>
            </div>
            <div className="mindmap-connector-line" />
            <div className="mindmap-grid">
                {data.nodes.map((node, i) => {
                    const c = COLORS[i % COLORS.length];
                    return (
                        <div
                            key={i}
                            className="mindmap-branch-card"
                            style={{ backgroundColor: c.bg, borderColor: c.border }}
                        >
                            <div className="branch-header" style={{ color: c.dot }}>{node.title}</div>
                            <ul className="branch-details">
                                {(node.children || []).map((child, j) => (
                                    <li key={j} style={{ '--dot-color': c.dot }}>{child}</li>
                                ))}
                            </ul>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export default MindMap;
