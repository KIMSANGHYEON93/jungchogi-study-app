import { useState, useEffect, useRef } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { parseQuiz } from '../utils/parseQuiz';
import { parseCodeDrill } from '../utils/parseCodeDrill';
import {
  addWrongNote,
  getWrongNotes,
  removeWrongNote,
  getExamResults,
  saveExamResults,
} from '../utils/storage';
import useStudyTimer from '../hooks/useStudyTimer';
import useVariantPreference from '../hooks/useVariantPreference';
import { fetchMarkdown } from '../utils/mdCache';
import { applyGeneratedItems } from '../utils/generatedDeck';
import Icon from '../components/Icon';
import ProblemContext from '../components/ProblemContext';
import AiGradePanel from '../components/AiGradePanel';
import GeneratedBadge from '../components/GeneratedBadge';
import VariantToggle from '../components/VariantToggle';
import { toAiSource, toGradeKind } from '../domain/aiSource';
import { isGeneratedItem } from '../domain/generatedItems';
import {
  QUIZ_RESULT,
  isConfidentGrade,
  verdictToQuizResult,
  withQuizResult,
} from '../domain/grading';
import { useThemeContext } from '../hooks/useTheme';

// 모의고사는 단답형(quiz100)과 코드 트레이싱(codedrill)을 섞어 낸다.
// 어느 교재에서 온 문항인지·어떻게 채점할 문항인지는 화면이 아니라 문항이 정한다.
// AI 변형 문항이면 `toAiSource` 가 null 을 주고 채점 패널이 통째로 사라진다 —
// 서버 guard 의 ID_PATTERN 이 변형 id 를 거절해 400 이 나기 때문이다.
const examItem = (q) => ({ source: 'exam', type: q?.type, generated: q?.generated, id: q?.id });

