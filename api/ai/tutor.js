// POST /api/ai/tutor — 오답 해설 (SSE 스트리밍)
//
// 계약 (프론트엔드와 공유하는 고정 스펙):
//   요청  : { source: "quiz100"|"codedrill"|"bogang", id, userAnswer, history: [] }
//           `AI_ACCESS_CODE` 가 설정된 경우에만 `x-access-code` 헤더 필요
//   성공  : 200 text/event-stream
//             data: {"delta":"..."}\n\n            ← 0회 이상
//             data: {"done":true,"usage":{...},"cost":{...}}\n\n ← 마지막 1회
//           `cost` 는 Phase 5 에서 **더한** 필드다 (기존 필드는 그대로).
//           모양은 `lib/ai/usage.js` 의 toCostPayload — 사용 기록 12필드 + 가격 근거.
//   실패  : JSON { "error": { "code", "message" } }
//             401 UNAUTHORIZED / 429 RATE_LIMITED / 400 BAD_REQUEST / 502 UPSTREAM
//           스트림이 시작된 뒤의 오류는 SSE 프레임으로:
//             data: {"error":{"code":"UPSTREAM","message":"..."}}\n\n
//
// Vercel Functions 는 이름이 HTTP 메서드인 export(웹 핸들러)를 보면
// Node 런타임을 **스트리밍 모드**로 돌린다 (`packages/node` 의 `hasWebHandlers`).
// 그래서 `export default (req, res)` 대신 `export function POST(request)` 로 쓰고
// 본문이 `ReadableStream` 인 `Response` 를 돌려주면 그대로 흘러나간다.
// 함수 실행 시간·`public/data` 번들 포함은 `vercel.json` 의 `functions` 항목 참조.

import {
  streamTutorMessage,
  classifyUpstreamError,
  hasApiKey,
  MODEL,
  TUTOR_EFFORT,
} from '../../lib/ai/client.js';
import {
  jsonError,
  getClientIp,
  checkAccessCode,
  checkRateLimit,
  validateTutorBody,
} from '../../lib/ai/guard.js';
import {
  loadProblem,
  findRelatedSections,
  buildSearchQuery,
  readDataFile,
  CACHE_PREFIX_FILE,
} from '../../lib/ai/content.js';
import { buildUsageRecord, logUsage, toCostPayload } from '../../lib/ai/usage.js';

/**
 * 시스템 프롬프트. **모든 요청에서 바이트 단위로 같아야 한다** —
 * 캐싱은 프리픽스 매치라 한 바이트만 달라져도 캐시가 무효화된다.
 * 날짜·UUID·비결정적 JSON 키 순서를 넣지 말 것.
 */
const SYSTEM_PROMPT = `당신은 한국 정보처리기사 실기 시험을 준비하는 학습자의 튜터입니다.
학습자가 방금 틀린 문항 하나에 대해, 왜 틀렸는지와 무엇을 외워야 하는지를 설명합니다.

원칙:
- 아래 제공된 교재 내용에 근거해서만 설명합니다. 교재에 근거가 없으면 "교재에서 확인되지 않는다"고 말하고 추측하지 않습니다.
- 학습자의 답안을 먼저 읽고, 맞은 부분과 틀린 부분을 구분해 짚습니다.
- 정답을 다시 나열하는 데 그치지 말고, 학습자의 오해가 어디서 비롯됐는지 짚습니다.

출력 형식(마크다운, 이 순서와 제목을 그대로):
## 채점
한 문장으로 정답/부분정답/오답 판정과 근거.
## 왜 틀렸나
학습자 답안의 어긋난 지점을 2~4문장으로.
## 핵심 정리
외워야 할 내용을 3개 이하의 불릿으로.
## 함께 볼 것
헷갈리기 쉬운 인접 개념 1~2개를 한 줄씩.

전체 500자 내외로 짧게 씁니다. 인사말·맺음말은 쓰지 않습니다.`;

/** 관련 교재 섹션을 몇 개까지 동봉할지 */
const RELATED_SECTION_LIMIT = 3;

/**
 * 캐시 대상 시스템 블록.
 *
 * 고정 프리픽스에 교재 총론을 붙이는 이유: 시스템 프롬프트만으로는 분량이
 * 최소 캐시 가능 프리픽스에 못 미쳐 `cache_read_input_tokens` 가 늘 0 이 된다.
 * 총론은 모든 문항에 공통으로 쓸 수 있는 배경이라 프리픽스로 두기에 맞다.
 * 모듈 수명 동안 한 번만 만들어 두 번째 요청부터 같은 객체를 재사용한다.
 */
