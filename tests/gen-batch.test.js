// Batch API 호출 계층 — 생성·폴링·결과 수거·재개 기록.
//
// SDK 는 모킹한다 (이 환경에는 API 키가 없다). 다만 오류 클래스는 실물을 써야
// `classifyUpstreamError` 의 instanceof 분류를 실제로 검증할 수 있다.

import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { createMock, retrieveMock, resultsMock, cancelMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  retrieveMock: vi.fn(),
  resultsMock: vi.fn(),
  cancelMock: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal();
  const Real = actual.default;
  class MockAnthropic {
    constructor() {
      this.messages = {
        batches: {
          create: createMock,
          retrieve: retrieveMock,
          results: resultsMock,
          cancel: cancelMock,
        },
      };
    }
  }
  Object.setPrototypeOf(MockAnthropic, Real); // static 오류 클래스 상속
  return { ...actual, default: MockAnthropic };
});

const Anthropic = (await import('@anthropic-ai/sdk')).default;
const { resetClient } = await import('../lib/ai/client.js');
const {
  POLL_INITIAL_MS,
  POLL_MAX_MS,
  POLL_FACTOR,
  nextPollDelay,
  createVariantBatch,
  waitForBatchEnd,
  streamBatchResults,
  cancelBatch,
  saveBatchRecord,
  loadBatchRecord,
} = await import('../lib/ai/batchRunner.js');

let recordDir;

beforeEach(() => {
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  resetClient();
  createMock.mockReset();
  retrieveMock.mockReset();
  resultsMock.mockReset();
  cancelMock.mockReset();
  recordDir = mkdtempSync(join(tmpdir(), 'jungchogi-batch-'));
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetClient();
  rmSync(recordDir, { recursive: true, force: true });
});

const batch = (status, counts = {}) => ({
  id: 'msgbatch_01',
  processing_status: status,
  request_counts: { processing: 0, succeeded: 0, errored: 0, canceled: 0, expired: 0, ...counts },
});

