import { useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon';
import usePlanStream from '../hooks/usePlanStream';
import {
  AVAILABLE_MINUTES_OPTIONS,
  DEFAULT_AVAILABLE_MINUTES,
  buildPlanSnapshot,
  clampAvailableMinutes,
  planItemLink,
  planItemTitle,
} from '../domain/studyPlan';
import {
  getExamDate,
  getStudyPlan,
  loadProgress,
  saveProgress,
  saveStudyPlan,
  toLocalDateKey,
} from '../utils/storage';

// 오류 코드별 사람이 읽을 수 있는 안내.
// 서버가 보낸 message 는 개발자용이라 그대로 띄우지 않고 코드로 문구를 고른다.
const ERROR_GUIDE = {
  UNAUTHORIZED: '접근 코드가 필요하거나 올바르지 않습니다. 설정된 접근 코드를 확인해 주세요.',
  RATE_LIMITED: '요청이 몰렸습니다. 잠시 후 다시 시도해 주세요.',
  BAD_REQUEST: '학습 기록이 너무 많거나 형식이 맞지 않아 계획을 만들 수 없습니다.',
  UPSTREAM: 'AI 가 계획을 완성하지 못했습니다. 다시 시도해 주세요.',
  NETWORK: '서버에 연결하지 못했습니다. 계획 없이도 학습은 그대로 이어갈 수 있습니다.',
  PROTOCOL: '서버 응답 형식을 이해하지 못했습니다.',
};

const STATUS_ANNOUNCEMENT = {
  generating: 'AI 가 오늘의 계획을 세우는 중입니다.',
  done: '오늘의 계획이 준비됐습니다.',
  cancelled: '계획 생성을 중단했습니다.',
  error: '오늘의 계획을 만들지 못했습니다.',
};

const MINUTES_KEY = 'plan_minutes';

function formatMinutes(total) {
  if (total < 60) return `${total}분`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

/**
 * 대시보드 "오늘의 계획" 카드.
 *
 * 같은 날 다시 열면 저장된 계획을 그대로 보여준다 — 생성은 사용자가 버튼을
 * 누를 때만 일어나므로 화면을 여는 것만으로 AI 비용이 나가지 않는다.
 *
 * 서버(`/api/ai/plan`)가 없거나 실패해도 이 컴포넌트 안에서만 끝난다.
 */
export default function TodayPlanCard() {
  const [today] = useState(() => toLocalDateKey());
  const [savedPlan, setSavedPlan] = useState(() => getStudyPlan(today));
  const [minutes, setMinutes] = useState(() =>
    clampAvailableMinutes(loadProgress(MINUTES_KEY, DEFAULT_AVAILABLE_MINUTES))
  );
  const [examDate] = useState(() => getExamDate());
  const [saveFailed, setSaveFailed] = useState(false);
  const { status, steps, plan, error, isGenerating, start, cancel } = usePlanStream();

  // 방금 만든 계획이 있으면 그걸, 없으면 저장돼 있던 계획을 보여준다.
  const shownPlan = plan ?? savedPlan;
  const totalMinutes = shownPlan ? shownPlan.items.reduce((sum, i) => sum + (i.minutes || 0), 0) : 0;

  const handleMinutesChange = (event) => {
    const next = clampAvailableMinutes(event.target.value);
    setMinutes(next);
    saveProgress(MINUTES_KEY, next);
  };

  const handleGenerate = async () => {
    // 재생성은 기존 계획을 덮어쓴다. 하루치 한 칸뿐이라 되돌릴 수 없으므로 확인을 받는다.
    if (
      shownPlan &&
      !window.confirm('오늘의 계획을 다시 만들면 지금 계획은 사라집니다. 계속할까요?')
    ) {
      return;
    }
    setSaveFailed(false);
    const nextPlan = await start(buildPlanSnapshot({ availableMinutes: minutes }));
    if (!nextPlan) return; // 취소·오류는 훅이 상태로 알린다
    const stored = saveStudyPlan(nextPlan);
    setSavedPlan(nextPlan);
    setSaveFailed(!stored);
  };

  const actionLabel = shownPlan ? '다시 생성' : status === 'idle' ? '계획 만들기' : '다시 시도';

  return (
    <section className="card plan-card" aria-labelledby="today-plan-title">
      <div className="plan-card-head">
        <h2 className="plan-card-title" id="today-plan-title">
          <Icon name="target" size={18} /> 오늘의 계획
        </h2>
        <span className="plan-card-date">{today.replace(/-/g, '.')}</span>

        {isGenerating ? (
          <button
            type="button"
            className="btn-outline plan-card-action"
            onClick={cancel}
            aria-label="계획 생성 중단"
          >
            중단
          </button>
        ) : (
          <button
            type="button"
            className={shownPlan ? 'btn-outline plan-card-action' : 'btn-primary plan-card-action'}
            onClick={handleGenerate}
            aria-label={`오늘의 계획 ${actionLabel}`}
          >
            <Icon name={shownPlan ? 'refresh' : 'zap'} size={14} /> {actionLabel}
          </button>
        )}
      </div>

      {/* 상태 변화만 짧게 알린다 — 도구 진행 목록과 분리해 매 줄마다 읽히지 않게 한다 */}
      <p className="sr-only" role="status">
        {STATUS_ANNOUNCEMENT[status] ?? ''}
      </p>

      <div className="plan-card-controls">
        <label className="plan-minutes-label" htmlFor="plan-minutes">
          <Icon name="clock" size={14} /> 오늘 낼 수 있는 시간
        </label>
        <select
          id="plan-minutes"
          className="quiz-input plan-minutes-select"
          value={minutes}
          onChange={handleMinutesChange}
          disabled={isGenerating}
        >
          {AVAILABLE_MINUTES_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {formatMinutes(m)}
            </option>
          ))}
        </select>
      </div>

      {!examDate ? (
        <p className="plan-card-hint">
          시험일을 설정하면 남은 기간까지 반영해 계획을 세웁니다.
        </p>
      ) : null}

      {isGenerating ? (
        <div className="plan-progress">
          <p className="plan-card-hint">
            <span className="loading-spinner plan-spinner" /> 계획을 세우는 중입니다. 최대 1분까지
            걸릴 수 있습니다.
          </p>
          {/* aria-busy 를 켜 두면 스크린리더가 끝난 뒤 한 번에 읽는다 */}
          <ol className="plan-steps" aria-live="polite" aria-atomic="false" aria-busy>
            {steps.map((step, i) => (
              <li key={i} className="plan-step">
                {step}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="quiz-result incorrect plan-error">
          <strong className="plan-error-title">
            <Icon name="alert-circle" size={14} /> {ERROR_GUIDE[error.code] ?? ERROR_GUIDE.UPSTREAM}
          </strong>
        </div>
      ) : null}

      {status === 'cancelled' ? (
        <p className="plan-card-hint">계획 생성을 중단했습니다.</p>
      ) : null}

      {shownPlan ? (
        <>
          <ol className="plan-items">
            {shownPlan.items.map((item, i) => {
              const link = planItemLink(item);
              return (
                <li key={i} className="plan-item">
                  <div className="plan-item-head">
                    <span className="plan-item-title">{planItemTitle(item)}</span>
                    <span className="badge badge-primary plan-item-minutes">{item.minutes}분</span>
                  </div>
                  {item.why ? <p className="plan-item-why">{item.why}</p> : null}
                  {link ? (
                    <Link className="plan-item-link" to={link.to}>
                      {link.label} <Icon name="chevron-right" size={14} />
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ol>

          <div className="plan-card-foot">
            <span className="plan-total">합계 {formatMinutes(totalMinutes)}</span>
          </div>

          {shownPlan.rationale ? (
            <p className="plan-rationale">{shownPlan.rationale}</p>
          ) : null}

          {shownPlan.riskFlags.length > 0 ? (
            <ul className="plan-risks">
              {shownPlan.riskFlags.map((flag, i) => (
                <li key={i} className="plan-risk">
                  <Icon name="alert-circle" size={14} /> {flag}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      {shownPlan === null && !isGenerating && status === 'idle' ? (
        <p className="plan-card-hint">
          오답노트·학습 시간·D-Day 를 읽어 오늘 무엇을 얼마나 공부할지 정해 줍니다.
        </p>
      ) : null}

      {saveFailed ? (
        <p className="plan-card-hint plan-card-warn">
          <Icon name="alert-circle" size={14} /> 저장 공간이 부족해 계획을 저장하지 못했습니다.
          대시보드 &quot;데이터 관리&quot;에서 정리한 뒤 다시 생성해 주세요.
        </p>
      ) : null}
    </section>
  );
}
