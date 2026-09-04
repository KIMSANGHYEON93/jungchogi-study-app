// @vitest-environment jsdom
//
// AI 호출 경로에서 서버가 보낸 `cost` 를 원장에 남기는지 확인한다.
//
// 서버 계약: tutor·plan 은 SSE done 프레임에, grade 는 JSON 응답에 `cost` 를 싣는다.
// **이 필드는 아직 서버에 없을 수 있다** — 없어도 앱이 그대로 동작해야 한다.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { streamTutor, streamPlan, gradeAnswer, AiRequestError } from '../src/services/aiClient.js';
import { getUsageEntries, recordUsage } from '../src/utils/usageLedger.js';

// 대부분의 테스트는 진짜 원장을 쓴다. "기록이 던져도 학습 흐름이 안 막힌다"만
// 이 스파이를 통해 던지게 만든다.
vi.mock('../src/utils/usageLedger.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, recordUsage: vi.fn(actual.recordUsage) };
});

const encoder = new TextEncoder();

function sseResponse(chunks) {
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function frame(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

const COST = {
  ts: '2026-09-04T12:00:00.000Z',
  endpoint: 'tutor',
  model: 'claude-opus-5',
  effort: 'medium',
  inputTokens: 3120,
  outputTokens: 540,
  cacheReadTokens: 24800,
  cacheCreationTokens: 0,
  costUsd: 0.0123,
  latencyMs: 8421,
  ok: true,
  errorCode: null,
};

const TUTOR_REQUEST = { source: 'codedrill', id: 'C-07', userAnswer: '30 50' };
const GRADE_REQUEST = { kind: 'codetrace', source: 'codedrill', id: 'C-07', userAnswer: '30' };
const SNAPSHOT = { dayChecks: {}, quizResults: {}, wrongNotes: [] };
const PLAN = { date: '2026-09-04', blocks: [] };

let fetchMock;

beforeEach(() => {
  localStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(recordUsage).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('streamTutor — 원장 기록', () => {
  it('done 프레임의 cost 를 원장에 남긴다', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([frame({ delta: '해설' }), frame({ done: true, usage: { input_tokens: 3120 }, cost: COST })])
    );

    const result = await streamTutor(TUTOR_REQUEST);

    expect(result.text).toBe('해설');
    const entries = getUsageEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ endpoint: 'tutor', costUsd: 0.0123, ok: true });
  });

  it('cost 가 없으면 아무것도 남기지 않고 해설은 그대로 돌려준다', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([frame({ delta: '해설' }), frame({ done: true, usage: { input_tokens: 10 } })])
    );

    const result = await streamTutor(TUTOR_REQUEST);

    expect(result.text).toBe('해설');
    expect(result.usage).toEqual({ input_tokens: 10 });
    expect(getUsageEntries()).toEqual([]);
  });

  it('cost 가 null 이어도 해설은 그대로 돌려준다', async () => {
    fetchMock.mockResolvedValue(sseResponse([frame({ delta: 'A' }), frame({ done: true, cost: null })]));
    await expect(streamTutor(TUTOR_REQUEST)).resolves.toMatchObject({ text: 'A' });
    expect(getUsageEntries()).toEqual([]);
  });

  it('cost 에 일부 필드만 와도 남긴다', async () => {
    fetchMock.mockResolvedValue(sseResponse([frame({ done: true, cost: { costUsd: 0.004 } })]));

    await streamTutor(TUTOR_REQUEST);

    const entries = getUsageEntries();
    expect(entries).toHaveLength(1);
    // 서버가 endpoint 를 안 보내면 호출부가 아는 값으로 채운다
    expect(entries[0]).toMatchObject({ endpoint: 'tutor', costUsd: 0.004, inputTokens: 0 });
  });

  it('숫자 자리에 문자열이 와도 숫자로 읽어 남긴다', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([frame({ done: true, cost: { ...COST, inputTokens: '3120', costUsd: '0.5' } })])
    );

    await streamTutor(TUTOR_REQUEST);

    expect(getUsageEntries()[0]).toMatchObject({ inputTokens: 3120, costUsd: 0.5 });
  });

  it('모르는 미래 필드가 붙어도 남기고 그 필드는 담지 않는다', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([frame({ done: true, cost: { ...COST, serviceTier: 'priority', webSearches: 3 } })])
    );

    await streamTutor(TUTOR_REQUEST);

    const entry = getUsageEntries()[0];
    expect(entry.costUsd).toBe(0.0123);
    expect(entry).not.toHaveProperty('serviceTier');
  });

  it('cost 가 객체가 아니면 남기지 않는다', async () => {
    fetchMock.mockResolvedValue(sseResponse([frame({ done: true, cost: 'expensive' })]));
    await streamTutor(TUTOR_REQUEST);
    expect(getUsageEntries()).toEqual([]);
  });

  it('취소하면 남길 cost 가 없다', async () => {
    const controller = new AbortController();
    controller.abort();
    fetchMock.mockResolvedValue(sseResponse([frame({ done: true, cost: COST })]));

    const result = await streamTutor(TUTOR_REQUEST, { signal: controller.signal });

    expect(result.aborted).toBe(true);
    expect(getUsageEntries()).toEqual([]);
  });
});

