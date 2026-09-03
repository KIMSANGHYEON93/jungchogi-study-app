// @vitest-environment jsdom
//
// AI 채점 패널. 두 가지가 이 컴포넌트의 존재 이유다.
//   1) confidence 가 낮으면 판정을 확정으로 내밀지 않는다 (BLUEPRINT §4.2)
//   2) 서버가 없거나 실패해도 패널 안에서만 끝난다 — 감싸는 화면의 학습 흐름은 그대로다
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import AiGradePanel from '../src/components/AiGradePanel.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PROPS = { source: 'codedrill', id: 'C-07', kind: 'code', userAnswer: '1 2 3' };

function render(props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(createElement(AiGradePanel, props)));
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

/** 화면에 보이는 이름(텍스트 또는 aria-label)으로 버튼을 찾는다 */
function buttonByName(container, name) {
  return [...container.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-label')?.includes(name) || b.textContent.includes(name)
  );
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function grade(overrides = {}) {
  return {
    verdict: 'correct',
    score: 100,
    feedback: '출력 순서까지 정확합니다.',
    missedPoints: [],
    confidence: 0.9,
    ...overrides,
  };
}

let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('AiGradePanel — 유휴 상태', () => {
  it('출처나 종류를 못 찾은 문항에서는 아무것도 그리지 않는다', () => {
    const a = render({ ...PROPS, source: null });
    expect(a.container.textContent).toBe('');
    a.unmount();

    const b = render({ ...PROPS, kind: null });
    expect(b.container.textContent).toBe('');
    b.unmount();
  });

  it('화면을 여는 것만으로는 요청하지 않는다 — AI 비용은 사용자 행동에서만 난다', () => {
    const { container, unmount } = render(PROPS);

    expect(buttonByName(container, '채점')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    unmount();
  });
});

describe('AiGradePanel — 채점 결과 표시', () => {
  it('버튼을 누르면 문항과 답안을 실어 요청하고 판정을 그린다', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(grade({ verdict: 'partial', score: 60, feedback: '두 번째 값이 다릅니다.', missedPoints: ['후위 증가'] }))
    );
    const { container, unmount } = render(PROPS);

    await act(async () => { buttonByName(container, '채점 요청').click(); });
    await flush();

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      kind: 'code',
      source: 'codedrill',
      id: 'C-07',
      userAnswer: '1 2 3',
    });
    expect(container.textContent).toContain('부분 정답');
    expect(container.textContent).toContain('60');
    expect(container.textContent).toContain('두 번째 값이 다릅니다.');
    expect(container.textContent).toContain('후위 증가');

    unmount();
  });

  it('확신이 충분하면 결과를 호출부에 넘긴다 — 저장은 화면이 한다', async () => {
    fetchMock.mockResolvedValue(jsonResponse(grade({ confidence: 0.9 })));
    const onResult = vi.fn();
    const { container, unmount } = render({ ...PROPS, onResult });

    await act(async () => { buttonByName(container, '채점 요청').click(); });
    await flush();

    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0][0]).toMatchObject({ verdict: 'correct', confidence: 0.9 });

    unmount();
  });
});

describe('AiGradePanel — confidence 폴백 (§4.2)', () => {
  it('confidence 가 0.6 미만이면 확신이 낮다고 알리고 직접 확인을 요청한다', async () => {
    fetchMock.mockResolvedValue(jsonResponse(grade({ verdict: 'incorrect', confidence: 0.59 })));
    const { container, unmount } = render(PROPS);

    await act(async () => { buttonByName(container, '채점 요청').click(); });
    await flush();

    expect(container.textContent).toContain('확신');
    expect(container.textContent).toContain('직접');
    // AI 의견 자체는 참고로 보여준다
    expect(container.textContent).toContain('참고');

    unmount();
  });

  it('0.6 이면 확정으로 쓴다 — 경계는 도메인 상수 하나로만 정해진다', async () => {
    fetchMock.mockResolvedValue(jsonResponse(grade({ confidence: 0.6 })));
    const { container, unmount } = render(PROPS);

    await act(async () => { buttonByName(container, '채점 요청').click(); });
    await flush();

    expect(container.textContent).not.toContain('확신이 낮');

    unmount();
  });

  it('확신이 낮아도 결과는 호출부에 넘긴다 — 확정할지는 화면이 판단한다', async () => {
    fetchMock.mockResolvedValue(jsonResponse(grade({ confidence: 0.2 })));
    const onResult = vi.fn();
    const { container, unmount } = render({ ...PROPS, onResult });

    await act(async () => { buttonByName(container, '채점 요청').click(); });
    await flush();

    expect(onResult.mock.calls[0][0].confidence).toBe(0.2);

    unmount();
  });
});

describe('AiGradePanel — 실패해도 학습은 이어진다', () => {
  it.each([
    [401, 'UNAUTHORIZED', '접근 코드'],
    [429, 'RATE_LIMITED', '잠시 후'],
    [400, 'BAD_REQUEST', '채점할 수 없습니다'],
    [502, 'UPSTREAM', '다시 시도'],
  ])('%i 오류는 사람이 읽을 수 있는 안내로 바꿔 보여준다', async (status, code, guide) => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code, message: 'internal detail' } }, status));
    const { container, unmount } = render(PROPS);

    await act(async () => { buttonByName(container, '채점 요청').click(); });
    await flush();

    expect(container.textContent).toContain(guide);
    expect(container.textContent).not.toContain('internal detail');
    expect(buttonByName(container, '다시 시도')).toBeTruthy();

    unmount();
  });

  it('서버에 닿지 못하면 직접 채점하라고 안내한다', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const onResult = vi.fn();
    const { container, unmount } = render({ ...PROPS, onResult });

    await act(async () => { buttonByName(container, '채점 요청').click(); });
    await flush();

    expect(container.textContent).toContain('직접');
    expect(onResult).not.toHaveBeenCalled();

    unmount();
  });
});

describe('AiGradePanel — 진행 표시와 취소', () => {
  it('채점 중에는 중단 버튼이 있고, 누르면 조용히 멈춘다', async () => {
    let rejectFetch;
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          rejectFetch = reject;
          init.signal.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          );
        })
    );
    const { container, unmount } = render(PROPS);

    await act(async () => { buttonByName(container, '채점 요청').click(); });
    expect(container.textContent).toContain('채점하는 중');

    const cancelButton = buttonByName(container, '중단');
    expect(cancelButton).toBeTruthy();

    await act(async () => { cancelButton.click(); });
    await flush();

    expect(container.textContent).toContain('중단');
    expect(container.textContent).not.toContain('오류');
    expect(typeof rejectFetch).toBe('function');

    unmount();
  });
});
