import { useState, useEffect } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import ReactMarkdown from 'react-markdown';
import { parseCodeDrill } from '../utils/parseCodeDrill';
import { saveProgress, loadProgress, addWrongNote, getWrongNotes, removeWrongNote } from '../utils/storage';
import Icon from '../components/Icon';
import { useThemeContext } from '../hooks/useTheme';

const LANGS = ['전체', 'c', 'java', 'python', 'sql'];
const LANG_LABEL = { 전체: '전체', c: 'C', java: 'Java', python: 'Python', sql: 'SQL' };

export default function QuizPage() {
  const { theme } = useThemeContext();
  const syntaxTheme = theme === 'dark' ? oneDark : oneLight;
  const [allProblems, setAllProblems] = useState([]);
  const [problems, setProblems] = useState([]);
  const [idx, setIdx] = useState(0);
  const [lang, setLang] = useState('전체');
  const [userAnswer, setUserAnswer] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [results, setResults] = useState({}); // { id: 'correct'|'incorrect' }
  const [wrongIds, setWrongIds] = useState(new Set());

  useEffect(() => {
    fetch('/data/정처기_코드트레이싱_드릴.md')
      .then((r) => r.text())
      .then((text) => {
        const parsed = parseCodeDrill(text);
        setAllProblems(parsed);
        setProblems(parsed);
        setResults(loadProgress('quiz_results', {}));
        const savedWrong = getWrongNotes().filter((n) => n.source === 'quiz').map((n) => n.id);
        setWrongIds(new Set(savedWrong));
      });
  }, []);

  useEffect(() => {
    const filtered = lang === '전체' ? allProblems : allProblems.filter((p) => p.lang === lang);
    setProblems(filtered);
    setIdx(0);
    setUserAnswer('');
    setSubmitted(false);
  }, [lang, allProblems]);

  const current = problems[idx];

  const handleSubmit = () => {
    if (!userAnswer.trim()) return;
    setSubmitted(true);
    const newResults = { ...results, [current.id]: 'answered' };
    setResults(newResults);
    saveProgress('quiz_results', newResults);
  };

  const goTo = (newIdx) => {
    setIdx(newIdx);
    setUserAnswer('');
    setSubmitted(false);
  };

  const correctCount = Object.keys(results).length;
  const totalCount = allProblems.length;

  return (
    <div className="page">
      <h1>코드 퀴즈</h1>
      <p className="subtitle">코드 트레이싱 40문제 — 출력 결과를 직접 입력하세요</p>

      <div className="stats">
        <div className="stat-box">
          <div className="value">{totalCount}</div>
          <div className="label">전체</div>
        </div>
        <div className="stat-box">
          <div className="value" style={{ color: 'var(--success)' }}>{correctCount}</div>
          <div className="label">풀이 완료</div>
        </div>
        <div className="stat-box">
          <div className="value" style={{ color: 'var(--warning)' }}>{totalCount - correctCount}</div>
          <div className="label">남은 문제</div>
        </div>
      </div>

      <div className="progress-bar">
        <div className="fill" style={{ width: `${totalCount ? (correctCount / totalCount) * 100 : 0}%` }} />
      </div>

      <div className="filter-bar">
        {LANGS.map((l) => (
          <button key={l} className={`btn-outline ${lang === l ? 'active' : ''}`} onClick={() => setLang(l)}>
            {LANG_LABEL[l]}
          </button>
        ))}
      </div>

      {problems.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 60 }}>문제를 불러오는 중...</div>
      ) : current ? (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: '1.1rem' }}>{current.id}. {current.title}</h2>
            <span className="badge badge-primary">{current.lang.toUpperCase()}</span>
          </div>

          <SyntaxHighlighter language={current.lang} style={syntaxTheme} customStyle={{ borderRadius: 8, fontSize: '0.9rem' }}>
            {current.code}
          </SyntaxHighlighter>

          <div style={{ marginTop: 16 }}>
            <label style={{ fontSize: '0.9rem', color: 'var(--text-dim)', marginBottom: 8, display: 'block' }}>
              출력 결과를 입력하세요:
            </label>
            <input
              className="quiz-input"
              type="text"
              value={userAnswer}
              onChange={(e) => setUserAnswer(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
              placeholder="예: 30 50"
              disabled={submitted}
            />
            {!submitted ? (
              <button className="btn-primary" onClick={handleSubmit} style={{ marginTop: 8 }}>정답 확인</button>
            ) : (
              <div className="quiz-result correct" style={{ marginTop: 12 }} aria-live="polite">
                <h3 style={{ marginBottom: 8, color: 'var(--success)' }}>풀이</h3>
                <div className="md-content" style={{ fontSize: '0.9rem' }}>
                  <ReactMarkdown>{current.answer}</ReactMarkdown>
                </div>
                {current.pitfall && (
                  <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(251,191,36,0.1)', borderRadius: 8, border: '1px solid var(--warning)' }}>
                    <strong style={{ color: 'var(--warning)' }}>함정:</strong> {current.pitfall}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                  {wrongIds.has(current.id) ? (
                    <button
                      className="btn-outline"
                      style={{ color: 'var(--success)' }}
                      onClick={() => {
                        removeWrongNote('quiz', current.id);
                        setWrongIds((prev) => { const s = new Set(prev); s.delete(current.id); return s; });
                      }}
                    >
                      오답노트에서 제거
                    </button>
                  ) : (
                    <button
                      className="btn-danger"
                      onClick={() => {
                        addWrongNote({
                          id: current.id,
                          source: 'quiz',
                          type: 'code',
                          title: current.title,
                          code: current.code,
                          lang: current.lang,
                          answer: current.answer,
                          pitfall: current.pitfall,
                          userAnswer: userAnswer,
                        });
                        setWrongIds((prev) => new Set(prev).add(current.id));
                      }}
                    >
                      오답노트에 추가
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flashcard-nav" style={{ marginTop: 20 }}>
            <button className="btn-outline" onClick={() => goTo(idx - 1)} disabled={idx === 0}><Icon name="chevron-left" size={16}/> 이전</button>
            <span className="flashcard-counter">{idx + 1} / {problems.length}</span>
            <button className="btn-outline" onClick={() => goTo(idx + 1)} disabled={idx === problems.length - 1}>다음 <Icon name="chevron-right" size={16}/></button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
