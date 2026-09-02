// `public/data/*.md` 에서 문항·정답·관련 교재 섹션을 로드한다 (서버 전용).
//
// 파싱 규칙은 **복사하지 않고** 프론트엔드가 쓰는 파서를 그대로 import 한다.
// `src/utils/parse*.js` 는 브라우저 API 를 전혀 쓰지 않는 순수 함수(입력: md 문자열)라
// Node 에서도 그대로 돈다. 규칙이 한 곳에만 있어야 화면과 AI 해설이 어긋나지 않는다.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseQuiz } from '../../src/utils/parseQuiz.js';
import { parseCodeDrill } from '../../src/utils/parseCodeDrill.js';
import { parseBogang } from '../../src/utils/parseBogang.js';

/** API 계약의 source → md 파일명 */
export const SOURCE_FILES = {
  quiz100: '정처기_단답형_100선.md',
  codedrill: '정처기_코드트레이싱_드릴.md',
  bogang: '정처기_보강_기출분석_암기119선.md',
};

const PARSERS = {
  quiz100: parseQuiz,
  codedrill: parseCodeDrill,
  bogang: parseBogang,
};

/**
 * 교재 섹션 검색 대상. 문항 파일 3종은 제외한다 —
 * 해설의 근거는 교재 본문이어야 하고, 문항 파일을 넣으면 다른 문제의 정답이 섞인다.
 */
export const STUDY_FILES = [
  '정보처리기사_실기_합격전략.md',
  '정처기_Day01_C언어.md',
  '정처기_Day02_Java.md',
  '정처기_Day03_Python_SQL.md',
  '정처기_Day04_SQL심화_알고리즘.md',
  '정처기_Day05_디자인패턴_UML.md',
  '정처기_Day06_소프트웨어공학.md',
  '정처기_Day07_코드종합복습.md',
  '정처기_Day08_이론용어총정리.md',
  '정처기_Day09_모의고사1회.md',
  '정처기_Day10_약점보강.md',
  '정처기_Day11_모의고사2회.md',
  '정처기_Day12_최종정리.md',
  '정처기_Day13_시험전날.md',
  '정처기_Day14_시험당일.md',
];

/** 캐시 프리픽스로 쓰는 교재 파일 — 모든 요청에서 같아야 캐시가 적중한다 */
export const CACHE_PREFIX_FILE = '정보처리기사_실기_합격전략.md';

const MAX_EXCERPT_LENGTH = 800;
/** 헤딩에서의 등장은 본문에서의 등장보다 이만큼 무겁게 센다 */
const HEADING_WEIGHT = 5;
/** 등장 횟수 포화 상수 — 같은 낱말이 많이 나온다고 점수가 무한정 오르지 않게 한다 */
const TF_SATURATION = 3;

/**
 * 검색어 끝에 붙는 조사. 형태소 분석기를 붙일 규모가 아니라서
 * "떼고 남은 어간이 2글자 이상일 때만" 잘라내는 값싼 근사를 쓴다
 * (`모델의`→`모델`, `특징은`→`특징`. `용도`→`용` 은 어간이 1글자라 건드리지 않는다).
 */
const PARTICLES = ['으로', '에서', '에게', '까지', '부터', '은', '는', '이', '가', '을', '를', '의', '에', '와', '과', '도', '로'];

/**
 * 데이터 디렉터리를 찾는다.
 *
 * ESM 에는 `__dirname` 이 없으므로 `import.meta.url` 로 이 파일 기준 경로를 만든다.
 * 후보를 순서대로 보는 이유:
 *   1. `JUNGCHOGI_DATA_DIR` — 테스트 픽스처·로컬 실험용 명시 지정
 *   2. 이 파일 기준 `../../public/data` — 로컬 개발·번들이 디렉터리 구조를 보존할 때
 *   3. `cwd()/public/data` — Vercel 람다는 함수 루트가 cwd 라
 *      `vercel.json` 의 `includeFiles` 로 올린 파일이 여기 놓인다
 * @returns {string}
 */
