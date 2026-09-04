import { useState, useEffect } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import ReactMarkdown from 'react-markdown';
import { parseCodeDrill } from '../utils/parseCodeDrill';
import {
  saveProgress,
  loadProgress,
  addWrongNote,
  getWrongNotes,
  removeWrongNote,
  VARIANT_RESULTS_KEY,
} from '../utils/storage';
import useStudyTimer from '../hooks/useStudyTimer';
import useVariantPreference from '../hooks/useVariantPreference';
import { fetchMarkdown } from '../utils/mdCache';
import { applyGeneratedItems } from '../utils/generatedDeck';
import Icon from '../components/Icon';
import ProblemContext from '../components/ProblemContext';
import AiExplainPanel from '../components/AiExplainPanel';
import AiGradePanel from '../components/AiGradePanel';
import GeneratedBadge, { GeneratedAnswerNotice } from '../components/GeneratedBadge';
import VariantToggle from '../components/VariantToggle';
import { toAiSource, toGradeKind } from '../domain/aiSource';
import { isGeneratedItem } from '../domain/generatedItems';
import {
  QUIZ_RESULT,
  isConfidentGrade,
  summarizeQuizResults,
  verdictToQuizResult,
  withQuizResult,
} from '../domain/grading';
import { useThemeContext } from '../hooks/useTheme';
import { useDeepLinkId, useDeepLinkedIndex, deckDeepLinkNotice } from '../hooks/useDeepLink';

const LANGS = ['전체', 'c', 'java', 'python', 'sql'];
const LANG_LABEL = { 전체: '전체', c: 'C', java: 'Java', python: 'Python', sql: 'SQL' };

// 이 화면은 코드트레이싱 드릴만 낸다. 그래도 출처·종류는 화면에 적어 두지 않고
// 문항 서술에서 유도한다 — 모의고사와 같은 규칙을 쓰기 위해서다.
// AI 변형 문항이면 `toAiSource` 가 null 을 주고 패널이 통째로 사라진다 —
// 서버 guard 의 ID_PATTERN 이 변형 id 를 거절해 400 이 나기 때문이다.
const quizItem = (problem) => ({ source: 'quiz', generated: problem?.generated, id: problem?.id });

/** 딥링크 안내 배너 — 함정 안내와 같은 결(경고 톤)로 맞춘다 */
const NOTICE_STYLE = {
  margin: '12px 0',
  padding: '10px 14px',
  borderRadius: 8,
  fontSize: '0.9rem',
  background: 'rgba(251,191,36,0.1)',
  border: '1px solid var(--warning)',
  color: 'var(--text)',
};

const SELF_GRADE_STATE = {
  [QUIZ_RESULT.CORRECT]: '정답으로 기록됨',
  [QUIZ_RESULT.INCORRECT]: '오답으로 기록됨',
};

