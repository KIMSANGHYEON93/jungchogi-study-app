import useAiGrade from '../hooks/useAiGrade';
import Icon from './Icon';
import { isConfidentGrade } from '../domain/grading';

// 오류 코드별 사람이 읽을 수 있는 안내.
// 서버가 보낸 message 는 개발자용이라 그대로 띄우지 않고 코드로 문구를 고른다.
// 모든 문구가 "직접 채점하면 된다"로 끝난다 — AI 채점은 보조이지 관문이 아니다.
const ERROR_GUIDE = {
  UNAUTHORIZED: '접근 코드가 필요하거나 올바르지 않습니다. 아래에서 직접 채점해 주세요.',
  RATE_LIMITED: '요청이 몰렸습니다. 잠시 후 다시 시도하거나 직접 채점해 주세요.',
  BAD_REQUEST: '이 문항은 AI 로 채점할 수 없습니다. 직접 채점해 주세요.',
  UPSTREAM: 'AI 가 채점을 마치지 못했습니다. 다시 시도하거나 직접 채점해 주세요.',
  NETWORK: '서버에 연결하지 못했습니다. 직접 채점하면 학습은 그대로 이어집니다.',
  PROTOCOL: '서버 응답 형식을 이해하지 못했습니다. 직접 채점해 주세요.',
};

const STATUS_ANNOUNCEMENT = {
  grading: 'AI 가 답안을 채점하는 중입니다.',
  done: 'AI 채점이 끝났습니다.',
  cancelled: 'AI 채점을 중단했습니다.',
  error: 'AI 채점을 받지 못했습니다.',
};

const VERDICT_LABEL = {
  correct: '정답',
  partial: '부분 정답',
  incorrect: '오답',
};

/** 판정별 배지 색 — 기존 quiz-result 규칙(정답=success, 오답=danger)을 그대로 쓴다 */
const VERDICT_BADGE = {
  correct: 'badge-success',
  partial: 'badge-warning',
  incorrect: 'badge-danger',
};

/**
 * 문항 하나에 대한 AI 보조 채점 패널.
 *
 * **정답을 흘리지 않는 것이 이 컴포넌트의 전제다.** feedback·missedPoints 는
 * 정답을 설명하는 문장이므로, 감싸는 화면이 정답을 이미 공개한 시점
 * (코드 퀴즈의 `정답 확인` 이후 · 모의고사의 제출 이후)에만 이 패널을 그린다.
 * 그리고 그 뒤에도 사용자가 버튼을 누르기 전에는 아무것도 요청·표시하지 않는다.
 *
 * 서버(`/api/ai/grade`)가 없거나 실패해도 이 컴포넌트 안에서만 끝난다 —
 * 감싸는 화면의 자기 채점 흐름은 그대로 남는다.
 *
 * @param {Object} props
 * @param {import('../domain/aiSource.js').AiSource|null} props.source 없으면 아무것도 그리지 않는다
 * @param {import('../domain/aiSource.js').GradeKind|null} props.kind
 * @param {string} props.id 문항 ID
 * @param {string} [props.userAnswer] 사용자가 적은 답
 * @param {(result: import('../domain/grading.js').GradeResult) => void} [props.onResult]
 *   채점이 끝나면 호출된다. 확정으로 쓸지(= 저장할지)는 화면이 `isConfidentGrade` 로 판단한다.
 */
