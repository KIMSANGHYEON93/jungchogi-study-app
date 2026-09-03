// 생성물 파일의 **고정 계약** (블루프린트 §4.4) 과 그 기계 검증.
//
//   public/data/generated/<source>.json
//   {
//     "version": 1,
//     "source": "quiz100",
//     "generatedAt": "2026-09-03T12:00:00.000Z",
//     "model": "claude-opus-5",
//     "reviewed": false,        // 사람 검수 통과 여부. false 면 앱이 쓰지 않는다.
//     "items": [ /* 파서 출력 shape + variantOf + generated */ ]
//   }
//
// 이 파일에는 SDK 호출이 없다 — **키 없이** 돌고 `npm test` 에 들어간다.
// 검수 절차는 `claudedocs/GENERATED_REVIEW.md` 를 볼 것.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MODEL } from './client.js';
import { ALLOWED_LANGS, VARIANT_SOURCES } from './variants.js';

/** 봉투 버전. 계약이 바뀌면 올리고 읽는 쪽(앱)도 함께 고친다. */
export const GENERATED_VERSION = 1;

/**
 * 항목의 필드 계약.
 *
 * `required` 는 **정확히 이 필드만** 있어야 한다는 뜻이다 (여분 필드도 위반).
 * `nonEmpty` 는 그중 빈 문자열이면 안 되는 것 — 드릴의 `context`·`expectedOutput`·
 * `pitfall` 은 원본에도 비어 있는 문항이 있으므로 여기 넣지 않는다.
 */
const ITEM_CONTRACT = {
  quiz100: {
    required: ['id', 'question', 'answer', 'category', 'variantOf', 'generated'],
    nonEmpty: ['id', 'question', 'answer', 'category', 'variantOf'],
  },
  bogang: {
    required: ['id', 'question', 'answer', 'category', 'variantOf', 'generated'],
    nonEmpty: ['id', 'question', 'answer', 'category', 'variantOf'],
  },
  codedrill: {
    required: [
      'id',
      'title',
      'context',
      'code',
      'lang',
      'answer',
      'expectedOutput',
      'pitfall',
      'variantOf',
      'generated',
    ],
    nonEmpty: ['id', 'title', 'code', 'lang', 'answer', 'variantOf'],
  },
};

/**
 * source 의 항목 필드 목록 (계약 그대로).
 * @param {string} source
 * @returns {string[]}
 */
export function generatedItemFields(source) {
  const contract = ITEM_CONTRACT[source];
  if (!contract) throw new Error(`알 수 없는 source: ${source}`);
  return [...contract.required];
}

/**
 * 생성물 디렉터리. `lib/ai/content.js` 의 `resolveDataDir` 과 달리 여기는 **쓰는** 쪽이라
 * 리포 안 고정 경로를 쓴다 (`JUNGCHOGI_DATA_DIR` 은 읽기 픽스처용이다).
 * @returns {string}
 */
export function generatedDir() {
  return fileURLToPath(new URL('../../public/data/generated', import.meta.url));
}

/**
 * @param {string} source
 * @returns {string} `public/data/generated/<source>.json` 절대 경로
 */
export function generatedPath(source) {
  if (!VARIANT_SOURCES.includes(source)) throw new Error(`알 수 없는 source: ${source}`);
  return join(generatedDir(), `${source}.json`);
}

/**
 * 커밋된 생성물 파일 목록 (없으면 빈 배열).
 * @returns {string[]}
 */
export function listGeneratedFiles() {
  const dir = generatedDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => join(dir, name));
}

/**
 * 생성물 봉투를 만든다. `reviewed` 는 항상 false 로 시작한다 —
 * 사람 검수를 통과해야 손으로 true 로 올린다.
 * @param {{source: string, items: Array<object>, model?: string,
 *          reviewed?: boolean, generatedAt?: string}} args
 * @returns {object}
 */
export function buildGeneratedDoc({ source, items, model = MODEL, reviewed = false, generatedAt }) {
  return {
    version: GENERATED_VERSION,
    source,
    generatedAt: generatedAt ?? new Date().toISOString(),
    model,
    reviewed,
    items,
  };
}

/**
 * 생성물을 파일로 굳힌다. 끝에 개행을 붙여 diff 가 깔끔하게 나오게 한다.
 * @param {object} doc
 * @param {{path?: string}} [options] 기본값은 `public/data/generated/<source>.json`
 * @returns {string} 쓴 파일 경로
 */
export function saveGeneratedDoc(doc, options = {}) {
  const path = options.path ?? generatedPath(doc.source);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  return path;
}

const isFilled = (value) => typeof value === 'string' && value.trim() !== '';

