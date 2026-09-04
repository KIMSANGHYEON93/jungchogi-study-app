// @vitest-environment jsdom
//
// AI 사용량 카드. **기록이 하나도 없는 것이 기본 상태다** — 아직 아무도 AI 를
// 쓰지 않았을 때 0 이 늘어선 표가 뜨면 안 된다.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import UsageSummaryCard from '../src/components/UsageSummaryCard.jsx';
import { recordUsage, getUsageEntries } from '../src/utils/usageLedger.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function render() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(createElement(UsageSummaryCard)));
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** 화면에 보이는 이름(텍스트 또는 aria-label)으로 버튼을 찾는다 */
function buttonByName(container, name) {
  return [...container.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-label')?.includes(name) || b.textContent.includes(name)
  );
}

function click(node) {
  act(() => {
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function cost(overrides = {}) {
  return {
    ts: new Date().toISOString(),
    endpoint: 'tutor',
    model: 'claude-opus-5',
    effort: 'medium',
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 3000,
    cacheCreationTokens: 0,
    costUsd: 0.01,
    latencyMs: 8000,
    ok: true,
    errorCode: null,
    ...overrides,
  };
}

let view;

beforeEach(() => {
  localStorage.clear();
  view = null;
});

afterEach(() => {
  view?.unmount();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('빈 상태 — 기록이 하나도 없을 때', () => {
  it('숫자 표 대신 한 줄 안내를 보여준다', () => {
    view = render();
    const text = view.container.textContent;

    expect(text).toContain('AI 사용량');
    expect(text).toContain('아직 AI 기능을 사용한 기록이 없습니다');
    // 0 이 늘어선 표가 뜨면 안 된다
    expect(text).not.toContain('오늘');
    expect(text).not.toContain('캐시 적중률');
    expect(text).not.toContain('$');
  });

  it('비울 것도 내보낼 것도 없으므로 버튼을 띄우지 않는다', () => {
    view = render();
    expect(buttonByName(view.container, '비우기')).toBeUndefined();
    expect(buttonByName(view.container, '내보내기')).toBeUndefined();
  });
});

describe('기록이 있을 때', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T03:00:00.000Z')); // KST 12:00
    const DAY = 24 * 60 * 60 * 1000;
    // 오늘 2건 (해설·채점), 이번 주 1건 (플래너), 그보다 오래된 1건
    recordUsage(cost({ endpoint: 'tutor', costUsd: 0.02 }), {});
    recordUsage(cost({ endpoint: 'grade', costUsd: 0.01, cacheReadTokens: 1000, inputTokens: 1000 }), {});
    recordUsage(cost({ endpoint: 'plan', costUsd: 0.07, ts: new Date(Date.now() - 2 * DAY).toISOString() }), {});
    recordUsage(cost({ endpoint: 'tutor', costUsd: 0.9, ts: new Date(Date.now() - 30 * DAY).toISOString() }), {});
  });

  it('오늘·이번 주·전체 비용을 나눠 보여준다', () => {
    view = render();
    const text = view.container.textContent;

    expect(text).toContain('오늘');
    expect(text).toContain('이번 주');
    expect(text).toContain('전체');
    expect(text).toContain('$0.0300'); // 오늘 = 0.02 + 0.01
    expect(text).toContain('$0.1000'); // 이번 주 = + 0.07
    expect(text).toContain('$1.00'); // 전체 = + 0.9
  });

  it('비용이 추정치임을 밝힌다', () => {
    view = render();
    expect(view.container.textContent).toContain('추정');
  });

  it('엔드포인트별로 호출 수와 비용을 분해한다', () => {
    view = render();
    const text = view.container.textContent;

    expect(text).toContain('해설');
    expect(text).toContain('플래너');
    expect(text).toContain('채점');
    // 해설 2건(오늘 1 + 30일 전 1), 플래너 1건, 채점 1건
    expect(text).toMatch(/해설[\s\S]*?2회/);
    expect(text).toMatch(/플래너[\s\S]*?1회/);
  });

  it('쓰이지 않은 엔드포인트는 줄을 만들지 않는다', () => {
    view = render();
    expect(view.container.textContent).not.toContain('생성');
  });

  it('캐시 적중률을 보여준다', () => {
    view = render();
    const text = view.container.textContent;
    expect(text).toContain('캐시 적중률');
    // 전체 입력 = (1000+3000) + (1000+1000) + (1000+3000) + (1000+3000) = 14000
    // 캐시 읽기 = 3000 + 1000 + 3000 + 3000 = 10000 → 71%
    expect(text).toContain('71%');
  });
});

describe('캐시 적중률 표시', () => {
  it('입력 토큰이 하나도 없으면 0% 가 아니라 — 로 둔다', () => {
    recordUsage(cost({ inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }), {});
    view = render();
    expect(view.container.textContent).toContain('캐시 적중률');
    expect(view.container.textContent).not.toContain('0%');
  });

  it('캐시가 하나도 안 들으면 0% 로 보여준다', () => {
    recordUsage(cost({ inputTokens: 5000, cacheReadTokens: 0, cacheCreationTokens: 0 }), {});
    view = render();
    expect(view.container.textContent).toContain('0%');
  });

  it('전부 캐시에서 읽으면 100% 로 보여준다', () => {
    recordUsage(cost({ inputTokens: 0, cacheReadTokens: 5000, cacheCreationTokens: 0 }), {});
    view = render();
    expect(view.container.textContent).toContain('100%');
  });
});

describe('실패한 호출', () => {
  it('실패가 있으면 건수를 알린다', () => {
    recordUsage(cost({ ok: false, errorCode: 'RATE_LIMITED', costUsd: 0 }), {});
    recordUsage(cost({ ok: true }), {});
    view = render();
    expect(view.container.textContent).toMatch(/실패[\s\S]*?1회/);
  });

  it('실패가 없으면 그 줄을 만들지 않는다', () => {
    recordUsage(cost({ ok: true }), {});
    view = render();
    expect(view.container.textContent).not.toContain('실패');
  });

  it('실패만 있어도 화면이 성립한다', () => {
    recordUsage(cost({ ok: false, errorCode: 'UPSTREAM', costUsd: 0 }), {});
    view = render();
    const text = view.container.textContent;
    expect(text).toContain('캐시 적중률');
    expect(text).toMatch(/실패[\s\S]*?1회/);
  });
});

describe('원장 비우기', () => {
  it('확인을 받고 비운 뒤 빈 상태로 돌아간다', () => {
    recordUsage(cost(), {});
    view = render();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    click(buttonByName(view.container, '비우기'));

    expect(getUsageEntries()).toEqual([]);
    expect(view.container.textContent).toContain('아직 AI 기능을 사용한 기록이 없습니다');
  });

  it('확인을 취소하면 기록이 그대로 남는다', () => {
    recordUsage(cost(), {});
    view = render();
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    click(buttonByName(view.container, '비우기'));

    expect(getUsageEntries()).toHaveLength(1);
    expect(view.container.textContent).not.toContain('아직 AI 기능을 사용한 기록이 없습니다');
  });

  it('학습 데이터는 건드리지 않는다', () => {
    localStorage.setItem('jungchogi_wrong_notes', '[{"id":"042"}]');
    recordUsage(cost(), {});
    view = render();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    click(buttonByName(view.container, '비우기'));

    expect(localStorage.getItem('jungchogi_wrong_notes')).toBe('[{"id":"042"}]');
  });
});

describe('원장 내보내기', () => {
  it('JSON 파일로 내려받는다', () => {
    recordUsage(cost(), {});
    const createObjectURL = vi.fn(() => 'blob:usage');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const anchorClick = vi.spyOn(window.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    view = render();
    click(buttonByName(view.container, '내보내기'));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchorClick).toHaveBeenCalledTimes(1);
  });

  it('내보내도 기록은 그대로 남는다', () => {
    recordUsage(cost(), {});
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    vi.spyOn(window.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    view = render();
    click(buttonByName(view.container, '내보내기'));

    expect(getUsageEntries()).toHaveLength(1);
  });
});

describe('손상된 원장', () => {
  it('저장값이 손상돼 있어도 빈 상태로 그린다 — 대시보드가 통째로 죽으면 안 된다', () => {
    localStorage.setItem('jungchogi_usage_ledger', '{{{ 손상');
    view = render();
    expect(view.container.textContent).toContain('아직 AI 기능을 사용한 기록이 없습니다');
  });
});
