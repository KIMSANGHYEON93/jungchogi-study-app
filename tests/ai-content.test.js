import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SOURCE_FILES,
  resolveDataDir,
  readDataFile,
  loadSource,
  loadProblem,
  findRelatedSections,
  buildSearchQuery,
  clearContentCache,
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

describe('resolveDataDir', () => {
  it('JUNGCHOGI_DATA_DIR 이 설정돼 있으면 그 디렉터리를 쓴다', () => {
    expect(resolveDataDir()).toBe(FIXTURE_DIR);
  });

  it('환경변수가 없으면 리포의 public/data 를 찾아낸다', () => {
    vi.stubEnv('JUNGCHOGI_DATA_DIR', '');
    const dir = resolveDataDir();
    expect(dir.replace(/\\/g, '/')).toMatch(/public\/data$/);
  });
});

describe('readDataFile', () => {
  it('데이터 디렉터리의 md 를 읽는다', () => {
    expect(readDataFile(SOURCE_FILES.quiz100)).toContain('### 001.');
  });

  it('없는 파일은 null 을 돌려준다', () => {
    expect(readDataFile('없는파일.md')).toBeNull();
  });

  it('경로 구분자가 든 이름은 데이터 디렉터리 밖을 못 읽는다', () => {
    expect(readDataFile('../../package.json')).toBeNull();
    expect(readDataFile('sub/dir.md')).toBeNull();
  });
});

describe('loadSource — 기존 파서 재사용', () => {
  it('quiz100 은 parseQuiz 결과를 그대로 돌려준다', () => {
    const items = loadSource('quiz100');
    expect(items.map((q) => q.id)).toEqual(['001', '002', '026']);
  });

  it('codedrill 은 parseCodeDrill 결과를 돌려준다', () => {
    expect(loadSource('codedrill').map((p) => p.id)).toEqual(['C-01', 'J-01', 'S-01', 'S-05']);
  });

  it('bogang 은 parseBogang 결과를 돌려준다', () => {
    expect(loadSource('bogang').map((c) => c.id)).toEqual(['B01', 'B02']);
  });

  it('화이트리스트 밖 source 는 빈 배열', () => {
    expect(loadSource('wikipedia')).toEqual([]);
  });

  it('두 번째 호출은 캐시를 써서 같은 배열을 돌려준다', () => {
    expect(loadSource('quiz100')).toBe(loadSource('quiz100'));
  });

  it('clearContentCache 뒤에는 다시 읽는다', () => {
    const first = loadSource('quiz100');
    clearContentCache();
    const second = loadSource('quiz100');
    expect(second).not.toBe(first);
    expect(second).toEqual(first);
  });
});

describe('loadProblem — source+id 로 문항·정답 로드', () => {
  it('단답형 문항을 공통 shape 으로 정규화한다', () => {
    expect(loadProblem('quiz100', '001')).toEqual({
      source: 'quiz100',
      id: '001',
      question: '트랜잭션의 4가지 특성(ACID)을 쓰시오.',
      answer: expect.stringContaining('원자성'),
      category: '데이터베이스',
      code: '',
      context: '',
      lang: '',
      pitfall: '',
      expectedOutput: '',
    });
  });

  it('코드 드릴은 code·context·lang·pitfall 을 채운다', () => {
    const problem = loadProblem('codedrill', 'S-01');
    expect(problem.question).toBe('GROUP BY + HAVING');
    expect(problem.lang).toBe('sql');
    expect(problem.code).toContain('GROUP BY 부서');
    expect(problem.context).toContain('| 김 | 개발 | 400 |');
    expect(problem.pitfall).toContain('AVG(급여)');
    expect(problem.answer).toContain('HAVING COUNT(*) >= 3');
  });

  it('코드 드릴의 expectedOutput 을 채운다', () => {
    expect(loadProblem('codedrill', 'C-01').expectedOutput).toBe('30 50');
  });

  it('보강 카드를 정규화한다', () => {
    const card = loadProblem('bogang', 'B01');
    expect(card.question).toContain('[보강]');
    expect(card.category).toBe('OS/기타');
    expect(card.answer).toContain('서식문자열');
  });

  it('없는 id 는 null', () => {
    expect(loadProblem('quiz100', '999')).toBeNull();
    expect(loadProblem('codedrill', 'C-99')).toBeNull();
  });

  it('없는 source 는 null', () => {
    expect(loadProblem('wikipedia', '001')).toBeNull();
  });
});