describe('streamTutor — 실패한 호출', () => {
  it('error 프레임에 실린 cost 를 남기고 오류는 그대로 던진다', async () => {
    const failed = { ...COST, ok: false, errorCode: 'UPSTREAM', outputTokens: 0, costUsd: 0.002 };
    fetchMock.mockResolvedValue(
      sseResponse([frame({ error: { code: 'UPSTREAM', message: '모델 오류' }, cost: failed })])
    );

    await expect(streamTutor(TUTOR_REQUEST)).rejects.toThrow(AiRequestError);

    const entries = getUsageEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ ok: false, errorCode: 'UPSTREAM', costUsd: 0.002 });
  });

  it('오류 응답 본문의 cost 도 남긴다', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { code: 'RATE_LIMITED', message: '너무 잦음' }, cost: { ...COST, ok: false, errorCode: 'RATE_LIMITED', costUsd: 0 } },
        429
      )
    );

    await expect(streamTutor(TUTOR_REQUEST)).rejects.toMatchObject({ code: 'RATE_LIMITED' });

    expect(getUsageEntries()[0]).toMatchObject({ ok: false, errorCode: 'RATE_LIMITED' });
  });

  it('cost 없는 오류는 원장에 남지 않는다 — 지어내지 않는다', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'BAD_REQUEST', message: '잘못됨' } }, 400));

    await expect(streamTutor(TUTOR_REQUEST)).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(getUsageEntries()).toEqual([]);
  });

  it('네트워크가 끊기면 남길 것이 없고 오류만 난다', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(streamTutor(TUTOR_REQUEST)).rejects.toMatchObject({ code: 'NETWORK' });
    expect(getUsageEntries()).toEqual([]);
  });
});

describe('streamPlan — 원장 기록', () => {
  it('done 프레임의 cost 를 plan 으로 남긴다', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        frame({ phase: 'tool', name: 'get_due_reviews' }),
        frame({ done: true, plan: PLAN, cost: { ...COST, endpoint: 'plan', costUsd: 0.08 } }),
      ])
    );

    const result = await streamPlan(SNAPSHOT);

    expect(result.plan).toEqual(PLAN);
    expect(getUsageEntries()[0]).toMatchObject({ endpoint: 'plan', costUsd: 0.08 });
  });

  it('cost 가 없어도 계획은 그대로 온다', async () => {
    fetchMock.mockResolvedValue(sseResponse([frame({ done: true, plan: PLAN })]));

    const result = await streamPlan(SNAPSHOT);

    expect(result.plan).toEqual(PLAN);
    expect(getUsageEntries()).toEqual([]);
  });

  it('계획 없이 끝나도 cost 가 있으면 남긴다 — 토큰은 이미 썼다', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([frame({ done: true, cost: { ...COST, endpoint: 'plan', costUsd: 0.05 } })])
    );

    await expect(streamPlan(SNAPSHOT)).rejects.toMatchObject({ code: 'UPSTREAM' });

    expect(getUsageEntries()[0]).toMatchObject({ endpoint: 'plan', costUsd: 0.05 });
  });
});