export function resolveDataDir() {
  const fromEnv = process.env.JUNGCHOGI_DATA_DIR?.trim();
  if (fromEnv) return fromEnv;

  const candidates = [
    fileURLToPath(new URL('../../public/data', import.meta.url)),
    join(process.cwd(), 'public', 'data'),
  ];
  return candidates.find((dir) => existsSync(dir)) ?? candidates[0];
}

/**
 * 데이터 디렉터리 안의 md 파일 하나를 읽는다.
 * 파일명에 경로 구분자가 있으면 거부해 디렉터리 밖을 못 읽게 한다.
 * @param {string} name
 * @returns {string|null}
 */
export function readDataFile(name) {
  if (typeof name !== 'string' || /[\\/]/.test(name) || name.includes('..')) return null;
  const path = join(resolveDataDir(), name);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8');
}

/** source → 파싱 결과 배열 */
const parsedCache = new Map();
/** 교재 섹션 인덱스 (지연 생성) */
let sectionIndex = null;

/** 테스트·재기동용 — 파싱 캐시를 비운다. */
export function clearContentCache() {
  parsedCache.clear();
  sectionIndex = null;
}

/**
 * source 전체를 파싱해 돌려준다 (인스턴스 수명 동안 캐시).
 * @param {string} source
 * @returns {Array<object>}
 */
export function loadSource(source) {
  if (!SOURCE_FILES[source]) return [];
  if (parsedCache.has(source)) return parsedCache.get(source);

  const text = readDataFile(SOURCE_FILES[source]);
  const items = text ? PARSERS[source](text) : [];
  parsedCache.set(source, items);
  return items;
}

/**
 * @typedef {object} TutorProblem
 * @property {string} source
 * @property {string} id
 * @property {string} question  문항 지문 (드릴은 제목)
 * @property {string} answer    교재의 정답·풀이
 * @property {string} category
 * @property {string} code      드릴의 문제 코드
 * @property {string} context   드릴의 예제 테이블·조건 지문
 * @property {string} lang      드릴의 언어 (c|java|python|sql)
 * @property {string} pitfall   드릴의 함정 한 줄 요약
 * @property {string} expectedOutput 드릴의 기대 출력
 */

/**
 * source+id 로 문항 하나를 공통 shape 으로 로드한다.
 * @param {string} source
 * @param {string} id
 * @returns {TutorProblem|null}
 */
export function loadProblem(source, id) {
  const item = loadSource(source).find((entry) => entry.id === id);
  if (!item) return null;

  return {
    source,
    id: item.id,
    // 단답형·보강은 `question`, 드릴은 `title` 이 지문 역할을 한다
    question: item.question ?? item.title ?? '',
    answer: item.answer ?? '',
    category: item.category ?? '',
    code: item.code ?? '',
    context: item.context ?? '',
    lang: item.lang ?? '',
    pitfall: item.pitfall ?? '',
    expectedOutput: item.expectedOutput ?? '',
  };
}

/**
 * 문항에서 교재 검색어를 만든다.
 *
 * 카테고리 이름(`보안/네트워크` 등)은 **넣지 않는다.** 교재에 같은 이름의
 * 목차·요약 섹션이 있어서 그쪽이 1등을 먹고 정작 내용이 있는 섹션이 밀린다
 * (실측: 077번 "대칭키/비대칭키" → 카테고리를 넣으면 "F. 보안/네트워크 요약",
 *  빼면 "5-2. 암호화 방식"). `[보강]` 도 파서가 붙인 UI 라벨이라 뺀다.
 * 드릴은 제목이 짧으므로 언어 태그를 덧붙여 맥락을 준다.
 * @param {{question?: string, lang?: string}|null} problem
 * @returns {string}
 */
export function buildSearchQuery(problem) {
  const question = (problem?.question ?? '').replace(/^\[[^\]]*\]\s*/, '').trim();
  const lang = problem?.lang ? ` ${problem.lang}` : '';
  return `${question}${question ? lang : ''}`.trim();
}

/**
 * 교재 파일들을 헤딩 단위 섹션으로 쪼개 인덱스를 만든다.
 * `##`/`###` 헤딩이 나오면 새 섹션을 시작하고, 다음 헤딩 전까지를 본문으로 본다.
 */
