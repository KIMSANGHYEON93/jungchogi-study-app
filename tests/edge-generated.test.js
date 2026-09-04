// 생성물(Phase 4) 경우의 수 하드닝.
//
// `tests/generatedItems.test.js` · `tests/generatedDeck.test.js` · `tests/gen-contract.test.js`
// 가 계약 위반 대부분을 이미 잡는다. 여기서는 그 밖의 축을 훑는다:
//   · 계약을 어긴 파일 중 **아직 검사하지 않던 형태** (items 가 빈 배열)
//   · 원본과의 id 충돌을 유니코드·특수 키 이름으로 밀어보기
//   · 로더를 **동시에 두 번** 부르는 경우 (같은 작업 빠른 중복 트리거)
//   · 생성물을 앱이 읽는 경로와 검증기가 읽는 경로가 서로 어긋나지 않는지

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  acceptGeneratedFile,
  mergeGenerated,
  isGeneratedItem,
  GENERATED_CONTRACT_VERSION,
} from '../src/domain/generatedItems.js';
import {
  fetchGeneratedItems,
  applyGeneratedItems,
  clearGeneratedCache,
} from '../src/utils/generatedDeck.js';
import { buildGeneratedDoc, validateGeneratedDoc } from '../lib/ai/generated.js';

const BASE = [
  { id: '001', question: 'q1', answer: 'a1', category: '데이터베이스' },
  { id: '002', question: 'q2', answer: 'a2', category: '데이터베이스' },
];

const variant = (overrides = {}) => ({
  id: '001-v1',
  question: '변형 질문',
  answer: '변형 정답',
  category: '데이터베이스',
  variantOf: '001',
  generated: true,
  ...overrides,
});

const file = (overrides = {}) => ({
  version: GENERATED_CONTRACT_VERSION,
  source: 'quiz100',
  generatedAt: '2026-09-03T12:00:00.000Z',
  model: 'claude-opus-5',
  reviewed: true,
  items: [variant()],
  ...overrides,
});

function textResponse(body, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  });
}

beforeEach(() => {
  clearGeneratedCache();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearGeneratedCache();
});

// ─────────────────────────────────────────────────────────────────────────────
// 계약 검증기 — 아직 잡지 않던 형태
// ─────────────────────────────────────────────────────────────────────────────

