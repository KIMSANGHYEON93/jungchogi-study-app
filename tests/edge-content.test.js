// 콘텐츠 경우의 수 하드닝 — `lib/ai/content.js` + `public/data`.
//
// 두 가지를 본다.
//
// 1) **실제 배포되는 교재의 불변식.** 파서 단위 테스트는 픽스처만 보므로
//    `public/data` 의 md 를 잘못 고쳐도(파일명 변경, id 중복, 정답 누락) 아무도
//    알아채지 못한다. 그런데 이 값들은 서버 계약과 직접 맞물린다 —
//    id 는 `lib/ai/guard.js` 의 ID_PATTERN 을 통과해야 하고, 정답이 비면
//    채점(`/api/ai/grade`)이 근거 없이 채점한다.
//
// 2) **교재가 없거나·비었거나·형식이 깨졌을 때.** 배포에서 파일이 빠지거나
//    `includeFiles` 설정이 어긋나면 실제로 일어난다. 이때 500 이 아니라
//    "문항을 찾지 못했다"로 떨어져야 한다.

import { existsSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  SOURCE_FILES,
  STUDY_FILES,
  CACHE_PREFIX_FILE,
  readDataFile,
  loadSource,
  loadProblem,
  listProblemMeta,
  findRelatedSections,
  getSection,
  buildSearchQuery,
  clearContentCache,
} from '../lib/ai/content.js';
import { ALLOWED_SOURCES } from '../lib/ai/guard.js';
import { ALLOWED_LANGS, selectProblems } from '../lib/ai/variants.js';

const REAL_DATA_DIR = fileURLToPath(new URL('../public/data', import.meta.url));

/** `lib/ai/guard.js` 의 ID_PATTERN 과 같은 형식 (거기서는 export 하지 않는다) */
const ID_PATTERN = {
  quiz100: /^\d{3}$/,
  codedrill: /^[CJPS]-\d{2}$/,
  bogang: /^B\d{2,3}$/,
};

let tempDirs = [];

function makeDataDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'jungchogi-edge-'));
  tempDirs.push(dir);
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), body, 'utf8');
  }
  return dir;
}

beforeEach(() => {
  clearContentCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  clearContentCache();
  tempDirs.forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  tempDirs = [];
});

// ─────────────────────────────────────────────────────────────────────────────
// 실제 교재의 불변식
// ─────────────────────────────────────────────────────────────────────────────

