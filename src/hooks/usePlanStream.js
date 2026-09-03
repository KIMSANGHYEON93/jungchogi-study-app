import { useState, useRef, useCallback, useEffect } from 'react';
import { streamPlan } from '../services/aiClient';
import { describeToolEvent, normalizePlan } from '../domain/studyPlan';
import { toLocalDateKey } from '../utils/storage';

/**
 * @typedef {'idle'|'generating'|'done'|'cancelled'|'error'} PlanStreamStatus
 */

/**
 * @typedef {Object} PlanStreamState
 * @property {PlanStreamStatus} status
 * @property {string[]} steps 지금까지의 도구 호출 진행 문구
 * @property {import('../domain/studyPlan.js').StudyPlan|null} plan
 * @property {{code: string, message: string}|null} error
 * @property {object|null} usage
 */

/** @type {PlanStreamState} */
const IDLE_STATE = { status: 'idle', steps: [], plan: null, error: null, usage: null };

/**
 * 학습 계획 생성 스트리밍의 상태를 관리한다.
 *
 * 생성은 사용자가 버튼을 누를 때(= 이벤트 핸들러)만 시작한다.
 * effect 에서 setState 를 하지 않으므로 react-hooks 의 set-state-in-effect 를 건드리지 않는다.
 * 언마운트 정리만 effect 로 걸어 둔다.
 */
export default function usePlanStream() {
  const [state, setState] = useState(IDLE_STATE);
  const controllerRef = useRef(null);
  // 재호출·언마운트 뒤 늦게 도착한 콜백이 최신 상태를 덮어쓰지 못하게 하는 표식
  const runIdRef = useRef(0);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, []);

  /**
   * 계획 생성을 시작한다. 진행 중이던 요청은 취소하고 상태를 초기화한다.
   *
   * 만들어진 계획을 그대로 돌려준다 — 호출부(카드)가 effect 없이 핸들러 안에서
   * 바로 저장할 수 있어야 set-state-in-effect 를 만들지 않는다.
   *
   * @param {import('../domain/studyPlan.js').PlanSnapshot} snapshot
   * @returns {Promise<import('../domain/studyPlan.js').StudyPlan|null>}
   */
  const start = useCallback(async (snapshot) => {
    controllerRef.current?.abort();

    const controller = new AbortController();
    controllerRef.current = controller;
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    const isCurrent = () => aliveRef.current && runIdRef.current === runId;

    setState({ status: 'generating', steps: [], plan: null, error: null, usage: null });

    try {
      const { plan, usage, aborted } = await streamPlan(snapshot, {
        signal: controller.signal,
        onToolEvent: (event) => {
          if (!isCurrent()) return;
          // 도구 호출은 60초 동안 몇 줄씩 온다. 화면이 살아 있다는 유일한 신호다.
          setState((prev) => ({ ...prev, steps: [...prev.steps, describeToolEvent(event)] }));
        },
      });
      if (!isCurrent()) return null;

      // 취소는 오류가 아니다 — 받은 진행 표시만 남기고 조용히 멈춘다.
      if (aborted) {
        setState((prev) => ({ ...prev, status: 'cancelled' }));
        return null;
      }

      const normalized = normalizePlan(plan, { date: toLocalDateKey() });
      if (!normalized) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: { code: 'UPSTREAM', message: '계획을 이해할 수 없는 형태로 받았습니다.' },
        }));
        return null;
      }
      setState((prev) => ({ ...prev, status: 'done', plan: normalized, usage: usage ?? null }));
      return normalized;
    } catch (err) {
      if (!isCurrent()) return null;
      setState((prev) => ({
        ...prev,
        status: 'error',
        plan: null,
        error: { code: err?.code ?? 'UPSTREAM', message: err?.message ?? '알 수 없는 오류' },
        usage: null,
      }));
      return null;
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, []);

  /** 진행 중인 생성을 멈춘다. */
  const cancel = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  /** 유휴 상태로 되돌린다. */
  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    runIdRef.current += 1;
    setState(IDLE_STATE);
  }, []);

  return {
    status: state.status,
    steps: state.steps,
    plan: state.plan,
    error: state.error,
    usage: state.usage,
    isGenerating: state.status === 'generating',
    start,
    cancel,
    reset,
  };
}
