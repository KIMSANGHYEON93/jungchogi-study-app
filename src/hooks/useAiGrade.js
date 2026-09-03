import { useState, useRef, useCallback, useEffect } from 'react';
import { gradeAnswer } from '../services/aiClient';
import { normalizeGradeResult } from '../domain/grading';

/**
 * @typedef {'idle'|'grading'|'done'|'cancelled'|'error'} AiGradeStatus
 */

/**
 * @typedef {Object} AiGradeState
 * @property {AiGradeStatus} status
 * @property {import('../domain/grading.js').GradeResult|null} result
 * @property {{code: string, message: string}|null} error
 */

/** @type {AiGradeState} */
const IDLE_STATE = { status: 'idle', result: null, error: null };

/**
 * AI 채점 요청의 상태를 관리한다.
 *
 * 채점은 사용자가 버튼을 누를 때(= 이벤트 핸들러)만 시작한다.
 * effect 에서 setState 를 하지 않으므로 react-hooks 의 set-state-in-effect 를 건드리지 않는다.
 * 언마운트 정리만 effect 로 걸어 둔다.
 *
 * 채점은 수십 초가 걸릴 수 있어 취소가 필요하다. 취소는 오류가 아니다 —
 * 사용자는 언제든 기존 자기 채점으로 넘어갈 수 있어야 한다.
 */
export default function useAiGrade() {
  const [state, setState] = useState(IDLE_STATE);
  const controllerRef = useRef(null);
  // 재호출·언마운트 뒤 늦게 도착한 응답이 최신 상태를 덮어쓰지 못하게 하는 표식
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
   * 채점을 시작한다. 진행 중이던 요청은 취소하고 상태를 초기화한다.
   *
   * 정규화한 결과를 그대로 돌려준다 — 호출부(패널·페이지)가 effect 없이
   * 핸들러 안에서 바로 저장할 수 있어야 set-state-in-effect 를 만들지 않는다.
   *
   * @param {import('../services/aiClient.js').GradeRequest} request
   * @returns {Promise<import('../domain/grading.js').GradeResult|null>}
   */
  const start = useCallback(async (request) => {
    controllerRef.current?.abort();

    const controller = new AbortController();
    controllerRef.current = controller;
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    const isCurrent = () => aliveRef.current && runIdRef.current === runId;

    setState({ status: 'grading', result: null, error: null });

    try {
      const { result, aborted } = await gradeAnswer(request, { signal: controller.signal });
      if (!isCurrent()) return null;

      // 취소는 오류가 아니다 — 조용히 멈추고 자기 채점으로 넘어갈 수 있게 둔다.
      if (aborted) {
        setState({ status: 'cancelled', result: null, error: null });
        return null;
      }

      const normalized = normalizeGradeResult(result);
      if (!normalized) {
        setState({
          status: 'error',
          result: null,
          error: { code: 'UPSTREAM', message: '채점 결과를 이해할 수 없는 형태로 받았습니다.' },
        });
        return null;
      }
      setState({ status: 'done', result: normalized, error: null });
      return normalized;
    } catch (err) {
      if (!isCurrent()) return null;
      setState({
        status: 'error',
        result: null,
        error: { code: err?.code ?? 'UPSTREAM', message: err?.message ?? '알 수 없는 오류' },
      });
      return null;
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, []);

  /** 진행 중인 채점을 멈춘다. */
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
    result: state.result,
    error: state.error,
    isGrading: state.status === 'grading',
    start,
    cancel,
    reset,
  };
}
