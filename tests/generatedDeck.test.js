import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  fetchGeneratedItems,
  applyGeneratedItems,
  clearGeneratedCache,
} from '../src/utils/generatedDeck.js';

const QUIZ_BASE = [
  { id: '001', question: 'q1', answer: 'a1', category: '데이터베이스' },
  { id: '002', question: 'q2', answer: 'a2', category: '데이터베이스' },
];

function variant(overrides = {}) {
  return {
    id: '001-v1',
    question: '변형 질문',
    answer: '변형 정답',
    category: '데이터베이스',
    variantOf: '001',
    generated: true,
    ...overrides,
  };
}

function file(overrides = {}) {
  return {
    version: 1,
    source: 'quiz100',
    generatedAt: '2026-09-03T12:00:00.000Z',
    model: 'claude-opus-5',
    reviewed: true,
    items: [variant()],
    ...overrides,
  };
}

/** 응답 본문을 문자열 그대로 준다 — 손상 JSON 도 그대로 흉내낼 수 있다 */
function textResponse(body, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  });
}

let warn;

beforeEach(() => {
  clearGeneratedCache();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchGeneratedItems', () => {
  it('검수 완료 파일의 문항을 돌려준다', async () => {
    vi.stubGlobal('fetch', vi.fn(() => textResponse(JSON.stringify(file()))));
    const items = await fetchGeneratedItems('quiz100');
    expect(items.map((i) => i.id)).toEqual(['001-v1']);
    expect(fetch).toHaveBeenCalledWith('/data/generated/quiz100.json');
  });

  // 아직 아무것도 생성하지 않은 상태가 정상이다 — 오류로 다루면 콘솔이 경고로 뒤덮인다
  it('파일이 없으면(404) 빈 목록을 주고 경고하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(() => textResponse('Not Found', 404)));
    expect(await fetchGeneratedItems('quiz100')).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('404 가 아닌 실패 응답은 경고를 남긴다', async () => {
    vi.stubGlobal('fetch', vi.fn(() => textResponse('boom', 500)));
    expect(await fetchGeneratedItems('quiz100')).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('JSON 이 손상돼 있으면 빈 목록을 주고 경고한다', async () => {
    vi.stubGlobal('fetch', vi.fn(() => textResponse('{"version": 1, "items": [')));
    expect(await fetchGeneratedItems('quiz100')).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('네트워크 자체가 실패해도 앱을 죽이지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))));
    expect(await fetchGeneratedItems('quiz100')).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  // ★ 검수 전 생성물은 어떤 경로로도 학습에 들어가지 않는다
  it('reviewed 가 false 면 문항을 내주지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(() => textResponse(JSON.stringify(file({ reviewed: false })))));
    expect(await fetchGeneratedItems('quiz100')).toEqual([]);
    expect(warn.mock.calls.flat().join(' ')).toContain('reviewed');
  });

  it('모르는 version 이면 문항을 내주지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(() => textResponse(JSON.stringify(file({ version: 99 })))));
    expect(await fetchGeneratedItems('quiz100')).toEqual([]);
  });

  it('교재 3종 밖의 source 는 요청하지 않는다', async () => {
    const fetchMock = vi.fn(() => textResponse(JSON.stringify(file())));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchGeneratedItems('../secrets')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('한 번 읽은 결과는 다시 가져오지 않는다', async () => {
    const fetchMock = vi.fn(() => textResponse(JSON.stringify(file())));
    vi.stubGlobal('fetch', fetchMock);
    await fetchGeneratedItems('quiz100');
    await fetchGeneratedItems('quiz100');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('파일이 없다는 사실도 캐시한다', async () => {
    const fetchMock = vi.fn(() => textResponse('Not Found', 404));
    vi.stubGlobal('fetch', fetchMock);
    await fetchGeneratedItems('quiz100');
    await fetchGeneratedItems('quiz100');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('applyGeneratedItems', () => {
  it('포함이 켜져 있으면 원본 뒤에 변형을 붙여 준다', async () => {
    vi.stubGlobal('fetch', vi.fn(() => textResponse(JSON.stringify(file()))));
    const { items } = await applyGeneratedItems(QUIZ_BASE, 'quiz100', true);
    expect(items.map((i) => i.id)).toEqual(['001', '002', '001-v1']);
  });

  it('포함이 꺼져 있으면 원본을 그대로(같은 배열로) 준다', async () => {
    vi.stubGlobal('fetch', vi.fn(() => textResponse(JSON.stringify(file()))));
    const { items } = await applyGeneratedItems(QUIZ_BASE, 'quiz100', false);
    expect(items).toBe(QUIZ_BASE);
  });

  // 꺼져 있어도 몇 개가 있는지는 알아야 한다 —
  // 그래야 쓸 수 있는 변형이 없을 때 켜기 버튼 자체를 안 띄운다
  it('꺼져 있어도 쓸 수 있는 변형이 몇 개인지 알려준다', async () => {
    vi.stubGlobal('fetch', vi.fn(() => textResponse(JSON.stringify(file()))));
    const { available } = await applyGeneratedItems(QUIZ_BASE, 'quiz100', false);
    expect(available).toBe(1);
  });

  it('생성물이 없으면 available 은 0 이다', async () => {
    vi.stubGlobal('fetch', vi.fn(() => textResponse('Not Found', 404)));
    const { items, available } = await applyGeneratedItems(QUIZ_BASE, 'quiz100', true);
    expect(items).toEqual(QUIZ_BASE);
    expect(available).toBe(0);
  });

  // ★ 검수 전 파일은 "쓸 수 있는 변형 0개"다 — 켜기 버튼조차 뜨지 않는다
  it('reviewed 가 false 면 available 도 0 이다', async () => {
    vi.stubGlobal('fetch', vi.fn(() => textResponse(JSON.stringify(file({ reviewed: false })))));
    const { items, available } = await applyGeneratedItems(QUIZ_BASE, 'quiz100', true);
    expect(items).toEqual(QUIZ_BASE);
    expect(available).toBe(0);
  });

  it('계약을 어긴 문항은 빼고 경고한다', async () => {
    const broken = variant({ id: '002-v1', variantOf: '002', answer: '' });
    vi.stubGlobal('fetch', vi.fn(() => textResponse(JSON.stringify(file({ items: [variant(), broken] })))));
    const { items, available } = await applyGeneratedItems(QUIZ_BASE, 'quiz100', true);
    expect(items.map((i) => i.id)).toEqual(['001', '002', '001-v1']);
    // 계약을 어긴 항목은 셈에서도 빠진다
    expect(available).toBe(1);
    expect(warn.mock.calls.flat().join(' ')).toContain('002-v1');
  });
});
