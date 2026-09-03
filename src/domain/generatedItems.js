// AI 변형 문제(Phase 4)의 도메인 계층.
//
// Phase 4 는 Batch API 로 만든 변형 문항을 `public/data/generated/<source>.json` 에
// **커밋해 두는** 기능이다(런타임 생성이 아니다). 이 파일은 그 생성물을
// 앱이 학습에 쓸 수 있는지 판정하고, 통과한 것만 원본 덱에 합친다.
//
// 규칙은 딱 하나로 요약된다: **믿을 수 없는 문항은 학습에 넣지 않는다.**
// AI 가 만든 정답이 틀리면 학습자가 틀린 것을 외운다 — 이 앱에서 가장 직접적인 해악이다.
// 그래서 파일 단위(`acceptGeneratedFile`)와 문항 단위(`mergeGenerated`)로 두 번 거른다.
//
// 순수 함수만 둔다 — 파일 로딩은 `src/utils/generatedDeck.js`, 화면 표시는 컴포넌트 담당.

/**
 * 생성물 파일 (BLUEPRINT §4.4).
 * @typedef {Object} GeneratedFile
 * @property {number} version 계약 버전. 앱이 아는 값이 아니면 통째로 무시한다
 * @property {'quiz100'|'codedrill'|'bogang'} source 어느 교재의 변형인가
 * @property {string} generatedAt ISO 타임스탬프
 * @property {string} model 생성에 쓴 모델
 * @property {boolean} reviewed 사람 검수 통과 여부. **false 면 앱이 쓰지 않는다**
 * @property {GeneratedItem[]} items
 */

/**
 * 생성 문항. 기존 파서 출력과 같은 shape 에 두 필드가 더 붙는다.
 * @typedef {Object} GeneratedItem
 * @property {string} id 원본과 겹치지 않는 식별자 (예: `042-v1`)
 * @property {string} variantOf 원본 문항의 id
 * @property {true} generated 화면이 "AI 변형" 배지를 붙이는 근거
 */

/** 앱이 읽을 수 있는 생성물 계약 버전 */
export const GENERATED_CONTRACT_VERSION = 1;

/** 변형을 만들 수 있는 교재 (BLUEPRINT §4.4) */
export const GENERATED_SOURCES = ['quiz100', 'codedrill', 'bogang'];

/** 코드트레이싱 드릴이 다루는 언어 — 교재 Part 1~4 와 같은 집합이다 */
const DRILL_LANGS = ['c', 'java', 'python', 'sql'];

/**
 * 변형 id 의 모양 (`<원본 id>-v<번호>`).
 *
 * 교재 id 는 `001`·`C-01`·`B01` 세 형식뿐이라 이 접미사와 겹치지 않는다.
 * `generated` 표시가 없는 **옛 오답노트 항목**을 알아보는 데만 쓴다 —
 * 새로 들어오는 문항은 표시 자체를 계약으로 요구한다(`mergeGenerated`).
 */
const VARIANT_ID_PATTERN = /-v\d+$/;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * 이 문항이 AI 가 만든 변형인가.
 *
 * 화면의 배지, 서버 API 호출 차단, 진도 계산 분리가 모두 이 판정 하나에 걸려 있다.
 * `generated` 표시를 우선 보고, 표시가 없으면 id 모양으로 판정한다 — Phase 4 이전에
 * 저장된 오답노트에는 표시 필드가 없기 때문이다.
 *
 * @param {{id?: string, generated?: unknown}|null|undefined} item
 * @returns {boolean}
 */
export function isGeneratedItem(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.generated === true) return true;
  return typeof item.id === 'string' && VARIANT_ID_PATTERN.test(item.id);
}

/**
 * 생성물 파일을 학습에 쓸 수 있는지 판정한다 (파일 단위 관문).
 *
 * 통과하지 못하면 **문항을 하나도 내주지 않는다**. 일부만 쓰는 절충은 없다 —
 * 검수를 통과하지 않았거나 계약 버전을 모르는 파일은 내용 전체를 믿을 수 없다.
 *
 * @param {unknown} raw 파싱된 JSON
 * @param {string} expectedSource 이 파일이 어느 교재의 것이어야 하는가
 * @returns {{items: object[], warnings: string[]}} 개발자용 경고를 함께 돌려준다
 */
