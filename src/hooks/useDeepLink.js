// 문항 단위 딥링크 (`/quiz?id=`, `/flashcard?id=`, `/wrong?id=`).
//
// 학습 플래너(BLUEPRINT §4.3)의 계획 항목은 `ids: ["042","C-07"]` 처럼 **문항을**
// 지목한다. 화면 단위(`/study?day=N`)까지만 열어 주면 사용자가 그 문항을 목록에서
// 직접 찾아야 한다. 여기서 URL 을 문항 커서로 승격시킨다.
//
// 상태 소유권 규칙은 `StudyPage`(`?day=`)·`SearchPage`(`?q=`)의 선례를 따른다:
// **URL 은 첫 렌더에서 한 번만 읽고, 그 뒤로는 사용자 조작이 커서를 소유한다.**
// effect 로 URL 을 상태에 동기화하면 react-hooks 의 `set-state-in-effect` 위반이다.

import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { isGeneratedItem } from '../domain/generatedItems.js';

/** 안내 문구에 실을 id 의 최대 길이. 주소창에는 아무 값이나 들어올 수 있다. */
const DISPLAY_LIMIT = 24;

/**
 * `?id=` 파라미터를 딥링크 대상으로 읽는다.
 *
 * "없음"과 "못 찾음"을 가르는 것이 이 함수의 일이다. 없으면 딥링크 자체가 없는
 * 상태라 화면은 지금까지와 똑같이 동작해야 하고, 있으면 — 그 값이 아무리 이상해도 —
 * 찾아본 뒤 결과를 사용자에게 말해 줘야 한다.
 *
 * 이 값으로 fetch 경로나 저장 키를 만들지 않는다(배열을 훑을 뿐이다). 그래서 서버
 * guard 처럼 형식을 강제하지 않는다 — 거절하는 대신 "못 찾았다"고 알리는 쪽이
 * 사용자에게 더 정확한 정보다.
 *
 * @param {unknown} raw
 * @returns {string|null}
 */
export function readDeepLinkId(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * 안내 문구에 실을 수 있게 id 를 다듬는다.
 * 개행을 접고 길이를 자른다 — 손으로 고친 URL 이 화면을 밀어내면 안 된다.
 *
 * @param {string} id
 * @returns {string}
 */
export function formatDeepLinkId(id) {
  const flat = String(id).replace(/\s+/g, ' ');
  return flat.length > DISPLAY_LIMIT ? `${flat.slice(0, DISPLAY_LIMIT)}…` : flat;
}

/**
 * 이 화면이 지목받은 문항 id. 첫 렌더에서 한 번만 읽는다.
 *
 * @returns {string|null}
 */
export function useDeepLinkId() {
  const [searchParams] = useSearchParams();
  const [id] = useState(() => readDeepLinkId(searchParams.get('id')));
  return id;
}

/**
 * 문항 목록 화면의 커서. 지목받은 문항이 목록에 있으면 거기서 시작한다.
 *
 * 커서를 `useState` 숫자 하나로 두면 목록이 **나중에 도착하는**(md fetch) 화면에서
 * 딥링크를 반영할 방법이 effect 밖에 없다. 그래서 상태는 "사용자가 옮긴 위치"만
 * 담고(`null` = 아직 안 옮김), 실제 위치는 렌더 중에 파생한다.
 *
 * @param {Array<{id?: string}>} items 지금 화면에 보이는 목록(필터·셔플 적용 후)
 * @param {string|null} requestedId `useDeepLinkId()` 가 읽은 값
 * @returns {{index: number, setIndex: (next: number) => void, missedId: string|null}}
 *   `missedId` 는 지목받았지만 목록에 없던 id — 화면은 이걸로 안내를 띄운다
 */
export function useDeepLinkedIndex(items, requestedId) {
  // null = 아직 사용자가 커서를 옮기지 않았다 → 딥링크가 커서를 소유한다
  const [cursor, setCursor] = useState(requestedId === null ? 0 : null);

  const list = Array.isArray(items) ? items : [];
  const found = requestedId === null ? -1 : list.findIndex((item) => item?.id === requestedId);

  // 목록이 아직 비어 있으면 로딩 중이지 "못 찾은" 것이 아니다
  const missedId = requestedId !== null && list.length > 0 && found < 0 ? requestedId : null;

  const wanted = cursor === null ? Math.max(found, 0) : cursor;
  // 필터로 목록이 줄어 커서가 범위를 벗어나면 첫 항목으로 되돌린다
  const index = wanted >= 0 && wanted < list.length ? wanted : 0;

  // 커서는 숫자만 받는다. 파생 위치와 저장된 위치가 다를 수 있어
  // 함수형 갱신을 허용하면 `null` 을 기준으로 계산하게 된다.
  const setIndex = useCallback((next) => {
    setCursor(Number.isInteger(next) && next >= 0 ? next : 0);
  }, []);

  return { index, setIndex, missedId };
}

/**
 * 코드 퀴즈·플래시카드가 함께 쓰는 안내 문구.
 * 두 화면 모두 "첫 문항으로 떨어졌다"가 폴백이고 변형 토글을 갖고 있어 문구가 같다.
 *
 * @param {string|null} missedId
 * @param {{variantsOff?: boolean}} [options]
 * @returns {string} 안내가 필요 없으면 빈 문자열
 */
export function deckDeepLinkNotice(missedId, { variantsOff = false } = {}) {
  if (!missedId) return '';
  // 변형 id 는 토글이 꺼져 있으면 덱에 아예 없다. "없는 문항"과 원인이 달라
  // 사용자가 할 수 있는 일(토글을 켠다)을 함께 알려 준다.
  const hint =
    variantsOff && isGeneratedItem({ id: missedId })
      ? ' AI 변형 문항입니다 — "변형 포함"을 켜면 나타납니다.'
      : '';
  return `URL 이 지정한 ${formatDeepLinkId(missedId)} 문항을 찾지 못해 첫 문항부터 시작합니다.${hint}`;
}
