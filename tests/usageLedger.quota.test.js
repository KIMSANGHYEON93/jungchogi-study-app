// @vitest-environment jsdom
//
// 원장은 학습 데이터보다 우선순위가 낮다.
// localStorage 가 꽉 찼을 때 원장이 자리를 붙들고 있어서 오답노트·진도 저장이
// 실패하는 일이 있으면 안 된다. 이 파일이 그 우선순위를 코드로 고정한다.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { USAGE_LEDGER_KEY, recordUsage, getUsageEntries } from '../src/utils/usageLedger.js';
import { saveProgress, loadProgress, addWrongNote, getWrongNotes } from '../src/utils/storage.js';

const STORAGE_KEY = `jungchogi_${USAGE_LEDGER_KEY}`;

function cost(overrides = {}) {
  return {
    ts: new Date().toISOString(),
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
    ...overrides,
  };
}

/**
 * localStorage 에 총 글자수 한도를 씌운다. 실제 브라우저처럼 한도를 넘는
 * setItem 이 QuotaExceededError 로 터진다.
 */
function withQuota(maxChars) {
  const realSet = window.Storage.prototype.setItem;
  vi.spyOn(window.Storage.prototype, 'setItem').mockImplementation(function setItem(key, value) {
    let used = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k === key) continue;
      used += k.length + (localStorage.getItem(k) || '').length;
    }
    if (used + String(key).length + String(value).length > maxChars) {
      const err = new Error('quota exceeded');
      err.name = 'QuotaExceededError';
      throw err;
    }
    return realSet.call(this, key, value);
  });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('용량이 꽉 찼을 때 — 원장은 자리를 내준다', () => {
  it('원장이 다 못 들어가면 줄여서라도 담고, 그래도 안 되면 통째로 비운다', () => {
    // 먼저 넉넉한 한도에서 원장을 크게 키운다
    withQuota(1_000_000);
    for (let i = 0; i < 40; i++) recordUsage(cost({ latencyMs: i }), { endpoint: 'tutor' });
    const grown = localStorage.getItem(STORAGE_KEY).length;
    expect(getUsageEntries()).toHaveLength(40);
    vi.restoreAllMocks();

    // 이제 원장 절반 정도밖에 안 들어가는 한도로 조인다
    withQuota(STORAGE_KEY.length + Math.floor(grown / 2));

    expect(recordUsage(cost({ latencyMs: 999 }), { endpoint: 'tutor' })).toBe(true);
    const entries = getUsageEntries();
    expect(entries.length).toBeLessThan(41);
    expect(entries.length).toBeGreaterThan(0);
    // 새 기록은 살아남고 가장 오래된 것부터 버려졌다
    expect(entries[entries.length - 1].latencyMs).toBe(999);
  });

  it('한 건도 못 들어갈 만큼 꽉 차면 원장 키 자체를 지운다 — 자리를 붙들지 않는다', () => {
    withQuota(1_000_000);
    for (let i = 0; i < 20; i++) recordUsage(cost({ latencyMs: i }), { endpoint: 'tutor' });
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    vi.restoreAllMocks();

    // 원장 키 이름조차 못 담는 한도
    withQuota(10);

    expect(recordUsage(cost(), { endpoint: 'tutor' })).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('원장을 비운 자리에 학습 데이터가 들어간다', () => {
    // 학습 데이터가 딱 들어갈 만큼의 자리를 원장이 차지하게 만든다
    const note = { source: 'quiz100', id: '042', question: '질문', answer: '정답' };
    addWrongNote(note);
    const notesBytes = localStorage.getItem('jungchogi_wrong_notes').length + 'jungchogi_wrong_notes'.length;
    localStorage.clear();

    withQuota(1_000_000);
    for (let i = 0; i < 30; i++) recordUsage(cost({ latencyMs: i }), { endpoint: 'tutor' });
    const ledgerBytes = localStorage.getItem(STORAGE_KEY).length + STORAGE_KEY.length;
    vi.restoreAllMocks();

    // 원장 + 오답노트를 동시에 담을 수는 없고, 원장을 비우면 오답노트가 들어가는 한도
    withQuota(ledgerBytes + Math.floor(notesBytes / 2));

    // 원장에 한 건 더 쓰려다 자리가 없으면 스스로 물러난다
    recordUsage(cost(), { endpoint: 'tutor' });

    // 그 자리에 학습 데이터가 들어간다
    addWrongNote(note);
    expect(getWrongNotes()).toHaveLength(1);
    expect(getWrongNotes()[0]).toMatchObject({ source: 'quiz100', id: '042' });
  });

  it('용량 초과로 원장을 못 써도 예외를 밖으로 내보내지 않는다', () => {
    withQuota(10);
    expect(() => recordUsage(cost(), { endpoint: 'tutor' })).not.toThrow();
    expect(recordUsage(cost(), { endpoint: 'tutor' })).toBe(false);
  });

  it('원장이 물러나도 다른 학습 키는 그대로 남는다', () => {
    saveProgress('day_checks', { 1: true, 2: true });
    withQuota(1_000_000);
    for (let i = 0; i < 20; i++) recordUsage(cost({ latencyMs: i }), { endpoint: 'tutor' });
    vi.restoreAllMocks();

    withQuota(10);
    recordUsage(cost(), { endpoint: 'tutor' });

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(loadProgress('day_checks')).toEqual({ 1: true, 2: true });
  });
});