export function acceptGeneratedFile(raw, expectedSource) {
  const reject = (warning) => ({ items: [], warnings: [`[generated:${expectedSource}] ${warning}`] });

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return reject('생성물이 객체가 아닙니다.');
  }
  if (raw.version !== GENERATED_CONTRACT_VERSION) {
    return reject(
      `모르는 version 입니다(${JSON.stringify(raw.version)}). ` +
        `앱이 아는 값은 ${GENERATED_CONTRACT_VERSION} 입니다.`
    );
  }
  if (raw.source !== expectedSource) {
    return reject(`파일이 선언한 source 가 ${JSON.stringify(raw.source)} 라 요청과 다릅니다.`);
  }
  // ★ 사람 검수 관문. 느슨한 진리값 판정(!!raw.reviewed)이면 "true" 나 1 도 통과한다.
  //   AI 가 만든 정답이 틀렸을 때의 비용이 크므로 정확히 boolean true 만 통과시킨다.
  if (raw.reviewed !== true) {
    return reject('reviewed 가 true 가 아니라 학습에 쓰지 않습니다. 사람 검수를 마쳐야 합니다.');
  }
  if (!Array.isArray(raw.items)) {
    return reject('items 가 배열이 아닙니다.');
  }
  return { items: raw.items, warnings: [] };
}

/**
 * 문항 하나가 계약을 지키는지 본다.
 * @returns {string|null} 어긴 이유. 지켰으면 null
 */
function itemViolation(item, source) {
  if (!item || typeof item !== 'object') return '문항이 객체가 아닙니다.';
  if (!isNonEmptyString(item.id)) return 'id 가 비어 있습니다.';
  if (!isNonEmptyString(item.variantOf)) return 'variantOf 가 비어 있습니다.';
  // 표시가 없으면 화면이 배지를 못 붙인다 — 학습자가 AI 정답을 교재 정답으로 오인한다
  if (item.generated !== true) return 'generated 표시가 없습니다.';
  if (!isNonEmptyString(item.answer)) return 'answer 가 비어 있습니다.';

  if (source === 'codedrill') {
    if (!isNonEmptyString(item.title)) return 'title 이 비어 있습니다.';
    if (!isNonEmptyString(item.code)) return 'code 가 비어 있습니다.';
    if (!DRILL_LANGS.includes(item.lang)) {
      return `lang 이 ${DRILL_LANGS.join('|')} 중 하나가 아닙니다(${JSON.stringify(item.lang)}).`;
    }
    return null;
  }

  if (!isNonEmptyString(item.question)) return 'question 이 비어 있습니다.';
  return null;
}

/**
 * 검수를 통과한 변형을 원본 덱에 합친다 (문항 단위 관문).
 *
 * **원본 뒤에 덧붙인다.** 원본 사이에 끼워 넣으면
 *   1) 변형을 켜고 끌 때마다 기존 문항의 번호(`3 / 40`)가 밀리고
 *   2) 원본 바로 다음에 그 변형이 나와 방금 본 정답을 그대로 떠올리게 된다.
 * 뒤에 모아 두면 원본 진도는 그대로고, 변형은 한 덱을 다 푼 뒤의 추가 연습이 된다.
 *
 * @param {object[]} baseItems 파서가 만든 교재 문항
 * @param {object[]} generatedItems `acceptGeneratedFile` 을 통과한 문항
 * @param {string} source
 * @returns {{items: object[], warnings: string[]}}
 */
export function mergeGenerated(baseItems, generatedItems, source) {
  const base = Array.isArray(baseItems) ? baseItems : [];
  const incoming = Array.isArray(generatedItems) ? generatedItems : [];
  if (incoming.length === 0) return { items: base, warnings: [] };

  const baseIds = new Set(base.map((item) => item?.id));
  const takenIds = new Set(baseIds);
  const warnings = [];
  const accepted = [];

  // 조용히 버리면 생성물이 왜 화면에 안 나오는지 알 길이 없다 —
  // 깨진 문항을 학습자에게 보여주는 것보다 낫지만, 개발자에게는 이유를 남긴다.
  const drop = (id, reason) => warnings.push(`[generated:${source}] ${id} 제외 — ${reason}`);

  for (const item of incoming) {
    const violation = itemViolation(item, source);
    if (violation) {
      drop(typeof item?.id === 'string' && item.id !== '' ? item.id : '(id 없음)', violation);
      continue;
    }
    if (takenIds.has(item.id)) {
      // 같은 id 를 두 문항이 나눠 쓰면 flashcard_known·quiz_results 같은
      // "id 하나에 값 하나" 저장 맵에서 서로의 진도를 덮어쓴다.
      drop(item.id, baseIds.has(item.id) ? '교재 문항과 id 가 겹칩니다.' : '생성 문항끼리 id 가 겹칩니다.');
      continue;
    }
    if (!baseIds.has(item.variantOf)) {
      // 교재가 바뀐 뒤 다시 생성하지 않은 낡은 파일이라는 신호다
      drop(item.id, `variantOf(${item.variantOf}) 에 해당하는 교재 문항이 없습니다.`);
      continue;
    }
    takenIds.add(item.id);
    accepted.push(item);
  }

  return { items: accepted.length === 0 ? base : [...base, ...accepted], warnings };
}
