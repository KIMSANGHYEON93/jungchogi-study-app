// 생성물(`public/data/generated/<source>.json`) 로딩 계층.
//
// `mdCache.js` 와 같은 방식이다 — 한 번 읽으면 캐시하고, 화면은 결과만 받는다.
// 다른 점은 **파일이 없는 게 정상 상태**라는 것이다. Phase 4 는 생성물을 커밋해
// 두는 기능이라 아무것도 생성하지 않은 시점이 기본값이고, 그때 404 는 오류가 아니다.
//
// 판정 규칙 자체는 `src/domain/generatedItems.js` 가 갖는다. 여기서는 읽고·캐시하고·
// 개발자용 경고를 콘솔로 흘리는 일만 한다.

import {
  GENERATED_SOURCES,
  acceptGeneratedFile,
  mergeGenerated,
} from '../domain/generatedItems.js';

/** @type {Map<string, Promise<object[]>>} */
const cache = new Map();

/** 테스트에서 캐시를 비운다 */
export function clearGeneratedCache() {
  cache.clear();
}

function warnAll(warnings) {
  warnings.forEach((line) => console.warn(line));
}

function loadOnce(source) {
  return fetch(`/data/generated/${source}.json`)
    .then((res) => {
      // 아직 생성물이 없는 상태 — 경고하지 않는다.
      // (SPA rewrite 가 없는 `/data/` 경로라 없는 파일은 그대로 404 로 온다)
      if (res.status === 404) return [];
      if (!res.ok) {
        console.warn(`[generated:${source}] 생성물을 읽지 못했습니다 (HTTP ${res.status}).`);
        return [];
      }
      return res.text().then((text) => {
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch (err) {
          console.warn(`[generated:${source}] 생성물 JSON 이 손상돼 읽지 못했습니다.`, err);
          return [];
        }
        const { items, warnings } = acceptGeneratedFile(parsed, source);
        warnAll(warnings);
        return items;
      });
    })
    .catch((err) => {
      // 네트워크 실패로 학습 화면이 멈추면 안 된다 — 변형 없이 원본으로 계속 간다
      console.warn(`[generated:${source}] 생성물을 가져오지 못했습니다.`, err);
      return [];
    });
}

/**
 * 검수를 통과한 생성 문항을 읽어 온다.
 *
 * 어떤 실패든 빈 배열로 끝난다 — 변형은 부가 기능이고, 없으면 교재 문항으로 학습하면 된다.
 *
 * @param {string} source `quiz100` | `codedrill` | `bogang`
 * @returns {Promise<object[]>}
 */
export function fetchGeneratedItems(source) {
  // 경로 조각이 그대로 URL 에 들어가므로 화이트리스트 밖은 요청 자체를 하지 않는다
  if (!GENERATED_SOURCES.includes(source)) return Promise.resolve([]);
  if (!cache.has(source)) cache.set(source, loadOnce(source));
  return cache.get(source);
}

/**
 * 원본 덱에 변형을 합쳐 준다. 화면은 이 함수 하나만 부르면 된다.
 *
 * `include` 가 꺼져 있어도 **생성물이 있는지는 확인한다**. 쓸 수 있는 변형이
 * 하나도 없으면 화면이 켜기 버튼 자체를 띄우지 않기 위해서다 — 눌러도 아무 일이
 * 없는 설정을 보여주는 쪽이 요청 한 번보다 나쁘다. 파일은 정적이고 캐시되므로
 * 확인 비용은 교재당 한 번이다.
 *
 * 꺼져 있을 때 `items` 는 원본 **그대로**(같은 배열 참조)다 —
 * 변형 기능을 끈 사용자는 Phase 3 까지와 완전히 같은 화면을 본다.
 *
 * @param {object[]} baseItems 파서가 만든 교재 문항
 * @param {string} source
 * @param {boolean} include 사용자가 변형 포함을 켰는가
 * @returns {Promise<{items: object[], available: number}>}
 *   `available` 은 검수·계약을 모두 통과해 **실제로 쓸 수 있는** 변형 수다
 */
export function applyGeneratedItems(baseItems, source, include) {
  return fetchGeneratedItems(source).then((generated) => {
    const { items, warnings } = mergeGenerated(baseItems, generated, source);
    warnAll(warnings);
    const available = items.length - baseItems.length;
    return { items: include ? items : baseItems, available };
  });
}
