import useAiStream from '../hooks/useAiStream';
import MarkdownViewer from './MarkdownViewer';
import Icon from './Icon';

// 오류 코드별 사람이 읽을 수 있는 안내.
// 서버가 보낸 message 는 개발자용이라 그대로 띄우지 않고 코드로 문구를 고른다.
const ERROR_GUIDE = {
  UNAUTHORIZED: '접근 코드가 필요하거나 올바르지 않습니다. 설정된 접근 코드를 확인해 주세요.',
  RATE_LIMITED: '요청이 몰렸습니다. 잠시 후 다시 시도해 주세요.',
  BAD_REQUEST: '이 문항으로는 해설을 만들 수 없습니다.',
  UPSTREAM: 'AI 응답을 받지 못했습니다. 다시 시도해 주세요.',
  NETWORK: '서버에 연결하지 못했습니다. AI 해설 없이도 학습은 그대로 이어갈 수 있습니다.',
  PROTOCOL: '서버 응답 형식을 이해하지 못했습니다.',
};

const STATUS_ANNOUNCEMENT = {
  streaming: 'AI 해설을 받는 중입니다.',
  done: 'AI 해설이 완성됐습니다.',
  cancelled: 'AI 해설 생성을 중단했습니다.',
  error: 'AI 해설을 받지 못했습니다.',
};

/** usage 는 서버가 마지막 프레임에 실어 보낸다 — 비용 확인용으로 접어서 보여준다 */
function formatUsage(usage) {
  if (!usage) return null;
  const parts = [];
  if (usage.input_tokens != null) parts.push(`입력 ${usage.input_tokens}`);
  if (usage.cache_read_input_tokens != null) parts.push(`캐시 ${usage.cache_read_input_tokens}`);
  if (usage.output_tokens != null) parts.push(`출력 ${usage.output_tokens}`);
  return parts.length ? `토큰 ${parts.join(' · ')}` : null;
}

/**
 * 문항 하나에 대한 AI 해설 패널.
 *
 * 서버(`/api/ai/tutor`)가 없거나 실패해도 이 컴포넌트 안에서만 끝난다 —
 * 감싸는 화면의 기존 학습 흐름은 건드리지 않는다.
 *
 * @param {Object} props
 * @param {import('../domain/aiSource.js').AiSource|null} props.source 없으면 아무것도 그리지 않는다
 * @param {string} props.id 문항 ID
 * @param {string} [props.userAnswer] 사용자가 적었던 답
 */
export default function AiExplainPanel({ source, id, userAnswer = '' }) {
  const { status, text, error, usage, isStreaming, start, cancel } = useAiStream();

  // 대응하는 교재 출처를 못 찾은 문항은 AI 해설 자체를 내보내지 않는다
  if (!source || !id) return null;

  const handleStart = () => start({ source, id, userAnswer, history: [] });

  const hasOutput = text !== '';
  const usageLine = status === 'done' ? formatUsage(usage) : null;
  const retryLabel = status === 'error' ? '다시 시도' : '다시 생성';

  return (
    <section className="ai-explain" aria-labelledby={`ai-explain-title-${id}`}>
      <div className="ai-explain-head">
        <h4 className="ai-explain-title" id={`ai-explain-title-${id}`}>
          <Icon name="zap" size={14} /> AI 해설
        </h4>

        {status === 'idle' ? (
          <button
            type="button"
            className="btn-outline ai-explain-action"
            onClick={handleStart}
            aria-label={`AI 해설 생성 (${id}번 문항)`}
          >
            해설 요청
          </button>
        ) : null}

        {isStreaming ? (
          <button
            type="button"
            className="btn-outline ai-explain-action"
            onClick={cancel}
            aria-label={`AI 해설 생성 중단 (${id}번 문항)`}
          >
            중단
          </button>
        ) : null}

        {status === 'done' || status === 'cancelled' || status === 'error' ? (
          <button
            type="button"
            className="btn-outline ai-explain-action"
            onClick={handleStart}
            aria-label={`AI 해설 ${retryLabel} (${id}번 문항)`}
          >
            <Icon name="refresh" size={14} /> {retryLabel}
          </button>
        ) : null}
      </div>

      {/* 상태 변화만 짧게 알린다 — 델타마다 읽히지 않도록 본문과 분리했다 */}
      <p className="sr-only" role="status">
        {STATUS_ANNOUNCEMENT[status] ?? ''}
      </p>

      {status === 'error' ? (
        <div className="quiz-result incorrect ai-explain-error">
          <strong className="ai-explain-error-title">
            <Icon name="alert-circle" size={14} /> {ERROR_GUIDE[error.code] ?? ERROR_GUIDE.UPSTREAM}
          </strong>
        </div>
      ) : null}

      {hasOutput ? (
        // aria-busy 를 켜 두면 스크린리더가 스트리밍이 끝난 뒤 한 번에 읽는다.
        // polite 라도 델타마다 끼어들지 않게 하는 표준 장치다.
        <div
          className="ai-explain-output"
          aria-live="polite"
          aria-atomic="false"
          aria-busy={isStreaming}
        >
          <MarkdownViewer content={text} />
          {isStreaming ? <span className="ai-explain-caret" aria-hidden="true" /> : null}
        </div>
      ) : null}

      {status === 'streaming' && !hasOutput ? (
        <p className="ai-explain-hint">해설을 준비하는 중입니다…</p>
      ) : null}

      {status === 'cancelled' ? (
        <p className="ai-explain-hint">중단했습니다. 여기까지 받은 내용만 남아 있습니다.</p>
      ) : null}

      {usageLine ? <p className="ai-explain-hint">{usageLine}</p> : null}
    </section>
  );
}