/** `2026-09-03T12:00:00.000Z` 처럼 되읽을 수 있는 ISO 시각인가 */
function isIsoTimestamp(value) {
  if (typeof value !== 'string') return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

/**
 * @typedef {object} ContractIssue
 * @property {string} path 위반 위치 (`items[3].answer` 같은)
 * @property {string} message 사람이 읽을 설명
 */

/**
 * 생성물이 계약을 지키는지 기계 검증한다.
 *
 * 잡는 것: 봉투 필드, 항목의 필수 필드·여분 필드·빈 값, id 중복, **원본 id 와의 충돌**,
 * `variantOf` 가 실제 원본을 가리키는지, id 가 `variantOf` 로 시작하는지,
 * 드릴 `lang` 이 허용값이고 원본과 같은지.
 *
 * 잡지 못하는 것(사람 검수 몫): 정답이 실제로 맞는지, 원본과 내용이 겹치는지,
 * 난이도가 튀는지, 한국어가 자연스러운지. `claudedocs/GENERATED_REVIEW.md` 참조.
 *
 * @param {object} doc 생성물 봉투
 * @param {{originals: Array<object>}} context 같은 source 의 파서 출력
 * @returns {{ok: boolean, issues: ContractIssue[]}}
 */
export function validateGeneratedDoc(doc, { originals = [] } = {}) {
  const issues = [];
  const add = (path, message) => issues.push({ path, message });

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    add('$', '생성물이 객체가 아닙니다.');
    return { ok: false, issues };
  }

  if (doc.version !== GENERATED_VERSION) {
    add('version', `version 은 ${GENERATED_VERSION} 이어야 합니다 (받은 값: ${doc.version}).`);
  }

  const contract = ITEM_CONTRACT[doc.source];
  if (!contract) {
    add('source', `알 수 없는 source 입니다: ${doc.source}`);
  }

  if (!isIsoTimestamp(doc.generatedAt)) {
    add('generatedAt', `generatedAt 은 ISO 8601 시각이어야 합니다 (받은 값: ${doc.generatedAt}).`);
  }

  if (!isFilled(doc.model)) {
    add('model', 'model 이 비었습니다.');
  }

  if (typeof doc.reviewed !== 'boolean') {
    add('reviewed', 'reviewed 는 boolean 이어야 합니다 (검수 전에는 false).');
  }

  if (!Array.isArray(doc.items)) {
    add('items', 'items 는 배열이어야 합니다.');
    return { ok: false, issues };
  }

  if (!contract) return { ok: issues.length === 0, issues };

  const originalById = new Map(originals.map((item) => [item.id, item]));
  const seen = new Set();

  doc.items.forEach((item, index) => {
    const at = `items[${index}]`;

    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      add(at, '항목이 객체가 아닙니다.');
      return;
    }

    for (const field of contract.required) {
      if (!(field in item)) add(`${at}.${field}`, `필수 필드 ${field} 가 없습니다.`);
    }
    for (const field of Object.keys(item)) {
      if (!contract.required.includes(field)) {
        add(`${at}.${field}`, `계약에 없는 필드 ${field} 가 섞였습니다.`);
      }
    }
    for (const field of contract.nonEmpty) {
      if (field in item && !isFilled(item[field])) {
        add(`${at}.${field}`, `${field} 가 비었습니다.`);
      }
    }

    if (item.generated !== true) {
      add(`${at}.generated`, 'generated 는 true 여야 합니다.');
    }

    if (isFilled(item.id)) {
      if (seen.has(item.id)) add(`${at}.id`, `id 가 생성물 안에서 중복됩니다: ${item.id}`);
      seen.add(item.id);
      if (originalById.has(item.id)) {
        add(`${at}.id`, `id 가 원본 문항과 충돌합니다: ${item.id}`);
      }
    }

    const original = isFilled(item.variantOf) ? originalById.get(item.variantOf) : undefined;
    if (isFilled(item.variantOf) && !original) {
      add(`${at}.variantOf`, `variantOf 가 원본에 없는 id 를 가리킵니다: ${item.variantOf}`);
    }

    if (isFilled(item.id) && isFilled(item.variantOf) && !item.id.startsWith(`${item.variantOf}-`)) {
      add(`${at}.id`, `id 는 "<variantOf>-v<n>" 이어야 합니다: ${item.id} (variantOf ${item.variantOf})`);
    }

    if (doc.source === 'codedrill' && isFilled(item.lang)) {
      if (!ALLOWED_LANGS.includes(item.lang)) {
        add(`${at}.lang`, `lang 은 ${ALLOWED_LANGS.join('/')} 중 하나여야 합니다: ${item.lang}`);
      } else if (original && original.lang !== item.lang) {
        add(`${at}.lang`, `lang 이 원본과 다릅니다: ${item.lang} (원본 ${original.lang})`);
      }
    }
  });

  return { ok: issues.length === 0, issues };
}
