// @vitest-environment jsdom
//
// `?id=` 딥링크 파라미터를 읽는 규칙 (BLUEPRINT §5 Phase 2 "문항 단위 딥링크").
//
// 이 값은 URL 에서 온다 — 계획 카드가 만든 링크일 수도, 사람이 주소창에서 고친
// 값일 수도 있다. 그래서 "없음"과 "못 찾음"을 갈라야 한다:
//   없음   → 지금까지와 똑같이 첫 문항에서 시작한다 (안내 없음)
//   못 찾음 → 첫 문항으로 떨어지되 **왜 다른 문항이 열렸는지 말해 준다**
import { describe, it, expect } from 'vitest';
import { readDeepLinkId, formatDeepLinkId } from '../src/hooks/useDeepLink.js';

describe('readDeepLinkId', () => {
  it('평범한 교재 id 는 그대로 통과시킨다', () => {
    expect(readDeepLinkId('042')).toBe('042');
    expect(readDeepLinkId('C-01')).toBe('C-01');
    expect(readDeepLinkId('B07')).toBe('B07');
    expect(readDeepLinkId('042-v1')).toBe('042-v1');
  });

  it('앞뒤 공백은 지운다 — 링크를 손으로 복사하면 붙는다', () => {
    expect(readDeepLinkId('  C-01  ')).toBe('C-01');
  });

  it('파라미터가 없으면 null — 딥링크 자체가 없는 상태다', () => {
    expect(readDeepLinkId(null)).toBeNull();
    expect(readDeepLinkId(undefined)).toBeNull();
  });

  it('빈 값·공백뿐인 값도 null 로 본다 (`?id=` 만 남은 URL)', () => {
    expect(readDeepLinkId('')).toBeNull();
    expect(readDeepLinkId('   ')).toBeNull();
    expect(readDeepLinkId('\t\n')).toBeNull();
  });

  it('문자열이 아닌 값은 null 로 본다', () => {
    expect(readDeepLinkId(42)).toBeNull();
    expect(readDeepLinkId({})).toBeNull();
    expect(readDeepLinkId([])).toBeNull();
  });

  // 이 값으로는 fetch 경로를 만들지 않는다 — 배열을 훑을 뿐이다.
  // 그래서 이상한 값을 거절하는 대신 **못 찾았다고 말해 주는** 쪽을 택한다.
  it('경로 문자·특수문자가 섞여도 거르지 않고 그대로 찾아본다', () => {
    expect(readDeepLinkId('../../etc/passwd')).toBe('../../etc/passwd');
    expect(readDeepLinkId('<script>')).toBe('<script>');
    expect(readDeepLinkId('C-01; DROP TABLE')).toBe('C-01; DROP TABLE');
  });

  it('아주 긴 값도 그대로 받는다 (표시할 때 자른다)', () => {
    const long = 'x'.repeat(5000);
    expect(readDeepLinkId(long)).toBe(long);
  });
});

describe('formatDeepLinkId', () => {
  it('짧은 id 는 그대로 보여 준다', () => {
    expect(formatDeepLinkId('C-01')).toBe('C-01');
  });

  it('긴 id 는 잘라서 보여 준다 — 안내 문구가 화면을 밀어내면 안 된다', () => {
    const shown = formatDeepLinkId('x'.repeat(5000));
    expect(shown.length).toBeLessThanOrEqual(25);
    expect(shown.endsWith('…')).toBe(true);
  });

  it('개행·탭은 한 칸 공백으로 접는다 — 안내가 여러 줄로 번지지 않게', () => {
    expect(formatDeepLinkId('C\n01\t02')).toBe('C 01 02');
  });
});
