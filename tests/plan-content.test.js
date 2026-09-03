// 플래너 도구가 쓰는 `lib/ai/content.js` 확장분 — 섹션 본문 조회와 문항 메타 목록.
//
// 여기서 가장 중요한 건 `listProblemMeta` 가 **정답을 절대 흘리지 않는 것**이다.
// 플래너는 "무엇을 얼마나 공부할지" 계획만 세우면 되고 정답을 알 필요가 없다.
// 정답이 도구 결과로 흘러 들어가면 (1) 컨텍스트·비용이 불어나고
// (2) 계획 설명에 정답이 섞여 학습자가 문제를 풀기 전에 답을 보게 된다.

import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  getSection,
  listProblemMeta,
  clearContentCache,
  loadSource,
} from '../lib/ai/content.js';

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/ai-data', import.meta.url));

beforeEach(() => {
  vi.stubEnv('JUNGCHOGI_DATA_DIR', FIXTURE_DIR);
  clearContentCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  clearContentCache();
});

describe('getSection', () => {
  it('헤딩 본문을 잘리지 않은 채로 돌려준다', () => {
    const section = getSection('정처기_Day06_소프트웨어공학.md', '3-1. 정규화 단계');

    expect(section).not.toBeNull();
    expect(section.file).toBe('정처기_Day06_소프트웨어공학.md');
    expect(section.heading).toBe('3-1. 정규화 단계');
    expect(section.body).toContain('BCNF');
    // 다음 헤딩 직전까지만 담는다
    expect(section.body).toContain('도부이결다조');
    expect(section.body).not.toContain('반정규화');
  });

  it('헤딩 앞의 # 와 앞뒤 공백을 무시하고 찾는다', () => {
    const plain = getSection('정처기_Day06_소프트웨어공학.md', '3-1. 정규화 단계');
    const decorated = getSection('정처기_Day06_소프트웨어공학.md', '  ### 3-1. 정규화 단계 ');

    expect(decorated).toEqual(plain);
  });

  it('대소문자를 구분하지 않는다', () => {
    const section = getSection('정처기_Day01_C언어.md', 'part 1: c언어 기본');
    const exact = getSection('정처기_Day01_C언어.md', 'PART 1: C언어 기본');

    // 픽스처에 해당 헤딩이 있을 때만 의미가 있다 — 없으면 둘 다 null 로 같다
    expect(section).toEqual(exact);
  });

  it('없는 헤딩이면 null', () => {
    expect(getSection('정처기_Day06_소프트웨어공학.md', '존재하지 않는 헤딩')).toBeNull();
  });

  it('색인에 없는 파일이면 null', () => {
    expect(getSection('없는파일.md', '3-1. 정규화 단계')).toBeNull();
  });

  it('문항 파일은 섹션 색인에 없다 (다른 문제의 정답이 새지 않게)', () => {
    expect(getSection('정처기_단답형_100선.md', 'A. 데이터베이스 (최빈출 영역 1위) — 25문제')).toBeNull();
  });

  it('경로 탈출 시도는 null', () => {
    expect(getSection('../../package.json', '무엇이든')).toBeNull();
    expect(getSection('sub/dir.md', '무엇이든')).toBeNull();
  });
});

describe('listProblemMeta', () => {
  it('문항 메타를 돌려준다', () => {
    const items = listProblemMeta('quiz100');

    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toEqual({
      source: 'quiz100',
      id: '001',
      title: '트랜잭션의 4가지 특성(ACID)을 쓰시오.',
      category: '데이터베이스',
      lang: '',
    });
  });

  it('정답·기대출력·함정을 절대 포함하지 않는다', () => {
    for (const source of ['quiz100', 'codedrill', 'bogang']) {
      const items = listProblemMeta(source);
      expect(items.length).toBeGreaterThan(0);

      for (const item of items) {
        expect(Object.keys(item).sort()).toEqual(['category', 'id', 'lang', 'source', 'title']);
        expect(item).not.toHaveProperty('answer');
        expect(item).not.toHaveProperty('expectedOutput');
        expect(item).not.toHaveProperty('pitfall');
        expect(item).not.toHaveProperty('code');
      }
    }
  });

  it('교재의 정답 문자열이 결과 어디에도 나타나지 않는다', () => {
    // 파싱 결과에서 실제 정답을 가져와, 메타 목록을 통째로 직렬화한 문자열에 없는지 본다.
    // "필드를 안 담았다"보다 강한 보장이다 — 나중에 필드가 늘어도 이 테스트가 잡는다.
    const drill = loadSource('codedrill').find((p) => p.id === 'C-01');
    const serialized = JSON.stringify(listProblemMeta('codedrill'));

    expect(drill.expectedOutput).toBe('30 50');
    expect(serialized).not.toContain(drill.expectedOutput);
    expect(serialized).not.toContain(drill.pitfall);
    expect(serialized).not.toContain('추적표');
  });

  it('코드트레이싱 드릴은 언어를 카테고리로 쓴다', () => {
    const items = listProblemMeta('codedrill', { ids: ['C-01', 'S-01'] });

    expect(items).toEqual([
      { source: 'codedrill', id: 'C-01', title: '포인터 기본', category: 'c', lang: 'c' },
      { source: 'codedrill', id: 'S-01', title: 'GROUP BY + HAVING', category: 'sql', lang: 'sql' },
    ]);
  });

  it('category 로 거른다', () => {
    const items = listProblemMeta('codedrill', { category: 'sql' });

    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.lang === 'sql')).toBe(true);
  });

  it('ids 로 거르고, 요청한 순서를 유지한다', () => {
    const items = listProblemMeta('quiz100', { ids: ['002', '001'] });

    expect(items.map((i) => i.id)).toEqual(['002', '001']);
  });

  it('없는 id 는 조용히 건너뛴다', () => {
    const items = listProblemMeta('quiz100', { ids: ['001', '999'] });

    expect(items.map((i) => i.id)).toEqual(['001']);
  });

  it('category 와 ids 를 함께 주면 둘 다 만족하는 것만 남는다', () => {
    const items = listProblemMeta('codedrill', { category: 'sql', ids: ['C-01', 'S-01'] });

    expect(items.map((i) => i.id)).toEqual(['S-01']);
  });

  it('알 수 없는 source 는 빈 배열', () => {
    expect(listProblemMeta('없는소스')).toEqual([]);
    expect(listProblemMeta(null)).toEqual([]);
  });
});
