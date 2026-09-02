import { useState, useRef, useCallback, useEffect } from 'react';
import { streamTutor } from '../services/aiClient';

/**
 * @typedef {'idle'|'streaming'|'done'|'cancelled'|'error'} AiStreamStatus
 */

/**
 * @typedef {Object} AiStreamState
 * @property {AiStreamStatus} status
 * @property {string} text 지금까지 받은 해설
 * @property {{code: string, message: string}|null} error
 * @property {object|null} usage 완료 시 서버가 알려준 토큰 사용량
 */

/** @type {AiStreamState} */
const IDLE_STATE = { status: 'idle', text: '', error: null, usage: null };

/**
 * AI 해설 스트리밍의 상태를 관리한다.
 *
 * 스트리밍은 사용자가 버튼을 누를 때(= 이벤트 핸들러)만 시작한다.
 * effect 에서 setState 를 하지 않으므로 react-hooks 의 set-state-in-effect 를 건드리지 않는다.
 * 언마운트 정리만 effect 로 걸어 둔다.
 */
export default function useAiStream() {
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
   * 해설 스트리밍을 시작한다. 진행 중이던 요청은 취소하고 상태를 초기화한다.
   * @param {import('../services/aiClient.js').TutorRequest} request
   */
  const start = useCallback(async (request) => {
    controllerRef.current?.abort();

    const controller = new AbortController();
    controllerRef.current = controller;
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    const isCurrent = () => aliveRef.current && runIdRef.current === runId;

    setState({ status: 'streaming', text: '', error: null, usage: null });

    try {
      const { text, usage, aborted } = await streamTutor(request, {
        signal: controller.signal,
        onDelta: (delta) => {
          if (!isCurrent()) return;
          setState((prev) => ({ ...prev, text: prev.text + delta }));
        },
      });
      if (!isCurrent()) return;
      // 취소는 오류가 아니다 — 받은 데까지 남기고 조용히 멈춘다.
      setState({ status: aborted ? 'cancelled' : 'done', text, error: null, usage });
    } catch (err) {
      if (!isCurrent()) return;
      setState((prev) => ({
        status: 'error',
        // 스트림이 중간에 끊겼으면 그때까지의 해설은 보여 준다
        text: err?.partialText || prev.text,
        error: { code: err?.code ?? 'UPSTREAM', message: err?.message ?? '알 수 없는 오류' },
        usage: null,
      }));
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, []);

  /** 진행 중인 스트리밍을 멈춘다. 받은 텍스트는 남는다. */
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
    text: state.text,
    error: state.error,
    usage: state.usage,
    isStreaming: state.status === 'streaming',
    start,
    cancel,
    reset,
  };
}