describe('createVariantBatch', () => {
  it('요청 배열을 그대로 batches.create 에 넘긴다', async () => {
    createMock.mockResolvedValue(batch('in_progress'));
    const requests = [{ custom_id: 'quiz100__001__v1', params: { model: 'claude-opus-5' } }];

    const created = await createVariantBatch(requests);

    expect(createMock).toHaveBeenCalledWith({ requests });
    expect(created.id).toBe('msgbatch_01');
  });

  it('업스트림 오류는 계약된 코드로 분류해 던진다', async () => {
    createMock.mockRejectedValue(
      new Anthropic.RateLimitError(429, { type: 'error' }, '한도', new Headers())
    );

    await expect(createVariantBatch([])).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});

describe('폴링 백오프', () => {
  it('간격이 지수적으로 늘어나되 상한을 넘지 않는다', () => {
    expect(nextPollDelay(0)).toBe(POLL_INITIAL_MS);
    expect(nextPollDelay(POLL_INITIAL_MS)).toBe(Math.round(POLL_INITIAL_MS * POLL_FACTOR));
    expect(nextPollDelay(POLL_MAX_MS)).toBe(POLL_MAX_MS);
    expect(nextPollDelay(POLL_MAX_MS * 10)).toBe(POLL_MAX_MS);
  });

  it('ended 가 될 때까지 폴링하고 간격을 늘린다', async () => {
    retrieveMock
      .mockResolvedValueOnce(batch('in_progress', { processing: 6 }))
      .mockResolvedValueOnce(batch('in_progress', { processing: 3 }))
      .mockResolvedValueOnce(batch('ended', { succeeded: 6 }));

    const slept = [];
    const ended = await waitForBatchEnd('msgbatch_01', { sleep: (ms) => slept.push(ms) });

    expect(ended.processing_status).toBe('ended');
    expect(retrieveMock).toHaveBeenCalledTimes(3);
    expect(slept).toEqual([POLL_INITIAL_MS, Math.round(POLL_INITIAL_MS * POLL_FACTOR)]);
  });

  it('이미 끝난 배치는 한 번만 조회하고 기다리지 않는다 (--resume 경로)', async () => {
    retrieveMock.mockResolvedValue(batch('ended', { succeeded: 6 }));

    const slept = [];
    await waitForBatchEnd('msgbatch_01', { sleep: (ms) => slept.push(ms) });

    expect(retrieveMock).toHaveBeenCalledTimes(1);
    expect(slept).toEqual([]);
  });

  it('canceling 도 아직 끝난 것이 아니므로 계속 기다린다', async () => {
    retrieveMock
      .mockResolvedValueOnce(batch('canceling'))
      .mockResolvedValueOnce(batch('ended', { canceled: 6 }));

    await waitForBatchEnd('msgbatch_01', { sleep: () => {} });
    expect(retrieveMock).toHaveBeenCalledTimes(2);
  });

  it('폴링마다 진행 상황을 알려준다', async () => {
    retrieveMock
      .mockResolvedValueOnce(batch('in_progress', { processing: 4 }))
      .mockResolvedValueOnce(batch('ended', { succeeded: 4 }));

    const seen = [];
    await waitForBatchEnd('msgbatch_01', { sleep: () => {}, onPoll: (b) => seen.push(b) });

    expect(seen).toHaveLength(2);
    expect(seen[0].request_counts.processing).toBe(4);
  });

  it('제한 시간을 넘기면 배치 id 를 담아 던진다 (재개할 수 있어야 한다)', async () => {
    retrieveMock.mockResolvedValue(batch('in_progress', { processing: 6 }));

    let clock = 0;
    await expect(
      waitForBatchEnd('msgbatch_01', {
        sleep: (ms) => {
          clock += ms;
        },
        now: () => clock,
        timeoutMs: 10_000,
      })
    ).rejects.toThrow(/msgbatch_01/);
  });
});

describe('streamBatchResults', () => {
  it('SDK 의 결과 스트림을 그대로 돌려준다', async () => {
    const rows = [{ custom_id: 'a' }, { custom_id: 'b' }];
    resultsMock.mockResolvedValue(
      (async function* () {
        yield* rows;
      })()
    );

    const seen = [];
    for await (const row of await streamBatchResults('msgbatch_01')) seen.push(row);

    expect(resultsMock).toHaveBeenCalledWith('msgbatch_01');
    expect(seen).toEqual(rows);
  });

  it('결과가 아직 없으면(404) 계약된 오류로 바꾼다', async () => {
    resultsMock.mockRejectedValue(
      new Anthropic.NotFoundError(404, { type: 'error' }, '없음', new Headers())
    );

    await expect(streamBatchResults('msgbatch_01')).rejects.toMatchObject({ code: 'UPSTREAM' });
  });
});

describe('cancelBatch', () => {
  it('배치를 취소한다', async () => {
    cancelMock.mockResolvedValue(batch('canceling'));
    const result = await cancelBatch('msgbatch_01');
    expect(cancelMock).toHaveBeenCalledWith('msgbatch_01');
    expect(result.processing_status).toBe('canceling');
  });
});

describe('재개 기록', () => {
  const record = {
    batchId: 'msgbatch_01',
    source: 'quiz100',
    ids: ['001', '002'],
    variantsPerItem: 2,
    out: 'public/data/generated/quiz100.json',
    createdAt: '2026-09-03T12:00:00.000Z',
  };

  it('배치를 만들자마자 남긴 기록을 batch id 로 다시 읽는다', () => {
    const path = saveBatchRecord(record, { dir: recordDir });
    expect(existsSync(path)).toBe(true);
    expect(loadBatchRecord('msgbatch_01', { dir: recordDir })).toEqual(record);
  });

  it('없는 기록은 null 이다 (--resume 에 남의 batch id 를 줬을 때)', () => {
    expect(loadBatchRecord('msgbatch_없음', { dir: recordDir })).toBeNull();
  });

  it('경로 구분자가 섞인 batch id 는 거부한다 (디렉터리 밖으로 못 쓴다)', () => {
    expect(() => saveBatchRecord({ ...record, batchId: '../탈출' }, { dir: recordDir })).toThrow();
    expect(() => loadBatchRecord('../탈출', { dir: recordDir })).toThrow();
  });
});