let cachedSystemBlocks = null;

function buildSystemBlocks() {
  if (cachedSystemBlocks) return cachedSystemBlocks;

  const blocks = [{ type: 'text', text: SYSTEM_PROMPT }];
  const overview = readDataFile(CACHE_PREFIX_FILE);
  if (overview) {
    blocks.push({ type: 'text', text: `# 교재 총론\n\n${overview}` });
  }
  // 마지막 고정 블록에 캐시 breakpoint. 가변 내용은 이 뒤(messages)에만 둔다.
  blocks.at(-1).cache_control = { type: 'ephemeral', ttl: '1h' };

  cachedSystemBlocks = blocks;
  return blocks;
}

/** 테스트용 — 시스템 블록 캐시를 비운다. */
export function resetSystemBlocks() {
  cachedSystemBlocks = null;
}

/**
 * 문항·정답·관련 섹션·학습자 답안을 하나의 사용자 메시지로 엮는다.
 * @param {import('../../lib/ai/content.js').TutorProblem} problem
 * @param {Array<{file: string, heading: string, excerpt: string}>} sections
 * @param {string} userAnswer
 * @returns {string}
 */
function buildProblemPrompt(problem, sections, userAnswer) {
  const parts = [
    '# 문항',
    `출처: ${problem.source} / ${problem.id}${problem.category ? ` / ${problem.category}` : ''}`,
    problem.question,
  ];

  if (problem.context) parts.push('## 문항에 딸린 자료', '```', problem.context, '```');
  if (problem.code) {
    parts.push('## 문제 코드', '```' + (problem.lang || ''), problem.code, '```');
  }
  if (problem.expectedOutput) parts.push('## 기대 출력', '```', problem.expectedOutput, '```');

  parts.push('# 교재의 정답·풀이', problem.answer || '(교재에 정답이 적혀 있지 않다)');
  if (problem.pitfall) parts.push('# 교재가 짚은 함정', problem.pitfall);

  if (sections.length > 0) {
    parts.push('# 관련 교재 섹션');
    for (const section of sections) {
      parts.push(`## ${section.file} — ${section.heading}`, section.excerpt);
    }
  }

  parts.push(
    '# 학습자가 쓴 답안',
    userAnswer.trim() ? userAnswer : '(답안을 쓰지 않고 넘어갔다)',
    '',
    '위 답안을 채점하고 지정된 형식으로 해설하세요.'
  );

  return parts.join('\n\n');
}

/**
 * messages 배열을 만든다.
 * 마지막이 assistant 로 끝나면 그것은 prefill 이라 Opus 5 에서 400 이므로 잘라낸다.
 */
function buildMessages(problemPrompt, history) {
  const messages = [{ role: 'user', content: problemPrompt }, ...history];
  while (messages.length > 1 && messages.at(-1).role === 'assistant') messages.pop();
  return messages;
}

const encoder = new TextEncoder();
const sseFrame = (payload) => encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);

const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  // 프록시가 스트림을 모아 두었다가 한 번에 보내지 않게 한다
  'x-accel-buffering': 'no',
};

