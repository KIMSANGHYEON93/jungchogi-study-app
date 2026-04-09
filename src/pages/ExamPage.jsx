import { useState, useEffect, useRef } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { parseQuiz } from '../utils/parseQuiz';
import { parseCodeDrill } from '../utils/parseCodeDrill';
import { addWrongNote, getWrongNotes, removeWrongNote } from '../utils/storage';

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function ExamPage() {
  const [phase, setPhase] = useState('ready'); // ready | exam | result
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [timeLeft, setTimeLeft] = useState(150 * 60); // 150분
  const [currentQ, setCurrentQ] = useState(0);
  const timerRef = useRef(null);
  const [wrongIds, setWrongIds] = useState(new Set());

  // 문제 풀 로드
  const [quizPool, setQuizPool] = useState([]);
  const [codePool, setCodePool] = useState([]);

  useEffect(() => {
    Promise.all([
      fetch('/data/정처기_단답형_100선.md').then((r) => r.text()),
      fetch('/data/정처기_코드트레이싱_드릴.md').then((r) => r.text()),
    ]).then(([quizMd, codeMd]) => {
      setQuizPool(parseQuiz(quizMd).map((q) => ({ ...q, type: 'quiz' })));
      setCodePool(parseCodeDrill(codeMd).map((q) => ({ ...q, type: 'code' })));
    });
  }, []);

  const startExam = () => {
    // 단답형 12문제 + 코드 8문제 = 20문제
    const quizQ = shuffleArray(quizPool).slice(0, 12);
    const codeQ = shuffleArray(codePool).slice(0, 8);
    const all = shuffleArray([...quizQ, ...codeQ]);
    setQuestions(all);
    setAnswers({});
    setCurrentQ(0);
    setTimeLeft(150 * 60);
    setPhase('exam');
  };

  // 타이머
  useEffect(() => {
    if (phase !== 'exam') return;
    timerRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(timerRef.current);
          setPhase('result');
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [phase]);

  const submitExam = () => {
    clearInterval(timerRef.current);
    setPhase('result');
    const savedWrong = getWrongNotes().filter((n) => n.source === 'exam').map((n) => n.id);
    setWrongIds(new Set(savedWrong));
  };

  const timerClass = timeLeft < 300 ? 'timer danger' : timeLeft < 600 ? 'timer warning' : 'timer';
  const answeredCount = Object.keys(answers).filter((k) => answers[k]?.trim()).length;

  // ─── READY ───
  if (phase === 'ready') {
    return (
      <div className="page">
        <h1>모의고사</h1>
        <p className="subtitle">실전과 동일한 150분 타이머 + 랜덤 20문제</p>

        <div className="card" style={{ textAlign: 'center', padding: '60px 32px' }}>
          <div style={{ fontSize: '4rem', marginBottom: 16 }}>📝</div>
          <h2 style={{ marginBottom: 12 }}>정보처리기사 실기 모의고사</h2>
          <p style={{ color: 'var(--text-dim)', marginBottom: 8 }}>단답형 12문제 + 코드 트레이싱 8문제 = 총 20문제</p>
          <p style={{ color: 'var(--text-dim)', marginBottom: 8 }}>제한 시간: 150분 (2시간 30분)</p>
          <p style={{ color: 'var(--text-dim)', marginBottom: 32 }}>합격 기준: 60점 이상 (100점 만점, 문항당 5점)</p>

          <button className="btn-primary" onClick={startExam} style={{ fontSize: '1.1rem', padding: '14px 40px' }}
            disabled={quizPool.length === 0}>
            {quizPool.length === 0 ? '문제 로딩 중...' : '시험 시작'}
          </button>
        </div>
      </div>
    );
  }

  // ─── EXAM ───
  if (phase === 'exam') {
    const q = questions[currentQ];
    return (
      <div className="page">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h1 style={{ marginBottom: 0 }}>모의고사</h1>
          <div className={timerClass}>{formatTime(timeLeft)}</div>
        </div>

        <div className="progress-bar" style={{ marginBottom: 16 }}>
          <div className="fill" style={{ width: `${(answeredCount / 20) * 100}%` }} />
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
          {questions.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrentQ(i)}
              style={{
                width: 36, height: 36, borderRadius: 8, fontSize: '0.85rem', fontWeight: 600,
                background: i === currentQ ? 'var(--primary)' : answers[i]?.trim() ? 'var(--bg-hover)' : 'transparent',
                color: i === currentQ ? '#fff' : answers[i]?.trim() ? 'var(--success)' : 'var(--text-dim)',
                border: `1px solid ${i === currentQ ? 'var(--primary)' : 'var(--border)'}`,
              }}
            >
              {i + 1}
            </button>
          ))}
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontWeight: 700 }}>문제 {currentQ + 1} / 20</span>
            <span className={`badge ${q.type === 'code' ? 'badge-warning' : 'badge-primary'}`}>
              {q.type === 'code' ? `코드(${q.lang?.toUpperCase()})` : '단답형'}
            </span>
          </div>

          {q.type === 'quiz' ? (
            <h2 style={{ fontSize: '1.15rem', lineHeight: 1.7, marginBottom: 16 }}>{q.question}</h2>
          ) : (
            <>
              <h3 style={{ marginBottom: 12 }}>{q.title}</h3>
              <SyntaxHighlighter language={q.lang} style={oneDark} customStyle={{ borderRadius: 8, fontSize: '0.9rem' }}>
                {q.code}
              </SyntaxHighlighter>
            </>
          )}

          <textarea
            className="quiz-input"
            rows={3}
            placeholder={q.type === 'code' ? '출력 결과를 입력하세요' : '정답을 입력하세요'}
            value={answers[currentQ] || ''}
            onChange={(e) => setAnswers({ ...answers, [currentQ]: e.target.value })}
            style={{ resize: 'vertical', fontFamily: q.type === 'code' ? "'JetBrains Mono', monospace" : 'inherit' }}
          />

          <div className="flashcard-nav" style={{ marginTop: 16 }}>
            <button className="btn-outline" onClick={() => setCurrentQ((c) => Math.max(0, c - 1))} disabled={currentQ === 0}>
              ◀ 이전
            </button>
            <span className="flashcard-counter">{answeredCount}/20 답안 작성</span>
            <button className="btn-outline" onClick={() => setCurrentQ((c) => Math.min(19, c + 1))} disabled={currentQ === 19}>
              다음 ▶
            </button>
          </div>

          <div style={{ textAlign: 'center', marginTop: 24 }}>
            <button className="btn-danger" onClick={submitExam} style={{ padding: '12px 32px' }}>시험 제출</button>
          </div>
        </div>
      </div>
    );
  }

  // ─── RESULT ───
  const totalAnswered = Object.keys(answers).filter((k) => answers[k]?.trim()).length;
  const estimatedScore = Math.round((totalAnswered / 20) * 100);
  const pass = estimatedScore >= 60;

  return (
    <div className="page">
      <h1>시험 결과</h1>

      <div className="card score-display">
        <div style={{ fontSize: '1rem', color: 'var(--text-dim)', marginBottom: 8 }}>예상 점수</div>
        <div className={`score ${pass ? 'pass' : 'fail'}`}>{estimatedScore}점</div>
        <div style={{ marginTop: 12, fontSize: '1.2rem' }}>
          {pass ? '합격 예상! 🎉' : '아쉽습니다. 복습 후 재도전!'}
        </div>
        <div style={{ color: 'var(--text-dim)', marginTop: 8 }}>
          작성 답안: {totalAnswered}/20 | 미작성: {20 - totalAnswered}
        </div>
      </div>

      <h2 style={{ marginTop: 32, marginBottom: 16 }}>문제별 확인</h2>
      {questions.map((q, i) => (
        <div key={i} className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>문제 {i + 1}. {q.type === 'quiz' ? q.question : q.title}</strong>
            <span className={`badge ${q.type === 'code' ? 'badge-warning' : 'badge-primary'}`}>
              {q.type === 'code' ? q.lang?.toUpperCase() : '단답형'}
            </span>
          </div>
          <div style={{ marginTop: 8 }}>
            <span style={{ color: 'var(--text-dim)' }}>내 답안: </span>
            <span style={{ color: answers[i]?.trim() ? 'var(--text)' : 'var(--danger)' }}>
              {answers[i]?.trim() || '(미작성)'}
            </span>
          </div>
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: 'pointer', color: 'var(--primary)', fontWeight: 600 }}>정답 확인</summary>
            <div className="md-content" style={{ marginTop: 8, fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>
              {q.answer}
            </div>
          </details>
          <div style={{ marginTop: 8 }}>
            {wrongIds.has(q.id) ? (
              <button
                className="btn-outline"
                style={{ color: 'var(--success)', fontSize: '0.85rem', padding: '6px 14px' }}
                onClick={() => {
                  removeWrongNote('exam', q.id);
                  setWrongIds((prev) => { const s = new Set(prev); s.delete(q.id); return s; });
                }}
              >
                오답노트에서 제거
              </button>
            ) : (
              <button
                className="btn-outline"
                style={{ color: 'var(--danger)', fontSize: '0.85rem', padding: '6px 14px' }}
                onClick={() => {
                  addWrongNote({
                    id: q.id,
                    source: 'exam',
                    type: q.type,
                    question: q.type === 'quiz' ? q.question : undefined,
                    title: q.type === 'code' ? q.title : undefined,
                    code: q.type === 'code' ? q.code : undefined,
                    lang: q.type === 'code' ? q.lang : undefined,
                    answer: q.answer,
                    pitfall: q.pitfall,
                    userAnswer: answers[i]?.trim() || '',
                    category: q.category,
                  });
                  setWrongIds((prev) => new Set(prev).add(q.id));
                }}
              >
                오답노트에 추가
              </button>
            )}
          </div>
        </div>
      ))}

      <div style={{ textAlign: 'center', marginTop: 32 }}>
        <button className="btn-primary" onClick={() => setPhase('ready')} style={{ padding: '14px 40px' }}>
          다시 도전
        </button>
      </div>
    </div>
  );
}