describe('public/data 불변식', () => {
  beforeEach(() => {
    vi.stubEnv('JUNGCHOGI_DATA_DIR', REAL_DATA_DIR);
    clearContentCache();
  });

  it('서버가 참조하는 md 파일이 모두 있다', () => {
    const wanted = [...new Set([...Object.values(SOURCE_FILES), ...STUDY_FILES, CACHE_PREFIX_FILE])];
    const missing = wanted.filter((name) => readDataFile(name) === null);
    expect(missing).toEqual([]);
  });

  it.each(ALLOWED_SOURCES)('%s: 문항이 0건이 아니다', (source) => {
    expect(loadSource(source).length).toBeGreaterThan(0);
  });

  it.each(ALLOWED_SOURCES)('%s: 문항 id 가 중복되지 않는다', (source) => {
    const ids = loadSource(source).map((item) => item.id);
    const duplicated = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    // id 가 겹치면 loadProblem 이 앞의 것만 찾고, 화면의 진도 맵(id 하나에 값 하나)이
    // 두 문항의 진도를 서로 덮어쓴다.
    expect(duplicated).toEqual([]);
  });

  it.each(ALLOWED_SOURCES)('%s: 모든 id 가 서버의 ID_PATTERN 을 통과한다', (source) => {
    const bad = loadSource(source)
      .map((item) => item.id)
      .filter((id) => !ID_PATTERN[source].test(id));
    // 통과하지 못하는 id 는 /api/ai/tutor·/api/ai/grade 에서 400 이 된다
    expect(bad).toEqual([]);
  });

  it.each(ALLOWED_SOURCES)('%s: 모든 문항에 정답이 있다', (source) => {
    // 정답이 비면 채점이 근거 없이 채점하고, 해설이 "교재에 정답이 없다"만 말한다
    const empty = loadSource(source)
      .filter((item) => !(item.answer ?? '').trim())
      .map((item) => item.id);
    expect(empty).toEqual([]);
  });

  it('코드 드릴의 lang 이 모두 허용 언어다', () => {
    const bad = loadSource('codedrill')
      .filter((item) => !ALLOWED_LANGS.includes(item.lang))
      .map((item) => `${item.id}:${item.lang}`);
    expect(bad).toEqual([]);
  });

  it('교재 섹션 색인이 비어 있지 않고 문항 파일을 담지 않는다', () => {
    const sections = findRelatedSections('정규화 단계', { limit: 8 });
    expect(sections.length).toBeGreaterThan(0);
    expect(sections.every((section) => STUDY_FILES.includes(section.file))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 교재가 없거나 비었거나 깨졌을 때
// ─────────────────────────────────────────────────────────────────────────────

describe('교재 파일이 없을 때', () => {
  beforeEach(() => {
    vi.stubEnv('JUNGCHOGI_DATA_DIR', makeDataDir({}));
    clearContentCache();
  });

  it('loadSource 는 예외 대신 빈 배열을 돌려준다', () => {
    for (const source of ALLOWED_SOURCES) expect(loadSource(source)).toEqual([]);
  });

  it('loadProblem 은 null 을 돌려준다 (엔드포인트가 400 으로 답할 근거)', () => {
    expect(loadProblem('quiz100', '001')).toBeNull();
  });

  it('findRelatedSections 는 빈 배열을 돌려준다', () => {
    expect(findRelatedSections('정규화')).toEqual([]);
  });

  it('getSection 은 null 을 돌려준다', () => {
    expect(getSection('정처기_Day06_소프트웨어공학.md', '3-1. 정규화 단계')).toBeNull();
  });

  it('listProblemMeta 는 빈 배열을 돌려준다', () => {
    expect(listProblemMeta('quiz100', { ids: ['001'] })).toEqual([]);
  });

  it('변형 생성기는 조용히 0건을 만들지 않고 던진다', () => {
    expect(() => selectProblems({ source: 'quiz100', ids: null, category: null })).toThrow(
      /public\/data/
    );
  });
});

describe('교재 파일이 비었거나 형식이 깨졌을 때', () => {
  const broken = {
    빈파일: '',
    공백만: '   \n\n\t\n',
    헤딩없음: '그냥 줄글입니다.\n문항 헤딩이 없습니다.\n',
    깨진헤딩: '### 1. 세 자리가 아님\n#### 001. 헤딩 레벨이 다름\n',
    닫히지않은details: '### 001. 문항\n<details>\n<summary>정답</summary>\n정답 본문\n',
  };

  it.each(Object.entries(broken))('%s: quiz100 파싱이 던지지 않는다', (_label, body) => {
    vi.stubEnv('JUNGCHOGI_DATA_DIR', makeDataDir({ [SOURCE_FILES.quiz100]: body }));
    clearContentCache();
    expect(() => loadSource('quiz100')).not.toThrow();
    expect(Array.isArray(loadSource('quiz100'))).toBe(true);
  });

  it.each(Object.entries(broken))('%s: codedrill 파싱이 던지지 않는다', (_label, body) => {
    vi.stubEnv('JUNGCHOGI_DATA_DIR', makeDataDir({ [SOURCE_FILES.codedrill]: body }));
    clearContentCache();
    expect(() => loadSource('codedrill')).not.toThrow();
  });

  it.each(Object.entries(broken))('%s: bogang 파싱이 던지지 않는다', (_label, body) => {
    vi.stubEnv('JUNGCHOGI_DATA_DIR', makeDataDir({ [SOURCE_FILES.bogang]: body }));
    clearContentCache();
    expect(() => loadSource('bogang')).not.toThrow();
  });

  it('교재 본문이 헤딩 없는 줄글이면 검색은 0건이다', () => {
    vi.stubEnv(
      'JUNGCHOGI_DATA_DIR',
      makeDataDir({ [CACHE_PREFIX_FILE]: '헤딩이 하나도 없는 정규화 본문입니다.\n' })
    );
    clearContentCache();
    expect(findRelatedSections('정규화')).toEqual([]);
  });

  it('id 가 중복된 교재에서는 앞의 문항을 쓴다 (결정적으로)', () => {
    vi.stubEnv(
      'JUNGCHOGI_DATA_DIR',
      makeDataDir({
        [SOURCE_FILES.quiz100]: [
          '### 001. 앞 문항',
          '<details><summary>정답</summary>',
          '앞 정답',
          '</details>',
          '### 001. 뒤 문항',
          '<details><summary>정답</summary>',
          '뒤 정답',
          '</details>',
          '',
        ].join('\n'),
      })
    );
    clearContentCache();

    expect(loadSource('quiz100')).toHaveLength(2);
    expect(loadProblem('quiz100', '001').question).toBe('앞 문항');
    expect(loadProblem('quiz100', '001').question).toBe('앞 문항'); // 두 번 불러도 같다
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 검색 질의의 입력 경계
// ─────────────────────────────────────────────────────────────────────────────

describe('검색 질의 경계', () => {
  beforeEach(() => {
    vi.stubEnv('JUNGCHOGI_DATA_DIR', REAL_DATA_DIR);
    clearContentCache();
  });

  it.each([
    ['빈 문자열', ''],
    ['공백만', '   \t\n '],
    ['한 글자', '가'],
    ['기호만', '!!! ??? ---'],
    ['제어문자만', '\u0000\u0007\u001B'],
    ['이모지만', '🙂🙂🙂'],
    ['숫자가 아닌 타입', null],
    ['객체', {}],
  ])('%s 질의는 빈 배열을 돌려준다', (_label, query) => {
    expect(findRelatedSections(query)).toEqual([]);
  });

  it('아주 긴 질의에도 상한 개수만 돌려준다', () => {
    const long = '정규화 단계 이상 현상 '.repeat(500);
    const sections = findRelatedSections(long, { limit: 3 });
    expect(sections.length).toBeLessThanOrEqual(3);
  });

  it('같은 질의는 두 번 불러도 같은 순서·같은 발췌를 돌려준다', () => {
    const a = findRelatedSections('결합도 응집도', { limit: 5 });
    const b = findRelatedSections('결합도 응집도', { limit: 5 });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('buildSearchQuery 는 문항이 없거나 비어도 던지지 않는다', () => {
    expect(buildSearchQuery(null)).toBe('');
    expect(buildSearchQuery({})).toBe('');
    expect(buildSearchQuery({ question: '   ' })).toBe('');
    expect(buildSearchQuery({ question: '', lang: 'c' })).toBe('');
  });

  it('getSection 은 `#`·대소문자·공백 차이를 무시하고 정규식 문자를 문자 그대로 본다', () => {
    const found = getSection('정처기_Day06_소프트웨어공학.md', '  ### 3-1. 정규화 단계 ');
    expect(found?.heading).toBe('3-1. 정규화 단계');
    // 헤딩을 정규식으로 쓰면 `.` 이 아무 글자나 맞혀 엉뚱한 섹션을 준다
    expect(getSection('정처기_Day06_소프트웨어공학.md', '3.1. 정규화 단계')).toBeNull();
  });

  it('readDataFile 은 데이터 디렉터리 밖을 읽지 않는다', () => {
    vi.stubEnv('JUNGCHOGI_DATA_DIR', REAL_DATA_DIR);
    for (const name of [
      '../package.json',
      '..\\package.json',
      'sub/dir.md',
      'sub\\dir.md',
      '../../etc/passwd',
      42,
      null,
    ]) {
      expect(readDataFile(name)).toBeNull();
    }
    // 정상 파일은 읽힌다 (위 거절이 전부를 막아 버린 것이 아님을 확인)
    expect(readDataFile(CACHE_PREFIX_FILE)).toBeTruthy();
  });

  it('데이터 디렉터리 자체가 없어도 던지지 않는다', () => {
    const missing = join(tmpdir(), `jungchogi-none-${Date.now()}`);
    expect(existsSync(missing)).toBe(false);
    vi.stubEnv('JUNGCHOGI_DATA_DIR', missing);
    clearContentCache();

    expect(readDataFile(CACHE_PREFIX_FILE)).toBeNull();
    expect(loadSource('quiz100')).toEqual([]);
  });

  it('데이터 디렉터리에 하위 디렉터리만 있어도 던지지 않는다', () => {
    const dir = makeDataDir({});
    mkdirSync(join(dir, 'generated'));
    vi.stubEnv('JUNGCHOGI_DATA_DIR', dir);
    clearContentCache();

    expect(loadSource('quiz100')).toEqual([]);
    expect(findRelatedSections('정규화')).toEqual([]);
  });
});
