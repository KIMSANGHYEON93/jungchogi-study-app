import { useState, useEffect, useCallback } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import ReactMarkdown from 'react-markdown';
import { getWrongNotes, removeWrongNote, updateWrongNote, clearAllWrongNotes } from '../utils/storage';

const SOURCE_LABEL = { quiz: '코드퀴즈', exam: '모의고사' };
const FILTER_OPTIONS = ['전체', '코드퀴즈', '모의고사', '미복습', '복습완료'];

export default function WrongNotePage() {
  const [notes, setNotes] = useState([]);
  const [filter, setFilter] = useState('전체');
  const [expandedId, setExpandedId] = useState(null);
  const [retryMode, setRetryMode] = useState(null); // { source, id }
  const [retryAnswer, setRetryAnswer] = useState('');
  const [retrySubmitted, setRetrySubmitted] = useState(false);

  const reload = useCallback(() => setNotes(getWrongNotes()), []);

  useEffect(() => { reload(); }, [reload]);

  const filtered = notes.filter((n) => {
    if (filter === '코드퀴즈') return n.source === 'quiz';
    if (filter === '모의고사') return n.source === 'exam';
    if (filter === '미복습') return n.reviewCount === 0;
    if (filter === '복습완료') return n.reviewCount > 0;
    return true;
  });

  const handleRemove = (source, id) => {
    removeWrongNote(source, id);
    reload();
  };

  const handleRetryStart = (note) => {
    setRetryMode({ source: note.source, id: note.id });
    setRetryAnswer('');
    setRetrySubmitted(false);
  };

  const handleRetrySubmit = (note) => {
    setRetrySubmitted(true);
    updateWrongNote(note.source, note.id, {
      reviewCount: note.reviewCount + 1,
      lastReviewed: Date.now(),
    });
    reload();
  };

  const handleClearAll = () => {
    if (window.confirm('모든 오답노트를 삭제하시겠습니까?')) {
      clearAllWrongNotes();
      reload();
    }
  };

  const totalCount = notes.length;
  const reviewedCount = notes.filter((n) => n.reviewCount > 0).length;
  const unreviewedCount = totalCount - reviewedCount;

  return (
    <div className="page">
      <h1>오답노트</h1>
      <p className="subtitle">틀린 문제를 모아서 복습하세요</p>

      <div className="stats">
        <div className="stat-box">
          <div className="value">{totalCount}</div>
          <div className="label">전체 오답</div>
        </div>
        <div className="stat-box">
          <div className="value" style={{ color: 'var(--warning)' }}>{unreviewedCount}</div>
          <div className="label">미복습</div>
        </div>
        <div className="stat-box">
          <div className="value" style={{ color: 'var(--success)' }}>{reviewedCount}</div>
          <div className="label">복습완료</div>
        </div>
      </div>

      <div className="progress-bar">
        <div className="fill" style={{ width: `${totalCount ? (reviewedCount / totalCount) * 100 : 0}%` }} />
      </div>

      <div className="filter-bar">
        {FILTER_OPTIONS.map((f) => (
          <button key={f} className={`btn-outline ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
            {f}
          </button>
        ))}
        {totalCount > 0 && (
          <button className="btn-outline" onClick={handleClearAll} style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}>
            전체 삭제
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 60 }}>
          <div style={{ fontSize: '3rem', marginBottom: 16 }}>
            {totalCount === 0 ? '🎉' : '📭'}
          </div>
          <p style={{ color: 'var(--text-dim)' }}>
            {totalCount === 0
              ? '오답이 없습니다! 퀴즈나 모의고사에서 틀린 문제가 여기에 추가됩니다.'
              : '해당 필터에 맞는 오답이 없습니다.'}
          </p>
        </div>
      ) : (
        filtered.map((note) => {
          const key = `${note.source}_${note.id}`;
          const isExpanded = expandedId === key;
          const isRetrying = retryMode?.source === note.source && retryMode?.id === note.id;

          return (
            <div key={key} className="card wrong-note-card" style={{ marginBottom: 12 }}>
              {/* Header */}
              <div
                className="wrong-note-header"
                onClick={() => setExpandedId(isExpanded ? null : key)}
                style={{ cursor: 'pointer' }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className={`badge ${note.source === 'quiz' ? 'badge-primary' : 'badge-warning'}`}>
                      {SOURCE_LABEL[note.source]}
                    </span>
                    {note.type === 'code' && (
                      <span className="badge badge-danger">{note.lang?.toUpperCase()}</span>
                    )}
                    {note.reviewCount > 0 && (
                      <span className="badge badge-success">복습 {note.reviewCount}회</span>
                    )}
                  </div>
                  <h3 style={{ fontSize: '1rem', marginTop: 8, lineHeight: 1.6 }}>
                    {note.type === 'code' ? `${note.id}. ${note.title}` : `${note.id}. ${note.question}`}
                  </h3>
                </div>
                <span style={{ color: 'var(--text-dim)', fontSize: '1.2rem', flexShrink: 0 }}>
                  {isExpanded ? '▲' : '▼'}
                </span>
              </div>

              {/* Expanded content */}
              {isExpanded && (
                <div style={{ marginTop: 16 }}>
                  {/* Code block for code type */}
                  {note.type === 'code' && note.code && (
                    <SyntaxHighlighter
                      language={note.lang}
                      style={oneDark}
                      customStyle={{ borderRadius: 8, fontSize: '0.9rem' }}
                    >
                      {note.code}
                    </SyntaxHighlighter>
                  )}

                  {/* User's wrong answer */}
                  {note.userAnswer && (
                    <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(248,113,113,0.1)', borderRadius: 8, border: '1px solid var(--danger)' }}>
                      <span style={{ fontSize: '0.85rem', color: 'var(--danger)', fontWeight: 600 }}>내 오답: </span>
                      <span>{note.userAnswer}</span>
                    </div>
                  )}

                  {/* Retry mode */}
                  {isRetrying && !retrySubmitted ? (
                    <div style={{ marginTop: 12 }}>
                      <label style={{ fontSize: '0.9rem', color: 'var(--text-dim)', marginBottom: 8, display: 'block' }}>
                        다시 풀어보세요:
                      </label>
                      <input
                        className="quiz-input"
                        type="text"
                        value={retryAnswer}
                        onChange={(e) => setRetryAnswer(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleRetrySubmit(note); }}
                        placeholder={note.type === 'code' ? '출력 결과를 입력하세요' : '정답을 입력하세요'}
                        autoFocus
                      />
                      <button className="btn-primary" onClick={() => handleRetrySubmit(note)} style={{ marginTop: 8 }}>
                        정답 확인
                      </button>
                    </div>
                  ) : null}

                  {/* Answer (shown when not retrying, or after retry submit) */}
                  {(!isRetrying || retrySubmitted) && (
                    <div className="quiz-result correct" style={{ marginTop: 12 }}>
                      <h4 style={{ marginBottom: 8, color: 'var(--success)' }}>정답</h4>
                      <div className="md-content" style={{ fontSize: '0.9rem' }}>
                        <ReactMarkdown>{note.answer}</ReactMarkdown>
                      </div>
                      {note.pitfall && (
                        <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(251,191,36,0.1)', borderRadius: 8, border: '1px solid var(--warning)' }}>
                          <strong style={{ color: 'var(--warning)' }}>함정:</strong> {note.pitfall}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Action buttons */}
                  <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                    {!isRetrying && (
                      <button className="btn-primary" onClick={() => handleRetryStart(note)}>
                        다시 풀기
                      </button>
                    )}
                    {isRetrying && retrySubmitted && (
                      <button className="btn-primary" onClick={() => setRetryMode(null)}>
                        닫기
                      </button>
                    )}
                    <button
                      className="btn-outline"
                      onClick={() => handleRemove(note.source, note.id)}
                      style={{ color: 'var(--danger)' }}
                    >
                      삭제
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
