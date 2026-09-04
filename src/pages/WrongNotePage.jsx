import { useState, useCallback, useEffect, useRef } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import ReactMarkdown from 'react-markdown';
import { getWrongNotes, removeWrongNote, markWrongNoteReviewed, clearAllWrongNotes } from '../utils/storage';
import Icon from '../components/Icon';
import ProblemContext from '../components/ProblemContext';
import AiExplainPanel from '../components/AiExplainPanel';
import GeneratedBadge, { GeneratedAnswerNotice } from '../components/GeneratedBadge';
import { toAiSource } from '../domain/aiSource';
import { useThemeContext } from '../hooks/useTheme';
import { useDeepLinkId, formatDeepLinkId, DEEP_LINK_NOTICE_STYLE } from '../hooks/useDeepLink';

const SOURCE_LABEL = { quiz: '코드퀴즈', exam: '모의고사' };
const FILTER_OPTIONS = ['전체', '코드퀴즈', '모의고사', '미복습', '복습완료'];

// 오답 하나를 가리키는 키. 같은 id 가 코드퀴즈·모의고사 양쪽에 있을 수 있다.
const noteKey = (note) => `${note.source}_${note.id}`;

export default function WrongNotePage() {
  const { theme } = useThemeContext();
  const syntaxTheme = theme === 'dark' ? oneDark : oneLight;
  // `/wrong?id=C-07` 로 지목받은 오답. 첫 렌더에만 읽는다.
  const requestedId = useDeepLinkId();
  const [notes, setNotes] = useState(getWrongNotes);
  const [filter, setFilter] = useState('전체');
  // 목록이 localStorage 에서 바로 오므로 첫 렌더에서 대상을 정할 수 있다 —
  // effect 로 맞출 일이 없어 set-state-in-effect 가 생기지 않는다.
  // 계약(`?id=`)에 출처가 없으므로 id 가 같은 첫 오답을 연다.
  const [deepLinkKey] = useState(() => {
    const target = requestedId ? notes.find((n) => n.id === requestedId) : null;
    return target ? noteKey(target) : null;
  });
  const [expandedId, setExpandedId] = useState(deepLinkKey);
  // 첫 렌더 시점에 고정한다. 뒤에 사용자가 그 오답을 지웠다고 안내가 뜨면 안 된다.
  const [missedId] = useState(() => (requestedId !== null && deepLinkKey === null ? requestedId : null));
  const deepLinkRef = useRef(null);
  const [retryMode, setRetryMode] = useState(null); // { source, id }
  const [retryAnswer, setRetryAnswer] = useState('');
  const [retrySubmitted, setRetrySubmitted] = useState(false);

  const reload = useCallback(() => setNotes(getWrongNotes()), []);

  // 지목받은 카드가 목록 아래쪽이면 펼쳐도 화면 밖이다. 첫 렌더 뒤 한 번만 끌어온다 —
  // 이후 사용자가 다른 카드를 펼칠 때 스크롤을 가로채지 않는다.
  useEffect(() => {
    const el = deepLinkRef.current;
    // 구현이 없는 환경(jsdom 등)에서는 건너뛴다
    if (typeof el?.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
  }, []);

  const deepLinkNotice = missedId
    ? `URL 이 지정한 ${formatDeepLinkId(missedId)} 문항을 오답노트에서 찾지 못했습니다. 이미 지웠거나 다른 화면의 문항일 수 있습니다.`
    : '';

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
    markWrongNoteReviewed(note.source, note.id);
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

      {/* 지목받은 오답을 못 찾았을 때. 아무 카드도 펼치지 않으므로 이유를 말해 주지 않으면
          사용자는 링크가 죽은 것인지 화면이 고장난 것인지 알 수 없다. */}
      {deepLinkNotice && (
        <div className="deep-link-notice" role="status" style={DEEP_LINK_NOTICE_STYLE}>
          {deepLinkNotice}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 60 }}>
          <div style={{ marginBottom: 16, color: 'var(--text-dim)' }}>
            {totalCount === 0 ? <Icon name="party" size={48}/> : <Icon name="inbox" size={48}/>}
          </div>
          <p style={{ color: 'var(--text-dim)' }}>
            {totalCount === 0
              ? '오답이 없습니다! 퀴즈나 모의고사에서 틀린 문제가 여기에 추가됩니다.'
              : '해당 필터에 맞는 오답이 없습니다.'}
          </p>
        </div>
      ) : (
        filtered.map((note) => {
          const key = noteKey(note);
          const isExpanded = expandedId === key;
          const isRetrying = retryMode?.source === note.source && retryMode?.id === note.id;

          return (
            <div
              key={key}
              ref={key === deepLinkKey ? deepLinkRef : null}
              className="card wrong-note-card"
              style={{ marginBottom: 12 }}
            >
              {/* Header */}
              <div
                className="wrong-note-header"
                onClick={() => setExpandedId(isExpanded ? null : key)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedId(isExpanded ? null : key); } }}
                role="button"
                tabIndex={0}
                aria-expanded={isExpanded}
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
                    <GeneratedBadge item={note} />
                  </div>
                  <h3 style={{ fontSize: '1rem', marginTop: 8, lineHeight: 1.6 }}>
                    {note.type === 'code' ? `${note.id}. ${note.title}` : `${note.id}. ${note.question}`}
                  </h3>
                </div>
                <span style={{ color: 'var(--text-dim)', flexShrink: 0 }}>
                  <Icon name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16}/>
                </span>
              </div>

              {/* Expanded content */}
              {isExpanded && (
                <div style={{ marginTop: 16 }}>
                  {/* Code block for code type */}
                  {note.type === 'code' && <ProblemContext text={note.context} fontSize="0.9rem" />}
                  {note.type === 'code' && note.code && (
                    <SyntaxHighlighter
                      language={note.lang}
                      style={syntaxTheme}
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
                      <GeneratedAnswerNotice item={note} />
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

                  {/* 대응하는 교재 출처를 못 찾으면 toAiSource 가 null 을 주고 패널은 아무것도 그리지 않는다.
                      AI 변형 문항도 여기서 걸린다 — 서버 guard 의 ID_PATTERN 이 변형 id 를 거절해 400 이다. */}
                  <AiExplainPanel
                    source={toAiSource(note)}
                    id={note.id}
                    userAnswer={note.userAnswer}
                  />
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