function buildSectionIndex() {
  const sections = [];

  for (const file of STUDY_FILES) {
    const text = readDataFile(file);
    if (!text) continue;

    let heading = null;
    let body = [];
    const flush = () => {
      if (heading) sections.push({ file, heading, body: body.join('\n').trim() });
    };

    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^(#{2,3})\s+(.+?)\s*$/);
      if (match) {
        flush();
        heading = match[2];
        body = [];
      } else if (heading) {
        body.push(line);
      }
    }
    flush();
  }

  // 소문자 사본을 미리 만들어 둔다 (질의마다 다시 만들지 않게)
  return sections.map((section) => ({
    ...section,
    headingLower: section.heading.toLowerCase(),
    bodyLower: section.body.toLowerCase(),
  }));
}

/** 조사를 떼어 어간을 만든다 (어간이 2글자 미만이 되면 원형을 유지). */
function stripParticle(term) {
  for (const particle of PARTICLES) {
    if (term.length - particle.length >= 2 && term.endsWith(particle)) {
      return term.slice(0, -particle.length);
    }
  }
  return term;
}

/**
 * 질의를 검색어로 쪼갠다. 한글·영숫자 덩어리 중 2글자 이상만 쓴다.
 * @param {string} query
 * @returns {string[]}
 */
function tokenize(query) {
  if (typeof query !== 'string') return [];
  const terms = query.toLowerCase().match(/[0-9a-z가-힣]{2,}/g) ?? [];
  return [...new Set(terms.map(stripParticle))];
}

/** 겹치지 않는 부분 문자열 등장 횟수 */
function countOccurrences(haystack, needle) {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
}

/**
 * 질의와 관련된 교재 섹션을 찾는다.
 *
 * 단순 등장 횟수 합계는 쓸 수 없다. "핵심"·"모델" 같은 흔한 낱말이 교재 전체에 깔려 있어서,
 * 그런 낱말만 많이 든 목차·체크리스트 섹션이 늘 1등을 먹기 때문이다
 * (실제로 "나선형 모델의 핵심 특징" 질의가 "Day 3 학습 완료 체크리스트"를 물어왔다).
 * 그래서 두 가지를 쓴다:
 *   - **IDF**: 몇 개 섹션에만 나오는 낱말(`나선형`)에 큰 가중치, 어디에나 나오는 낱말에 작은 가중치
 *   - **등장 횟수 포화**: 같은 낱말이 20번 나온다고 20배 점수가 되지 않게 tf/(tf+k)
 *
 * 순서는 결정적이다 — 점수가 같으면 파일명·헤딩 순. (프롬프트 프리픽스 안정성)
 * @param {string} query
 * @param {{limit?: number}} [options]
 * @returns {Array<{file: string, heading: string, excerpt: string, score: number}>}
 */
export function findRelatedSections(query, options) {
  const limit = options?.limit ?? 3;
  const terms = tokenize(query);
  if (terms.length === 0) return [];

  sectionIndex ??= buildSectionIndex();
  const total = sectionIndex.length;
  if (total === 0) return [];

  // 각 검색어가 몇 개 섹션에 나오는지 → 역문서빈도(IDF)
  const idf = new Map();
  for (const term of terms) {
    const df = sectionIndex.reduce(
      (n, s) => n + (s.headingLower.includes(term) || s.bodyLower.includes(term) ? 1 : 0),
      0
    );
    idf.set(term, df === 0 ? 0 : Math.log(1 + total / (1 + df)));
  }

  const scored = [];
  for (const section of sectionIndex) {
    let score = 0;
    for (const term of terms) {
      const weight = idf.get(term);
      if (weight === 0) continue;

      const tf =
        countOccurrences(section.headingLower, term) * HEADING_WEIGHT +
        countOccurrences(section.bodyLower, term);
      if (tf === 0) continue;

      score += weight * (tf / (tf + TF_SATURATION));
    }
    if (score === 0) continue;

    scored.push({
      file: section.file,
      heading: section.heading,
      excerpt: section.body.slice(0, MAX_EXCERPT_LENGTH),
      score,
    });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score || a.file.localeCompare(b.file) || a.heading.localeCompare(b.heading)
  );
  return scored.slice(0, limit);
}