describe('gradeAnswer — 원장 기록', () => {
  it('JSON 응답의 cost 를 grade 로 남긴다', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ verdict: 'correct', cost: { ...COST, endpoint: 'grade', costUsd: 0.009 } })
    );

    const { result } = await gradeAnswer(GRADE_REQUEST);

    expect(result.verdict).toBe('correct');
    expect(getUsageEntries()[0]).toMatchObject({ endpoint: 'grade', costUsd: 0.009 });
  });

  it('cost 가 없어도 채점 결과는 그대로 온다', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ verdict: 'incorrect', score: 20 }));

    const { result } = await gradeAnswer(GRADE_REQUEST);

    expect(result.verdict).toBe('incorrect');
    expect(getUsageEntries()).toEqual([]);
  });

  it('채점 결과로 볼 수 없는 응답이어도 cost 는 남긴다', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ cost: { ...COST, endpoint: 'grade', ok: false } }));

    await expect(gradeAnswer(GRADE_REQUEST)).rejects.toMatchObject({ code: 'UPSTREAM' });

    expect(getUsageEntries()[0]).toMatchObject({ endpoint: 'grade', ok: false });
  });

  it('취소하면 남길 것이 없다', async () => {
    const controller = new AbortController();
    controller.abort();
    fetchMock.mockResolvedValue(jsonResponse({ verdict: 'correct', cost: COST }));

    const { aborted } = await gradeAnswer(GRADE_REQUEST, { signal: controller.signal });

    expect(aborted).toBe(true);
    expect(getUsageEntries()).toEqual([]);
  });
});

describe('원장 기록 실패는 학습 흐름을 막지 않는다', () => {
  it('recordUsage 가 던져도 해설은 끝까지 온다', async () => {
    vi.mocked(recordUsage).mockImplementationOnce(() => {
      throw new Error('원장 폭발');
    });
    fetchMock.mockResolvedValue(
      sseResponse([frame({ delta: '해설 본문' }), frame({ done: true, cost: COST })])
    );

    const result = await streamTutor(TUTOR_REQUEST);

    expect(result.text).toBe('해설 본문');
    expect(result.aborted).toBe(false);
  });

  it('recordUsage 가 던져도 채점 결과는 돌아온다', async () => {
    vi.mocked(recordUsage).mockImplementationOnce(() => {
      throw new Error('원장 폭발');
    });
    fetchMock.mockResolvedValue(jsonResponse({ verdict: 'correct', cost: COST }));

    const { result } = await gradeAnswer(GRADE_REQUEST);

    expect(result.verdict).toBe('correct');
  });

  it('recordUsage 가 던져도 계획은 돌아온다', async () => {
    vi.mocked(recordUsage).mockImplementationOnce(() => {
      throw new Error('원장 폭발');
    });
    fetchMock.mockResolvedValue(sseResponse([frame({ done: true, plan: PLAN, cost: COST })]));

    const result = await streamPlan(SNAPSHOT);

    expect(result.plan).toEqual(PLAN);
  });

  it('실패한 호출을 기록하다 던져도 원래 오류가 그대로 올라간다', async () => {
    vi.mocked(recordUsage).mockImplementationOnce(() => {
      throw new Error('원장 폭발');
    });
    fetchMock.mockResolvedValue(
      sseResponse([frame({ error: { code: 'UPSTREAM', message: '모델 오류' }, cost: { ...COST, ok: false } })])
    );

    await expect(streamTutor(TUTOR_REQUEST)).rejects.toMatchObject({ code: 'UPSTREAM' });
  });
});