export default function AiGradePanel({ source, kind, id, userAnswer = '', onResult }) {
  const { status, result, error, isGrading, start, cancel } = useAiGrade();

  // 대응하는 교재 출처·문항 종류를 못 찾은 문항은 AI 채점 자체를 내보내지 않는다
  if (!source || !kind || !id) return null;

  const handleStart = async () => {
    const graded = await start({ kind, source, id, userAnswer });
    // 이벤트 핸들러 안에서 넘긴다 — effect 로 넘기면 set-state-in-effect 가 된다
    if (graded) onResult?.(graded);
  };

  const confident = isConfidentGrade(result);
  const retryLabel = status === 'error' ? '다시 시도' : '다시 채점';

  return (
    <section className="ai-grade" aria-labelledby={`ai-grade-title-${id}`}>
      <div className="ai-grade-head">
        <h4 className="ai-grade-title" id={`ai-grade-title-${id}`}>
          <Icon name="check-circle" size={14} /> AI 채점
        </h4>

        {status === 'idle' ? (
          <button
            type="button"
            className="btn-outline ai-grade-action"
            onClick={handleStart}
            aria-label={`AI 채점 요청 (${id}번 문항)`}
          >
            채점 요청
          </button>
        ) : null}

        {isGrading ? (
          <button
            type="button"
            className="btn-outline ai-grade-action"
            onClick={cancel}
            aria-label={`AI 채점 중단 (${id}번 문항)`}
          >
            중단
          </button>
        ) : null}

        {status === 'done' || status === 'cancelled' || status === 'error' ? (
          <button
            type="button"
            className="btn-outline ai-grade-action"
            onClick={handleStart}
            aria-label={`AI 채점 ${retryLabel} (${id}번 문항)`}
          >
            <Icon name="refresh" size={14} /> {retryLabel}
          </button>
        ) : null}
      </div>

      {/* 상태 변화만 짧게 알린다 — 본문과 분리해 결과를 두 번 읽지 않게 한다 */}
      <p className="sr-only" role="status">
        {STATUS_ANNOUNCEMENT[status] ?? ''}
      </p>

      {status === 'idle' ? (
        <p className="ai-grade-hint">
          AI 가 답안을 채점해 참고 의견을 냅니다. 최종 판단은 직접 하실 수 있습니다.
        </p>
      ) : null}

      {isGrading ? (
        <p className="ai-grade-hint">
          <span className="loading-spinner ai-grade-spinner" /> 답안을 채점하는 중입니다. 수십 초까지
          걸릴 수 있습니다.
        </p>
      ) : null}

      {status === 'cancelled' ? (
        <p className="ai-grade-hint">AI 채점을 중단했습니다. 아래에서 직접 채점해 주세요.</p>
      ) : null}

      {status === 'error' ? (
        <div className="quiz-result incorrect ai-grade-error">
          <strong className="ai-grade-error-title">
            <Icon name="alert-circle" size={14} /> {ERROR_GUIDE[error.code] ?? ERROR_GUIDE.UPSTREAM}
          </strong>
        </div>
      ) : null}

      {status === 'done' && result ? (
        <div className={`ai-grade-result ${confident ? '' : 'ai-grade-uncertain'}`}>
          <div className="ai-grade-verdict">
            <span className={`badge ${VERDICT_BADGE[result.verdict]}`}>
              {VERDICT_LABEL[result.verdict]}
            </span>
            <span className="ai-grade-score">{result.score}점</span>
            {confident ? null : (
              <span className="badge badge-warning ai-grade-uncertain-badge">참고 의견</span>
            )}
          </div>

          {/* §4.2: confidence 가 낮으면 판정을 확정으로 쓰지 않고 자기 채점으로 넘긴다 */}
          {confident ? null : (
            <p className="ai-grade-fallback">
              <Icon name="alert-circle" size={14} /> AI 가 확신하지 못한 채점입니다(확신도{' '}
              {Math.round(result.confidence * 100)}%). 위 판정은 참고로만 보고,
              맞았는지 틀렸는지는 아래에서 직접 확인해 주세요.
            </p>
          )}

          {result.feedback ? <p className="ai-grade-feedback">{result.feedback}</p> : null}

          {result.missedPoints.length > 0 ? (
            <ul className="ai-grade-missed">
              {result.missedPoints.map((point, i) => (
                <li key={i} className="ai-grade-missed-item">
                  {point}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