/** 자기 채점 상태 문구 — 코드 퀴즈(QuizPage)와 같은 말을 쓴다 */
const SELF_GRADE_STATE = {
  [QUIZ_RESULT.CORRECT]: '정답으로 기록됨',
  [QUIZ_RESULT.INCORRECT]: '오답으로 기록됨',
};

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
  useStudyTimer();
  const { theme } = useThemeContext();
  const syntaxTheme = theme === 'dark' ? oneDark : oneLight;
  const [phase, setPhase] = useState('ready'); // ready | exam | result
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [timeLeft, setTimeLeft] = useState(150 * 60); // 150분
  const [currentQ, setCurrentQ] = useState(0);
  const timerRef = useRef(null);
  const endTimeRef = useRef(null);
  const [wrongIds, setWrongIds] = useState(new Set());
  // 모의고사 채점 결과는 `exam_results` 에 쌓는다 — `quiz_results` 는 분모가 40 으로
  // 고정된 코드 퀴즈 진도를 세는 칸이라 모의고사 id 가 섞이면 진도가 어긋난다.
  const [examResults, setExamResults] = useState(getExamResults);

  // 문제 풀 로드
  const [quizPool, setQuizPool] = useState([]);
  const [codePool, setCodePool] = useState([]);
  const [includeVariants, changeIncludeVariants] = useVariantPreference();
  const [variantsAvailable, setVariantsAvailable] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchMarkdown('정처기_단답형_100선.md').then((md) =>
        applyGeneratedItems(parseQuiz(md), 'quiz100', includeVariants)
      ),
      fetchMarkdown('정처기_코드트레이싱_드릴.md').then((md) =>
        applyGeneratedItems(parseCodeDrill(md), 'codedrill', includeVariants)
      ),
    ]).then(([quiz, code]) => {
      if (cancelled) return;
      setQuizPool(quiz.items.map((q) => ({ ...q, type: 'quiz' })));
      setCodePool(code.items.map((q) => ({ ...q, type: 'code' })));
      setVariantsAvailable(quiz.available + code.available);
    });
    return () => { cancelled = true; };
  }, [includeVariants]);

  const startExam = () => {
    // 단답형 12문제 + 코드 8문제 = 20문제
    const quizQ = shuffleArray(quizPool).slice(0, 12);
    const codeQ = shuffleArray(codePool).slice(0, 8);
    const all = shuffleArray([...quizQ, ...codeQ]);
    setQuestions(all);
    setAnswers({});
    setCurrentQ(0);
    setTimeLeft(150 * 60);
    endTimeRef.current = Date.now() + 150 * 60 * 1000;
    setPhase('exam');
  };

  // 타이머 (Date.now 기반으로 drift 보정)
  useEffect(() => {
    if (phase !== 'exam') return;
    timerRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((endTimeRef.current - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(timerRef.current);
        setPhase('result');
        const savedWrong = getWrongNotes().filter((n) => n.source === 'exam').map((n) => n.id);
        setWrongIds(new Set(savedWrong));
      }
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [phase]);

  const submitExam = () => {
    clearInterval(timerRef.current);
    setPhase('result');
    const savedWrong = getWrongNotes().filter((n) => n.source === 'exam').map((n) => n.id);
    setWrongIds(new Set(savedWrong));
  };

  /**
   * 채점 결과를 남긴다. 자기 채점 버튼과 AI 채점 확정분이 같은 길로 들어온다
   * (코드 퀴즈의 `recordGrade` 와 같은 구조).
   *
   * 쓰기 직전에 저장소를 다시 읽는다. 결과 화면에는 채점 패널이 20개 떠 있고
   * 여러 문항의 채점이 동시에 진행될 수 있어, 렌더 시점에 잡힌 맵으로 덮어쓰면
   * 그 사이 끝난 다른 문항의 판정이 사라진다.
   *
   * @param {string} id
   * @param {'correct'|'incorrect'} verdict
   */
  const recordGrade = (id, verdict) => {
    const next = withQuizResult(getExamResults(), id, verdict);
    saveExamResults(next);
    setExamResults(next);
  };

  // §4.2: 확신이 낮은 판정은 확정으로 쓰지 않고 자기 채점 버튼에 맡긴다.
  const handleAiGrade = (id, result) => {
    if (!isConfidentGrade(result)) return;
    const verdict = verdictToQuizResult(result.verdict);
    if (verdict) recordGrade(id, verdict);
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
          <div style={{ marginBottom: 16, color: 'var(--primary)' }}><Icon name="exam" size={64}/></div>
          <h2 style={{ marginBottom: 12 }}>정보처리기사 실기 모의고사</h2>
          <p style={{ color: 'var(--text-dim)', marginBottom: 8 }}>단답형 12문제 + 코드 트레이싱 8문제 = 총 20문제</p>
          <p style={{ color: 'var(--text-dim)', marginBottom: 8 }}>제한 시간: 150분 (2시간 30분)</p>
          <p style={{ color: 'var(--text-dim)', marginBottom: 32 }}>합격 기준: 60점 이상 (100점 만점, 문항당 5점)</p>

          <button className="btn-primary" onClick={startExam} style={{ fontSize: '1.1rem', padding: '14px 40px' }}
            disabled={quizPool.length === 0}>
            {quizPool.length === 0 ? '문제 로딩 중...' : '시험 시작'}
          </button>

          {/* 변형 포함은 시험을 시작하기 전에만 고를 수 있다 — 출제 풀이 바뀌는 설정이라
              시험 중에 바꾸면 이미 낸 문제와 앞뒤가 맞지 않는다 */}
          <div className="filter-bar" style={{ justifyContent: 'center', marginTop: 24, marginBottom: 0 }}>
            <VariantToggle
              enabled={includeVariants}
              available={variantsAvailable}
              onChange={changeIncludeVariants}
            />
          </div>
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
          <div className={timerClass} role="timer" aria-live="assertive" aria-label="남은 시간">{formatTime(timeLeft)}</div>
        </div>

        <div className="progress-bar" role="progressbar" aria-valuenow={Math.round((answeredCount / 20) * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="학습 진도" style={{ marginBottom: 16 }}>
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
            <span style={{ display: 'flex', gap: 8 }}>
              <GeneratedBadge item={q} />
              <span className={`badge ${q.type === 'code' ? 'badge-warning' : 'badge-primary'}`}>
                {q.type === 'code' ? `코드(${q.lang?.toUpperCase()})` : '단답형'}
              </span>
            </span>
          </div>

          {q.type === 'quiz' ? (
            <h2 style={{ fontSize: '1.15rem', lineHeight: 1.7, marginBottom: 16 }}>{q.question}</h2>
          ) : (
            <>
              <h3 style={{ marginBottom: 12 }}>{q.title}</h3>
              <ProblemContext text={q.context} fontSize="0.9rem" />
              <SyntaxHighlighter language={q.lang} style={syntaxTheme} customStyle={{ borderRadius: 8, fontSize: '0.9rem' }}>
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
              <Icon name="chevron-left" size={16}/> 이전
            </button>
            <span className="flashcard-counter">{answeredCount}/20 답안 작성</span>
            <button className="btn-outline" onClick={() => setCurrentQ((c) => Math.min(19, c + 1))} disabled={currentQ === 19}>
              다음 <Icon name="chevron-right" size={16}/>
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
          {pass ? <><Icon name="party" size={24}/> 합격 예상!</> : '아쉽습니다. 복습 후 재도전!'}
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
            <span style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <GeneratedBadge item={q} />
              <span className={`badge ${q.type === 'code' ? 'badge-warning' : 'badge-primary'}`}>
                {q.type === 'code' ? q.lang?.toUpperCase() : '단답형'}
              </span>
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
          {/* AI 채점은 제출 후(이 결과 화면)에만 있다 — 시험 중에 띄우면
              feedback·missedPoints 가 아직 안 푼 문제의 답을 흘린다.
              확정분은 `exam_results` 에 쌓는다: `quiz_results` 는 코드 퀴즈 40문항의
              진도를 세는 칸이라, 모의고사가 낸 단답형 id 까지 섞이면 진도가 어긋난다. */}
          <AiGradePanel
            key={`grade-${i}`}
            source={toAiSource(examItem(q))}
            kind={toGradeKind(examItem(q))}
            id={q.id}
            userAnswer={answers[i]?.trim() || ''}
            onResult={(result) => handleAiGrade(q.id, result)}
          />

          {/* 자기 채점 — AI 가 없어도, 확신이 낮아도, 변형 문항이라 패널이 안 떠도
              여기서 끝낼 수 있다. 카드가 20장 늘어서므로 버튼마다 문항 번호를 붙인다. */}
          <div className="self-grade">
            <span className="self-grade-label">직접 채점</span>
            <button
              type="button"
              className={`btn-outline self-grade-button ${examResults[q.id] === QUIZ_RESULT.CORRECT ? 'active' : ''}`}
              aria-label={`맞았어요 (${q.id}번 문항)`}
              aria-pressed={examResults[q.id] === QUIZ_RESULT.CORRECT}
              onClick={() => recordGrade(q.id, QUIZ_RESULT.CORRECT)}
            >
              맞았어요
            </button>
            <button
              type="button"
              className={`btn-outline self-grade-button ${examResults[q.id] === QUIZ_RESULT.INCORRECT ? 'active' : ''}`}
              aria-label={`틀렸어요 (${q.id}번 문항)`}
              aria-pressed={examResults[q.id] === QUIZ_RESULT.INCORRECT}
              onClick={() => recordGrade(q.id, QUIZ_RESULT.INCORRECT)}
            >
              틀렸어요
            </button>
            <span className="self-grade-state" role="status">
              {SELF_GRADE_STATE[examResults[q.id]] ?? '아직 채점하지 않음'}
            </span>
          </div>

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
                    context: q.type === 'code' ? q.context : undefined,
                    code: q.type === 'code' ? q.code : undefined,
                    lang: q.type === 'code' ? q.lang : undefined,
                    answer: q.answer,
                    pitfall: q.pitfall,
                    userAnswer: answers[i]?.trim() || '',
                    category: q.category,
                    // 표시를 함께 남긴다 — 오답노트 화면이 배지를 붙이고
                    // AI 해설 버튼을 띄우지 않는 근거가 된다
                    generated: isGeneratedItem(q) || undefined,
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