export default function QuizPage() {
  useStudyTimer();
  const { theme } = useThemeContext();
  const syntaxTheme = theme === 'dark' ? oneDark : oneLight;
  // `/quiz?id=C-07` 로 지목받은 문항. 첫 렌더에만 읽는다.
  const requestedId = useDeepLinkId();
  const [allProblems, setAllProblems] = useState([]);
  const [lang, setLang] = useState('전체');
  const [userAnswer, setUserAnswer] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [results, setResults] = useState({}); // { id: 'correct'|'incorrect'|'answered' }
  // 변형 채점은 별도 맵에 쌓는다 — 아래 saveResults 주석 참조
  const [variantResults, setVariantResults] = useState({});
  const [wrongIds, setWrongIds] = useState(new Set());
  const [includeVariants, changeIncludeVariants] = useVariantPreference();
  const [variantsAvailable, setVariantsAvailable] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchMarkdown('정처기_코드트레이싱_드릴.md')
      .then((text) => applyGeneratedItems(parseCodeDrill(text), 'codedrill', includeVariants))
      .then(({ items, available }) => {
        if (cancelled) return;
        setAllProblems(items);
        setVariantsAvailable(available);
        setResults(loadProgress('quiz_results', {}));
        setVariantResults(loadProgress(VARIANT_RESULTS_KEY, {}));
        const savedWrong = getWrongNotes().filter((n) => n.source === 'quiz').map((n) => n.id);
        setWrongIds(new Set(savedWrong));
      });
    return () => { cancelled = true; };
  }, [includeVariants]);

  // lang 필터는 파생 상태 — effect 없이 렌더 중 계산한다
  const problems = lang === '전체' ? allProblems : allProblems.filter((p) => p.lang === lang);
  // 문항 커서. 딥링크가 지목한 문항이 목록에 있으면 거기서 시작한다.
  // 목록은 md fetch 뒤에 도착하므로 커서를 렌더 중에 파생해야 effect 없이 맞출 수 있다.
  const { index: idx, setIndex, missedId } = useDeepLinkedIndex(problems, requestedId);
  const current = problems[idx];
  const deepLinkNotice = deckDeepLinkNotice(missedId, { variantsOff: !includeVariants });

  // 변형 문항의 진도는 교재 진도와 **다른 키**에 쌓는다.
  // `quiz_results` 에는 분모가 40 으로 고정된 진도(대시보드 `quizDone/40`,
  // 이 화면의 "남은 문제")가 걸려 있어, 변형 id 가 섞이면 진도가 40 을 넘는다.
  // 모의고사 결과를 이 맵에 쓰지 않는 것과 같은 이유다.
  const isVariant = isGeneratedItem(current);
  const currentResults = isVariant ? variantResults : results;
  const saveResults = (next) => {
    if (isVariant) {
      setVariantResults(next);
      saveProgress(VARIANT_RESULTS_KEY, next);
    } else {
      setResults(next);
      saveProgress('quiz_results', next);
    }
  };

  const handleSubmit = () => {
    if (!userAnswer.trim()) return;
    setSubmitted(true);
    // 시도 자체는 바로 남긴다(진도 표시가 여기에 걸려 있다). 정오는 아직 모르므로
    // 'answered' = "시도했으나 정오 미상". 이미 채점된 문항은 덮어쓰지 않는다 —
    // 다시 풀었다고 지난 판정을 정오 미상으로 되돌리면 정보가 사라진다.
    const recorded = currentResults[current.id];
    if (recorded === QUIZ_RESULT.CORRECT || recorded === QUIZ_RESULT.INCORRECT) return;
    saveResults({ ...currentResults, [current.id]: QUIZ_RESULT.ANSWERED });
  };

  /**
   * 채점 결과를 남긴다. 자기 채점 버튼과 AI 채점 확정분이 같은 길로 들어온다.
   * @param {'correct'|'incorrect'} verdict
   */
  const recordGrade = (verdict) => {
    saveResults(withQuizResult(currentResults, current.id, verdict));
  };

  // §4.2: 확신이 낮은 판정은 확정으로 쓰지 않고 자기 채점 버튼에 맡긴다.
  const handleAiGrade = (result) => {
    if (!isConfidentGrade(result)) return;
    const verdict = verdictToQuizResult(result.verdict);
    if (verdict) recordGrade(verdict);
  };

  const goTo = (newIdx) => {
    setIndex(newIdx);
    setUserAnswer('');
    setSubmitted(false);
  };

  // 언어를 바꾸면 첫 문제로 되돌린다 — effect 대신 이벤트 핸들러에서 리셋
  const changeLang = (l) => {
    setLang(l);
    goTo(0);
  };

  // 레거시 'answered' 를 정답으로도 오답으로도 세지 않는 셈은 도메인이 한다.
  // 진도는 **교재 문항만** 센다 — 변형은 덤이지 진도의 분모가 아니다.
  const summary = summarizeQuizResults(results);
  const solvedCount = summary.attempted;
  const totalCount = allProblems.filter((p) => !isGeneratedItem(p)).length;
  const currentVerdict = current ? currentResults[current.id] : undefined;
  const aiItem = quizItem(current);

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
          <div className="value" style={{ color: 'var(--success)' }}>{solvedCount}</div>
          <div className="label">풀이 완료</div>
        </div>
        <div className="stat-box">
          <div className="value" style={{ color: 'var(--warning)' }}>{totalCount - solvedCount}</div>
          <div className="label">남은 문제</div>
        </div>
      </div>

      <div className="progress-bar">
        <div className="fill" style={{ width: `${totalCount ? (solvedCount / totalCount) * 100 : 0}%` }} />
      </div>

      <div className="filter-bar">
        {LANGS.map((l) => (
          <button key={l} className={`btn-outline ${lang === l ? 'active' : ''}`} onClick={() => changeLang(l)}>
            {LANG_LABEL[l]}
          </button>
        ))}
        <VariantToggle
          enabled={includeVariants}
          available={variantsAvailable}
          onChange={(next) => { changeIncludeVariants(next); goTo(0); }}
        />
      </div>

      {/* 지목받은 문항을 못 찾았을 때. 조용히 다른 문항을 열면 사용자는
          계획이 틀렸는지 앱이 틀렸는지 알 수 없다. */}
      {deepLinkNotice && (
        <div className="deep-link-notice" role="status" style={NOTICE_STYLE}>
          {deepLinkNotice}
        </div>
      )}

      {problems.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 60 }}>문제를 불러오는 중...</div>
      ) : current ? (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: '1.1rem' }}>{current.id}. {current.title}</h2>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
              <GeneratedBadge item={current} />
              <span className="badge badge-primary">{current.lang.toUpperCase()}</span>
            </div>
          </div>

          <ProblemContext text={current.context} fontSize="0.9rem" />

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
                <GeneratedAnswerNotice item={current} />
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
                          context: current.context,
                          code: current.code,
                          lang: current.lang,
                          answer: current.answer,
                          pitfall: current.pitfall,
                          userAnswer: userAnswer,
                          // 표시를 함께 남긴다 — 오답노트 화면이 배지를 붙이고
                          // AI 해설 버튼을 띄우지 않는 근거가 된다
                          generated: isVariant || undefined,
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

            {/* AI 채점은 정답을 이미 공개한 뒤에만 띄운다 — feedback·missedPoints 가
                정답을 설명하는 문장이라 그 전에 보이면 답을 흘리게 된다. */}
            {submitted && (
              <AiGradePanel
                key={`grade-${current.id}`}
                source={toAiSource(aiItem)}
                kind={toGradeKind(aiItem)}
                id={current.id}
                userAnswer={userAnswer}
                onResult={handleAiGrade}
              />
            )}

            {/* 자기 채점 — AI 가 없어도, 확신이 낮아도, 틀렸어도 여기서 끝낼 수 있다 */}
            {submitted && (
              <div className="self-grade">
                <span className="self-grade-label" id={`self-grade-label-${current.id}`}>
                  직접 채점
                </span>
                <button
                  type="button"
                  className={`btn-outline self-grade-button ${currentVerdict === QUIZ_RESULT.CORRECT ? 'active' : ''}`}
                  aria-pressed={currentVerdict === QUIZ_RESULT.CORRECT}
                  onClick={() => recordGrade(QUIZ_RESULT.CORRECT)}
                >
                  맞았어요
                </button>
                <button
                  type="button"
                  className={`btn-outline self-grade-button ${currentVerdict === QUIZ_RESULT.INCORRECT ? 'active' : ''}`}
                  aria-pressed={currentVerdict === QUIZ_RESULT.INCORRECT}
                  onClick={() => recordGrade(QUIZ_RESULT.INCORRECT)}
                >
                  틀렸어요
                </button>
                <span className="self-grade-state" role="status">
                  {SELF_GRADE_STATE[currentVerdict] ?? '아직 채점하지 않음'}
                </span>
              </div>
            )}

            {/* 기존 풀이 블록(aria-live)의 바깥에 둔다 — 라이브 영역이 겹치면
                스크린리더가 델타마다 끼어든다. 문항이 바뀌면 key 로 새로 마운트되고,
                진행 중이던 스트리밍은 언마운트에서 취소된다. */}
            {submitted && (
              <AiExplainPanel
                key={current.id}
                source={toAiSource(aiItem)}
                id={current.id}
                userAnswer={userAnswer}
              />
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