describe('findRelatedSections — 관련 교재 섹션 검색', () => {
  it('질문과 겹치는 낱말이 많은 섹션을 먼저 돌려준다', () => {
    const hits = findRelatedSections('정규화 단계별 핵심을 쓰시오: 1NF, 2NF, 3NF, BCNF');
    expect(hits[0].file).toBe('정처기_Day06_소프트웨어공학.md');
    expect(hits[0].heading).toContain('정규화 단계');
    expect(hits[0].excerpt).toContain('1NF');
  });

  it('{file, heading, excerpt} 형태로 돌려준다', () => {
    const [hit] = findRelatedSections('포인터 연산');
    expect(Object.keys(hit).sort()).toEqual(['excerpt', 'file', 'heading', 'score']);
  });

  it('limit 개까지만 돌려준다', () => {
    expect(findRelatedSections('정규화 포인터 테스트', { limit: 2 })).toHaveLength(2);
  });

  it('겹치는 낱말이 없으면 빈 배열', () => {
    expect(findRelatedSections('quantum chromodynamics')).toEqual([]);
  });

  it('빈 질의는 빈 배열', () => {
    expect(findRelatedSections('')).toEqual([]);
    expect(findRelatedSections('  ')).toEqual([]);
  });

  it('문항 파일(단답형·드릴·보강)은 교재 섹션 검색 대상이 아니다', () => {
    const files = findRelatedSections('정규화 GROUP BY 포인터', { limit: 20 }).map((h) => h.file);
    expect(files).not.toContain(SOURCE_FILES.quiz100);
    expect(files).not.toContain(SOURCE_FILES.codedrill);
    expect(files).not.toContain(SOURCE_FILES.bogang);
  });

  it('같은 질의는 늘 같은 순서를 돌려준다 (캐시 프리픽스 안정성)', () => {
    const a = findRelatedSections('정규화 테스트 포인터', { limit: 5 });
    clearContentCache();
    const b = findRelatedSections('정규화 테스트 포인터', { limit: 5 });
    expect(b).toEqual(a);
  });

  it('excerpt 는 길이 상한을 지킨다', () => {
    for (const hit of findRelatedSections('정규화 포인터', { limit: 5 })) {
      expect(hit.excerpt.length).toBeLessThanOrEqual(800);
    }
  });
});

describe('findRelatedSections — 실제 public/data 적합도', () => {
  // 픽스처 2개로는 "흔한 낱말 vs 희귀한 낱말"이 갈리지 않으므로 실물 교재로 본다.
  beforeEach(() => {
    vi.stubEnv('JUNGCHOGI_DATA_DIR', '');
    clearContentCache();
  });

  it('희귀한 낱말이 실제로 담긴 섹션을 1순위로 준다', () => {
    // 단답형 042번: "★나선형(Spiral) 모델의 핵심 특징은?" / 소프트웨어공학
    const hits = findRelatedSections('★나선형(Spiral) 모델의 핵심 특징은? 소프트웨어공학', {
      limit: 3,
    });
    expect(hits[0].excerpt).toContain('나선형');
  });

  it('흔한 낱말만 겹치는 체크리스트·목차 섹션이 상위를 차지하지 않는다', () => {
    const hits = findRelatedSections('★나선형(Spiral) 모델의 핵심 특징은? 소프트웨어공학', {
      limit: 3,
    });
    expect(hits.map((h) => h.heading).join(' | ')).not.toContain('체크리스트');
  });

  it('코드 드릴 질문도 해당 언어 섹션을 찾아낸다', () => {
    const hits = findRelatedSections('포인터 기본 c', { limit: 3 });
    expect(hits[0].file).toBe('정처기_Day01_C언어.md');
  });

  it('buildSearchQuery 로 만든 검색어가 교재 본문 섹션을 끌어온다', () => {
    const hits = findRelatedSections(buildSearchQuery(loadProblem('quiz100', '077')), { limit: 2 });
    // 카테고리 낱말을 섞으면 "F. 보안/네트워크 요약" 같은 목차 섹션이 1등을 먹는다
    expect(hits.map((h) => h.heading).join(' | ')).toContain('암호화');
  });
});

describe('buildSearchQuery', () => {
  it('보강 카드의 [보강] 라벨을 검색어에서 뺀다', () => {
    expect(buildSearchQuery({ question: '[보강] DFD 구성요소', category: '소프트웨어공학' })).toBe(
      'DFD 구성요소'
    );
  });

  it('카테고리 이름은 검색어에 넣지 않는다', () => {
    const query = buildSearchQuery({ question: '대칭키와 비대칭키의 차이', category: '보안/네트워크' });
    expect(query).not.toContain('보안/네트워크');
  });

  it('드릴은 제목에 문제 코드를 덧붙여 언어 맥락을 준다', () => {
    expect(buildSearchQuery({ question: '상속 + 오버라이딩', code: 'class A {}', lang: 'java' })).toContain(
      'java'
    );
  });

  it('빈 문항에도 견딘다', () => {
    expect(buildSearchQuery({})).toBe('');
    expect(buildSearchQuery(null)).toBe('');
  });
});
