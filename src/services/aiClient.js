// AI 엔드포인트 클라이언트.
//
// 전송(헤더·취소·오류 정규화)은 `aiTransport.js`, SSE 프레임 파싱은
// `sseClient.js` 가 맡고, 여기서는 엔드포인트별 요청 본문과 응답 해석만 한다.

import { postSseStream } from './sseClient';
import { postAiJson, AiRequestError } from './aiTransport';
import { recordUsage } from '../utils/usageLedger';

export { AiRequestError };

/**
 * 서버가 실어 보낸 `cost` 를 사용 원장에 남긴다 (BLUEPRINT §5 Phase 5).
 *
 * **기록은 학습 흐름보다 뒤다.** 원장 쓰기가 어떤 이유로든 던져도 해설·계획·채점은
 * 그대로 진행돼야 한다. `recordUsage` 자체가 던지지 않도록 만들어져 있지만,
 * 그 계약이 깨지더라도 여기서 한 번 더 막는다.
 *
 * `cost` 가 없으면(서버가 아직 이 필드를 안 보내는 상태) 아무것도 남기지 않는다.
 *
 * @param {unknown} cost
 * @param {'tutor'|'plan'|'grade'} endpoint 서버가 endpoint 를 안 보낼 때 쓰는 값
 */
function logUsage(cost, endpoint) {
  try {
    recordUsage(cost, { endpoint });
  } catch {
    // 관측 데이터를 못 남긴 것뿐이다. 학습은 계속된다.
  }
}

/**
 * 서버 API 가 받는 문항 출처. 화면/오답노트의 source 와는 이름이 다르므로
 * `src/domain/aiSource.js` 의 `toAiSource()` 로 옮겨서 넘긴다.
 * @typedef {'quiz100'|'codedrill'|'bogang'} AiSource
 */

/**
 * @typedef {Object} TutorRequest
 * @property {AiSource} source
 * @property {string} id 문항 ID (예: '042', 'C-07')
 * @property {string} [userAnswer] 사용자가 적었던 답
 * @property {Array<{role: string, content: string}>} [history] 이어지는 대화(현재는 빈 배열)
 */

/**
 * @typedef {Object} TutorResult
 * @property {string} text 누적된 해설 전문
 * @property {object|null} usage 서버가 마지막 프레임에 실어 보낸 토큰 사용량
 * @property {boolean} aborted 사용자가 취소해 중간에 끝났는지
 */

/**
 * @typedef {Object} PlanResult
 * @property {object|null} plan 서버가 마지막 프레임에 실어 보낸 계획 (취소 시 null)
 * @property {object|null} usage
 * @property {import('../domain/studyPlan.js').PlanToolEvent[]} events 받은 도구 호출 진행 프레임
 * @property {boolean} aborted
 */

/**
 * @typedef {Object} GradeRequest
 * @property {import('../domain/aiSource.js').GradeKind} kind 코드 트레이싱인지 단답형인지
 * @property {AiSource} source
 * @property {string} id 문항 ID (예: '042', 'C-07')
 * @property {string} [userAnswer] 사용자가 적은 답
 */

/**
 * @typedef {Object} GradeResponse
 * @property {object|null} result 서버가 돌려준 채점 결과 원본 (취소 시 null)
 * @property {boolean} aborted 사용자가 취소해 중간에 끝났는지
 */

export const TUTOR_ENDPOINT = '/api/ai/tutor';
export const PLAN_ENDPOINT = '/api/ai/plan';
export const GRADE_ENDPOINT = '/api/ai/grade';

/**
 * `/api/ai/tutor` 를 호출해 해설을 스트리밍으로 받는다 (BLUEPRINT §4.1).
 *
 * 취소는 오류가 아니다 — `{ aborted: true }` 로 정상 종료한다.
 * 그 밖의 실패는 모두 `AiRequestError` 로 던진다.
 *
 * @param {TutorRequest} request
 * @param {{onDelta?: (delta: string) => void, signal?: AbortSignal}} [options]
 * @returns {Promise<TutorResult>}
 */