describe('validateGeneratedDoc: 문항이 하나도 없는 생성물', () => {
  it('items 가 빈 배열이면 통과시키지 않는다', () => {
    // 통과시키면 검증기가 "OK" 라고 말하고, 검수자가 빈 파일에 reviewed:true 를
    // 올린다. 그러면 아무 일도 일어나지 않는 파일이 검수 완료로 커밋된다.
    const result = validateGeneratedDoc(buildGeneratedDoc({ source: 'quiz100', items: [] }), {
      originals: BASE,
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.path)).toContain('items');
  });

  it('문항이 하나라도 있으면 통과한다', () => {
    const result = validateGeneratedDoc(buildGeneratedDoc({ source: 'quiz100', items: [variant()] }), {
      originals: BASE,
    });
    expect(result).toEqual({ ok: true, issues: [] });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// id 충돌 — 특수한 이름으로 밀어보기
// ─────────────────────────────────────────────────────────────────────────────

describe('id 충돌과 특수한 id', () => {
  it('원본과 id 가 같으면 유니코드 이름이어도 버린다', () => {
    const base = [{ id: '가-v1', question: 'q', answer: 'a' }];
    const { items, warnings } = mergeGenerated(
      base,
      [variant({ id: '가-v1', variantOf: '가-v1' })],
      'quiz100'
    );

    expect(items).toBe(base);
    expect(warnings[0]).toContain('교재 문항과 id 가 겹칩니다');
  });

  it('__proto__ 를 id 로 쓴 변형도 그냥 한 항목으로 다룬다', () => {
    const incoming = [
      variant({ id: '__proto__', variantOf: '001' }),
      variant({ id: '__proto__', variantOf: '001' }),
    ];
    const { items, warnings } = mergeGenerated(BASE, incoming, 'quiz100');

    // 두 번째는 id 중복으로 걸린다 — Set 이 프로토타입 키에 흔들리지 않아야 한다
    expect(items).toHaveLength(BASE.length + 1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('생성 문항끼리 id 가 겹칩니다');
    expect({}.question).toBeUndefined();
  });

  it('id 가 공백뿐이면 버린다', () => {
    const { items, warnings } = mergeGenerated(BASE, [variant({ id: '   ' })], 'quiz100');
    expect(items).toBe(BASE);
    expect(warnings[0]).toContain('id 가 비어 있습니다');
  });

  it('variantOf 가 자기 자신을 가리켜도 원본에 없으면 버린다', () => {
    const { items } = mergeGenerated(BASE, [variant({ id: 'x-v1', variantOf: 'x-v1' })], 'quiz100');
    expect(items).toBe(BASE);
  });

  it('원본 덱이 비어 있으면 어떤 변형도 붙이지 않는다', () => {
    // 교재 md 로딩이 실패한 상태 — 변형만 남은 덱을 보여주면 안 된다
    const { items, warnings } = mergeGenerated([], [variant()], 'quiz100');
    expect(items).toEqual([]);
    expect(warnings[0]).toContain('교재 문항이 없습니다');
  });

  it('id 가 유니코드 정규화만 다르면 서로 다른 문항으로 본다', () => {
    // 완성형 "각"(U+AC01) 과 조합형 "각"(U+1100 U+1161 U+11A8)
    const nfc = '001-v\uAC01';
    const nfd = '001-v\u1100\u1161\u11A8';
    expect(nfc).not.toBe(nfd);

    // Set·localStorage 키 모두 코드 단위로 비교하므로 두 id 는 끝까지 별개다.
    // 겹치는 것으로 보고 하나를 버리면 오히려 진도가 사라진다.
    const merged = mergeGenerated(BASE, [variant({ id: nfc }), variant({ id: nfd })], 'quiz100');
    expect(merged.items).toHaveLength(BASE.length + 2);
    expect(merged.warnings).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 파일 단위 관문 — reviewed 계약
// ─────────────────────────────────────────────────────────────────────────────

describe('reviewed 계약', () => {
  it.each([
    ['숫자 1', 1],
    ['문자열 "1"', '1'],
    ['객체', {}],
    ['배열', []],
    ['null', null],
  ])('reviewed 가 %s 면 문항을 내주지 않는다', (_label, reviewed) => {
    const { items, warnings } = acceptGeneratedFile(file({ reviewed }), 'quiz100');
    expect(items).toEqual([]);
    expect(warnings[0]).toContain('reviewed');
  });

  it('items 가 빈 배열인 검수 완료 파일은 경고 없이 0건이다', () => {
    // 앱 쪽은 "변형이 없는 상태" 와 구분할 필요가 없다 — 화면이 켜기 버튼을 안 띄운다
    expect(acceptGeneratedFile(file({ items: [] }), 'quiz100')).toEqual({
      items: [],
      warnings: [],
    });
  });

  it('reviewed 가 true 라도 source 가 다르면 통째로 무시한다', () => {
    const { items } = acceptGeneratedFile(file({ source: 'bogang' }), 'quiz100');
    expect(items).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 동시성 — 같은 작업을 두 번 빠르게 트리거
// ─────────────────────────────────────────────────────────────────────────────

describe('로더 동시 호출', () => {
  it('동시에 두 번 불러도 네트워크 요청은 한 번이다', async () => {
    const fetchMock = vi.fn(() => textResponse(JSON.stringify(file())));
    vi.stubGlobal('fetch', fetchMock);

    // await 하기 전에 두 번 부른다 — 화면 두 곳이 같은 프레임에 요청하는 상황
    const [a, b] = await Promise.all([
      fetchGeneratedItems('quiz100'),
      fetchGeneratedItems('quiz100'),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toBe(b); // 같은 배열을 나눠 쓴다
  });

  it('동시에 두 번 합쳐도 결과가 같고 원본이 늘어나지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(() => textResponse(JSON.stringify(file()))));

    const [first, second] = await Promise.all([
      applyGeneratedItems(BASE, 'quiz100', true),
      applyGeneratedItems(BASE, 'quiz100', true),
    ]);

    expect(first.items).toEqual(second.items);
    expect(first.items).toHaveLength(BASE.length + 1);
    expect(first.available).toBe(1);
    expect(BASE).toHaveLength(2); // 원본 배열은 그대로
  });

  it('실패한 요청도 캐시돼 두 번째 호출이 다시 때리지 않는다', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new TypeError('offline')));
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchGeneratedItems('quiz100')).toEqual([]);
    expect(await fetchGeneratedItems('quiz100')).toEqual([]);
    // 오프라인일 때 화면을 넘길 때마다 실패 요청을 반복하지 않는다
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('source 마다 따로 캐시한다', async () => {
    const fetchMock = vi.fn((url) =>
      textResponse(JSON.stringify(file({ source: url.includes('bogang') ? 'bogang' : 'quiz100' })))
    );
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([fetchGeneratedItems('quiz100'), fetchGeneratedItems('bogang')]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 응답 본문의 이상한 형태
// ─────────────────────────────────────────────────────────────────────────────

describe('생성물 응답 본문', () => {
  it.each([
    ['빈 본문', ''],
    ['공백만', '   '],
    ['HTML (SPA rewrite 가 잘못 걸린 경우)', '<!doctype html><html></html>'],
    ['JSON 배열', '[]'],
    ['JSON 문자열', '"nope"'],
    ['JSON null', 'null'],
    ['잘린 JSON', '{"version":1,"source":"quiz100","items":['],
  ])('%s 이어도 빈 목록으로 떨어진다', async (_label, body) => {
    vi.stubGlobal('fetch', vi.fn(() => textResponse(body)));
    await expect(fetchGeneratedItems('quiz100')).resolves.toEqual([]);
  });

  it('아주 큰 응답이어도 계약을 어긴 항목은 걸러진다', async () => {
    const items = Array.from({ length: 500 }, (_, i) =>
      i % 2 === 0
        ? variant({ id: `001-v${i}` })
        : variant({ id: `002-v${i}`, variantOf: '없는id' })
    );
    vi.stubGlobal('fetch', vi.fn(() => textResponse(JSON.stringify(file({ items })))));

    const merged = await applyGeneratedItems(BASE, 'quiz100', true);
    expect(merged.available).toBe(250);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 변형 판정
// ─────────────────────────────────────────────────────────────────────────────

describe('isGeneratedItem 경계', () => {
  it.each([
    ['빈 객체', {}],
    ['id 만 있는 교재 문항', { id: '001' }],
    ['드릴 id', { id: 'C-01' }],
    ['보강 id', { id: 'B01' }],
    ['-v 로 끝나지만 숫자가 없다', { id: '001-v' }],
    ['가운데에만 -v1', { id: '001-v1-x' }],
    ['generated 가 문자열 "true"', { id: '001', generated: 'true' }],
    ['숫자 id', { id: 1 }],
  ])('%s 은 변형이 아니다', (_label, item) => {
    expect(isGeneratedItem(item)).toBe(false);
  });

  it.each([
    ['변형 id', { id: '001-v1' }],
    ['두 자리 변형 번호', { id: 'C-01-v12' }],
    ['표시가 있으면 id 모양과 무관', { id: '001', generated: true }],
  ])('%s 은 변형이다', (_label, item) => {
    expect(isGeneratedItem(item)).toBe(true);
  });
});
