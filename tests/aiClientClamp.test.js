// @vitest-environment jsdom
// aiClient 가 사용 원장(utils/usageLedger → utils/storage)을 쓰므로 localStorage 가 필요하다.
//
// 긴 답안의 클라이언트 클램프 (BLUEPRINT §7-2 잔여).
//
// 서버 `lib/ai/guard.js` 는 userAnswer 가 2,000자를 넘으면 400 BAD_REQUEST 로 끊는다.
// 클라이언트가 자르지 않고 그대로 보내면 사용자는 "요청 내용이 올바르지 않습니다"만
// 보고 왜 안 되는지 모른다. 그래서 보내기 전에 서버 상한에 맞춰 자르되,
// **잘랐다는 사실을 호출부에 반드시 알린다** — 뒷부분이 채점에서 빠졌는데 모르면
// 채점 결과를 오해한다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  clampUserAnswer,
  MAX_USER_ANSWER_LENGTH,
  gradeAnswer,
  streamTutor,
  GRADE_ENDPOINT,
} from '../src/services/aiClient.js';
import {
  MAX_USER_ANSWER_LENGTH as SERVER_MAX_USER_ANSWER_LENGTH,
  validateGradeBody,
  validateTutorBody,
} from '../lib/ai/guard.js';

const encoder = new TextEncoder();

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sseResponse(chunks) {
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

// 실제 fetch 처럼 signal 이 끊기면 본문 스트림을 AbortError 로 터뜨린다.
function hangingResponse(firstChunk, signal) {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(firstChunk));
      signal.addEventListener('abort', () => {
        controller.error(new DOMException('The operation was aborted.', 'AbortError'));
      });
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const OK_GRADE = { verdict: 'partial', score: 60, feedback: '두 번째 값이 다릅니다.' };

let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 보낸 요청의 JSON body */
const sentBody = () => JSON.parse(fetchMock.mock.calls[0][1].body);

describe('상한값은 서버와 한 곳에서 관리된다', () => {
  // 브라우저 번들은 `lib/ai/guard.js` 를 import 할 수 없다(node:crypto 를 쓰는 서버
  // 파일이다). 그래서 상한은 의존성 없는 `lib/ai/limits.js` 하나에 두고 양쪽이 그것을
  // import 한다 — 값이 갈릴 수가 없다.
  it('클라이언트 상한이 서버 lib/ai/guard.js 의 상한과 같다', () => {
    expect(MAX_USER_ANSWER_LENGTH).toBe(SERVER_MAX_USER_ANSWER_LENGTH);
  });

  // 위 보장은 `lib/ai/limits.js` 가 **의존성이 없다**는 전제 위에 서 있다.
  // 거기에 `node:` 모듈이나 다른 파일을 import 하는 순간 브라우저 번들이 깨진다.
  // 빌드가 깨지고 나서 알기보다 여기서 먼저 알아채는 편이 낫다.
  it('lib/ai/limits.js 는 아무것도 import 하지 않는다 — 브라우저가 쓸 수 있는 조건', async () => {
    // jsdom 환경에서는 `import.meta.url` 이 file: URL 이 아니다. vitest 는 프로젝트
    // 루트에서 돌므로 cwd 기준 상대 경로로 읽는다.
    const { readFile } = await import('node:fs/promises');
    const source = await readFile('lib/ai/limits.js', 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\s*\(/);
  });
});

describe('clampUserAnswer', () => {
  it('상한 이하면 그대로 두고 잘랐다고 말하지 않는다', () => {
    const answer = '가'.repeat(MAX_USER_ANSWER_LENGTH);

    expect(clampUserAnswer(answer)).toEqual({
      value: answer,
      truncated: false,
      originalLength: MAX_USER_ANSWER_LENGTH,
    });
  });

  it('빈 답과 undefined 는 빈 문자열이 된다 — 서버가 키 없는 body 를 400 으로 접는다', () => {
    expect(clampUserAnswer(undefined)).toEqual({ value: '', truncated: false, originalLength: 0 });
    expect(clampUserAnswer('')).toEqual({ value: '', truncated: false, originalLength: 0 });
  });

  it('상한을 넘으면 상한까지 자르고 원래 길이를 남긴다', () => {
    const answer = '나'.repeat(MAX_USER_ANSWER_LENGTH + 500);

    const clamped = clampUserAnswer(answer);

    expect(clamped.truncated).toBe(true);
    expect(clamped.originalLength).toBe(MAX_USER_ANSWER_LENGTH + 500);
    expect(clamped.value).toHaveLength(MAX_USER_ANSWER_LENGTH);
    expect(clamped.value).toBe(answer.slice(0, MAX_USER_ANSWER_LENGTH));
  });

  it('자르는 자리가 서로게이트 페어 한가운데면 반쪽을 남기지 않는다', () => {
    // 이모지 하나가 UTF-16 두 칸이다. 앞을 홀수 칸으로 채우면 상한이 페어를 가른다.
    const emoji = '🙂'; // U+1F642 = 🙂
    const answer = '다'.repeat(MAX_USER_ANSWER_LENGTH - 1) + emoji + '라';

    const clamped = clampUserAnswer(answer);

    expect(clamped.truncated).toBe(true);
    expect(clamped.value).toHaveLength(MAX_USER_ANSWER_LENGTH - 1);
    // 짝 잃은 상위 서로게이트가 남으면 JSON 으로 \ud83d 가 그대로 나가 프롬프트가 깨진다
    const last = clamped.value.charCodeAt(clamped.value.length - 1);
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    expect([...clamped.value].every((ch) => ch === '다')).toBe(true);
  });
});

describe('gradeAnswer — 긴 답안', () => {
  it('상한을 넘는 답을 잘라서 보낸다', async () => {
    fetchMock.mockResolvedValue(jsonResponse(OK_GRADE));

    await gradeAnswer({ kind: 'short', source: 'quiz100', id: '042', userAnswer: '마'.repeat(5_000) });

    expect(fetchMock.mock.calls[0][0]).toBe(GRADE_ENDPOINT);
    expect(sentBody().userAnswer).toHaveLength(MAX_USER_ANSWER_LENGTH);
  });

  it('잘라 보낸 답은 서버 검증을 통과한다 — 이 클램프의 존재 이유', () => {
    const { value } = clampUserAnswer('바'.repeat(5_000));

    const checked = validateGradeBody({ kind: 'short', source: 'quiz100', id: '042', userAnswer: value });

    expect(checked.ok).toBe(true);
  });

  it('잘렸다는 사실을 결과에 실어 준다 — 채점이 뒷부분을 못 봤음을 화면이 알아야 한다', async () => {
    fetchMock.mockResolvedValue(jsonResponse(OK_GRADE));

    const result = await gradeAnswer({
      kind: 'short',
      source: 'quiz100',
      id: '042',
      userAnswer: '사'.repeat(2_500),
    });

    expect(result.truncated).toBe(true);
    expect(result.originalLength).toBe(2_500);
    expect(result.sentLength).toBe(MAX_USER_ANSWER_LENGTH);
    expect(result.result).toEqual(OK_GRADE);
  });

  it('상한 이하면 잘랐다고 말하지 않는다', async () => {
    fetchMock.mockResolvedValue(jsonResponse(OK_GRADE));

    const result = await gradeAnswer({ kind: 'short', source: 'quiz100', id: '042', userAnswer: '아메바' });

    expect(result.truncated).toBe(false);
    expect(sentBody().userAnswer).toBe('아메바');
  });
});

describe('streamTutor — 긴 답안', () => {
  it('상한을 넘는 답을 잘라서 보내고 잘렸다고 알린다', async () => {
    fetchMock.mockResolvedValue(sseResponse(['data: {"done":true}\n\n']));

    const result = await streamTutor({ source: 'quiz100', id: '042', userAnswer: '자'.repeat(3_000) });

    expect(sentBody().userAnswer).toHaveLength(MAX_USER_ANSWER_LENGTH);
    expect(result.truncated).toBe(true);
    expect(result.originalLength).toBe(3_000);
    expect(validateTutorBody(sentBody()).ok).toBe(true);
  });

  it('상한 이하면 잘랐다고 말하지 않는다', async () => {
    fetchMock.mockResolvedValue(sseResponse(['data: {"done":true}\n\n']));

    const result = await streamTutor({ source: 'quiz100', id: '042', userAnswer: '차수' });

    expect(result.truncated).toBe(false);
    expect(sentBody().userAnswer).toBe('차수');
  });

  // 취소 경로에서 채점(gradeAnswer)과 갈리는 지점이다. 해설은 취소해도 **받아 둔
  // 부분 해설이 화면에 남는다** — 그 해설은 잘린 답을 보고 쓴 것이라 안내가 여전히
  // 유효하다. 반면 채점은 취소하면 보여줄 결과 자체가 없어(`result: null`) 신호를
  // 붙이지 않는다 — 그 계약은 tests/gradeClient.test.js 가 지킨다.
  it('취소해도 남은 부분 해설이 잘린 답에서 나왔음을 알린다', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation((_url, init) =>
      Promise.resolve(hangingResponse('data: {"delta":"우선 "}\n\n', init.signal))
    );

    const promise = streamTutor(
      { source: 'quiz100', id: '042', userAnswer: '카'.repeat(4_000) },
      { signal: controller.signal }
    );
    await Promise.resolve();
    controller.abort();

    const result = await promise;

    expect(result.aborted).toBe(true);
    expect(result.text).toBe('우선 ');
    expect(result.truncated).toBe(true);
    expect(result.originalLength).toBe(4_000);
    expect(result.sentLength).toBe(MAX_USER_ANSWER_LENGTH);
  });
});