export async function streamTutor(request, options = {}) {
  const { onDelta, signal } = options;
  let text = '';

  let done, aborted;
  try {
    ({ done, aborted } = await postSseStream(
      TUTOR_ENDPOINT,
      {
        source: request.source,
        id: request.id,
        userAnswer: request.userAnswer ?? '',
        history: request.history ?? [],
      },
      {
        signal,
        getPartialText: () => text,
        onPayload: (payload) => {
          if (typeof payload.delta !== 'string' || payload.delta === '') return;
          text += payload.delta;
          onDelta?.(payload.delta);
        },
      }
    ));
  } catch (err) {
    logUsage(err?.cost, 'tutor');
    throw err;
  }

  logUsage(done?.cost, 'tutor');

  if (aborted) return { text, usage: null, aborted: true };
  return { text, usage: done?.usage ?? null, aborted: false };
}

/**
 * `/api/ai/plan` 을 호출해 학습 계획을 받는다 (BLUEPRINT §4.3).
 *
 * 에이전트가 도구를 호출할 때마다 `phase:"tool"` / `phase:"tool_result"` 프레임이
 * 오고, 마지막 `done` 프레임에 계획이 실린다. 생성이 60초까지 걸릴 수 있어
 * 진행 프레임을 그대로 흘려보내는 것이 "죽지 않은 화면"의 근거다.
 *
 * @param {import('../domain/studyPlan.js').PlanSnapshot} snapshot
 * @param {{onToolEvent?: (event: import('../domain/studyPlan.js').PlanToolEvent) => void,
 *          signal?: AbortSignal}} [options]
 * @returns {Promise<PlanResult>}
 */
export async function streamPlan(snapshot, options = {}) {
  const { onToolEvent, signal } = options;
  /** @type {import('../domain/studyPlan.js').PlanToolEvent[]} */
  const events = [];

  let done, aborted;
  try {
    ({ done, aborted } = await postSseStream(
      PLAN_ENDPOINT,
      { snapshot },
      {
        signal,
        onPayload: (payload) => {
          if (payload.phase !== 'tool' && payload.phase !== 'tool_result') return;
          events.push(payload);
          onToolEvent?.(payload);
        },
      }
    ));
  } catch (err) {
    logUsage(err?.cost, 'plan');
    throw err;
  }

  logUsage(done?.cost, 'plan');

  if (aborted) return { plan: null, usage: null, events, aborted: true };

  const plan = done?.plan;
  if (!plan || typeof plan !== 'object') {
    // 도구만 돌다 계획 없이 끝난 경우. 재시도가 답이므로 UPSTREAM 으로 접는다.
    throw new AiRequestError('UPSTREAM', '계획을 받지 못했습니다. 다시 시도해 주세요.');
  }
  return { plan, usage: done.usage ?? null, events, aborted: false };
}

/**
 * `/api/ai/grade` 를 호출해 답안 채점을 받는다 (BLUEPRINT §4.2).
 *
 * 해설·플래너와 달리 **스트리밍이 아니다** — 구조화 출력 JSON 한 번이다.
 * 그래도 접근 코드 헤더와 오류 코드 집합은 같은 계층(`aiTransport.js`)을 써서
 * 화면이 엔드포인트별로 다른 실패를 배우지 않아도 되게 한다.
 *
 * 결과의 형태 검증(§4.2 스키마)은 도메인(`domain/grading.js`)이 맡는다 —
 * 플래너에서 `streamPlan` → `normalizePlan` 로 나눈 것과 같은 경계다.
 *
 * @param {GradeRequest} request
 * @param {{signal?: AbortSignal}} [options]
 * @returns {Promise<GradeResponse>}
 */
export async function gradeAnswer(request, options = {}) {
  let data, aborted;
  try {
    ({ data, aborted } = await postAiJson(
      GRADE_ENDPOINT,
      {
        kind: request.kind,
        source: request.source,
        id: request.id,
        // undefined 를 보내면 JSON 에서 키가 통째로 사라져 서버가 400 을 낸다
        userAnswer: request.userAnswer ?? '',
      },
      { signal: options.signal }
    ));
  } catch (err) {
    logUsage(err?.cost, 'grade');
    throw err;
  }

  logUsage(data?.cost, 'grade');

  if (aborted) return { result: null, aborted: true };

  // 채점 결과로 볼 수 없는 응답은 재시도가 답이므로 UPSTREAM 으로 접는다.
  if (!data || typeof data !== 'object' || typeof data.verdict !== 'string') {
    throw new AiRequestError('UPSTREAM', '채점 결과를 받지 못했습니다. 다시 시도해 주세요.');
  }
  return { result: data, aborted: false };
}