/**
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export async function POST(request) {
  // 1) 레이트리밋 — 항상, 그리고 접근 코드 검사보다 먼저.
  //    미인증 트래픽도 억제해야 남용 비용이 안 나간다.
  const limit = checkRateLimit(getClientIp(request.headers), Date.now());
  if (!limit.ok) {
    const response = jsonError(limit.code, limit.message, {
      retryAfterSeconds: limit.retryAfterSeconds,
    });
    response.headers.set('retry-after', String(limit.retryAfterSeconds));
    return response;
  }

  // 2) 접근 코드 — AI_ACCESS_CODE 가 설정된 경우에만 (블루프린트 §7-2)
  const access = checkAccessCode(request.headers, process.env);
  if (!access.ok) return jsonError(access.code, access.message);

  // 3) body 검증
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonError('BAD_REQUEST', '요청 body 를 JSON 으로 읽지 못했습니다.');
  }

  const validated = validateTutorBody(payload);
  if (!validated.ok) return jsonError(validated.code, validated.message);
  const { source, id, userAnswer, history } = validated.value;

  // 4) 문항 로드
  const problem = loadProblem(source, id);
  if (!problem) {
    return jsonError('BAD_REQUEST', `${source} 에 id ${id} 인 문항이 없습니다.`);
  }

  if (!hasApiKey()) {
    console.error('[ai/tutor] ANTHROPIC_API_KEY 가 설정되지 않았습니다.');
    return jsonError('UPSTREAM', 'AI 기능이 설정되지 않았습니다.', { retryable: false });
  }

  // 5) 프롬프트 구성 — 고정 프리픽스는 system, 가변 내용은 messages
  const sections = findRelatedSections(buildSearchQuery(problem), {
    limit: RELATED_SECTION_LIMIT,
  });
  const messages = buildMessages(buildProblemPrompt(problem, sections, userAnswer), history);

  // 6) 스트림을 열고 **첫 이벤트까지만** 먼저 받아 본다.
  //    여기서 실패하면 아직 아무것도 안 보냈으므로 계약대로 JSON 오류로 내려갈 수 있다.
  //    (헤더를 내보낸 뒤에는 상태코드를 되돌릴 수 없다)
  //
  //    이 시점부터 지연을 잰다 — 게이트·문항 로드가 아니라 **업스트림 호출**의 시간이다.
  const startedAt = Date.now();

  /**
   * 스트림이 흘리는 usage 를 누적한다.
   *
   * `message_start` 에 입력·캐시 토큰이, `message_delta` 에 누적 출력 토큰이 실려 온다.
   * 중간에 끊기면 출력만 모르는 상태가 되는데, 그 "모름" 을 0 으로 때우지 않으려면
   * 본 것과 못 본 것을 나눠 들고 있어야 한다.
   */
  let observed = null;
  const observeUsage = (event) => {
    const chunk =
      event?.type === 'message_start'
        ? event.message?.usage
        : event?.type === 'message_delta'
          ? event.usage
          : null;
    if (chunk && typeof chunk === 'object') observed = { ...(observed ?? {}), ...chunk };
  };

  /** 요청 하나에 사용 기록 한 줄. 성공·실패 어느 쪽으로 끝나도 정확히 한 번 부른다. */
  const record = ({ usage, ok, errorCode }) => {
    const built = buildUsageRecord({
      endpoint: 'tutor',
      model: MODEL,
      effort: TUTOR_EFFORT,
      usage,
      latencyMs: Date.now() - startedAt,
      ok,
      errorCode,
    });
    logUsage(built.record, built.cost);
    // 응답에는 기록 전체 + 가격 근거를 싣는다 — 프론트 원장이 계약된 이름으로 읽는다.
    return toCostPayload(built.record, built.cost);
  };

  let iterator;
  let firstEvent;
  let stream;
  try {
    stream = streamTutorMessage({ system: buildSystemBlocks(), messages });
    iterator = stream[Symbol.asyncIterator]();
    firstEvent = await iterator.next();
  } catch (error) {
    const failure = classifyUpstreamError(error);
    console.error('[ai/tutor] 스트림 시작 실패', failure.status, error);
    record({ usage: observed, ok: false, errorCode: failure.code });
    return jsonError(failure.code, failure.message, { retryable: failure.retryable });
  }

  // 7) 나머지는 SSE 로 흘린다. 이 뒤의 오류는 SSE 프레임으로만 알릴 수 있다.
  const body = new ReadableStream({
    async start(controller) {
      const emitText = (event) => {
        observeUsage(event);
        if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          controller.enqueue(sseFrame({ delta: event.delta.text }));
        }
      };

      try {
        if (!firstEvent.done) emitText(firstEvent.value);
        for (;;) {
          const next = await iterator.next();
          if (next.done) break;
          emitText(next.value);
        }
        const final = await stream.finalMessage();
        console.log(
          `[ai/tutor] ${source}/${id} usage=${JSON.stringify(final.usage ?? {})} stop=${final.stop_reason ?? ''}`
        );
        const cost = record({ usage: final.usage, ok: true, errorCode: null });
        // 기존 필드는 그대로 두고 cost 만 **더한다** (프론트가 이미 usage 를 읽는다).
        controller.enqueue(sseFrame({ done: true, usage: final.usage, cost }));
      } catch (error) {
        const failure = classifyUpstreamError(error);
        console.error('[ai/tutor] 스트림 도중 실패', failure.status, error);
        // 끊겼어도 그때까지 본 토큰은 기록한다 — 실패한 요청에도 돈이 나간다.
        record({ usage: observed, ok: false, errorCode: failure.code });
        controller.enqueue(
          sseFrame({
            error: { code: failure.code, message: failure.message, retryable: failure.retryable },
          })
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, { status: 200, headers: SSE_HEADERS });
}
