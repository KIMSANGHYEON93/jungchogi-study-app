// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import AiExplainPanel from '../src/components/AiExplainPanel.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const encoder = new TextEncoder();

function render(props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(createElement(AiExplainPanel, props)));
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

function sseResponse(frames) {
  const body = new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
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

describe('AiExplainPanel', () => {
  it('출처를 못 찾은 문항(source=null)에서는 아무것도 그리지 않는다', () => {
    const { container, unmount } = render({ source: null, id: 'C-07' });

    expect(container.textContent).toBe('');
    expect(container.querySelector('button')).toBeNull();

    unmount();
  });

  it('유휴 상태에서는 문항을 식별할 수 있는 이름의 해설 요청 버튼만 있다', () => {
    const { container, unmount } = render({ source: 'codedrill', id: 'C-07' });

    const button = buttonByName(container, '해설');
    expect(button).toBeTruthy();
    expect(button.getAttribute('aria-label')).toBe('AI 해설 생성 (C-07번 문항)');
    expect(fetchMock).not.toHaveBeenCalled();

    unmount();
  });

  it('버튼을 누르면 문항 컨텍스트를 실어 요청하고 받은 해설을 그린다', async () => {
    fetchMock.mockResolvedValue(
      sseResponse(['data: {"delta":"# 풀이\\n\\n**정규화**"}\n\n', 'data: {"done":true}\n\n'])
    );
    const { container, unmount } = render({ source: 'codedrill', id: 'C-07', userAnswer: '30 50' });

    await act(async () => { buttonByName(container, '해설 생성').click(); });
    await flush();

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      source: 'codedrill',
      id: 'C-07',
      userAnswer: '30 50',
      history: [],
    });

    const output = container.querySelector('.ai-explain-output');
    // 마크다운은 기존 MarkdownViewer 로 그린다 — 헤딩·강조가 태그로 살아 있어야 한다
    expect(output.querySelector('h1').textContent).toBe('풀이');
    expect(output.querySelector('strong').textContent).toBe('정규화');

    unmount();
  });

  it('스트리밍 영역은 polite 라이브 영역이고 진행 중에는 aria-busy 로 낭독을 미룬다', async () => {
    let streamCtrl;
    fetchMock.mockResolvedValue(
      new Response(new ReadableStream({ start(c) { streamCtrl = c; } }), { status: 200 })
    );
    const { container, unmount } = render({ source: 'codedrill', id: 'C-07' });

    await act(async () => { buttonByName(container, '해설 생성').click(); });
    streamCtrl.enqueue(encoder.encode('data: {"delta":"진행 중"}\n\n'));
    await flush();

    const output = container.querySelector('.ai-explain-output');
    expect(output.getAttribute('aria-live')).toBe('polite');
    expect(output.getAttribute('aria-busy')).toBe('true');
    // 중단 버튼은 평범한 button 이라 키보드로 닿는다
    const cancelButton = buttonByName(container, '중단');
    expect(cancelButton.tagName).toBe('BUTTON');
    expect(cancelButton.getAttribute('disabled')).toBeNull();

    await act(async () => { cancelButton.click(); });
    await flush();

    expect(container.querySelector('.ai-explain-output').getAttribute('aria-busy')).toBe('false');
    expect(container.textContent).toContain('여기까지 받은 내용만 남아 있습니다');

    unmount();
  });

  it.each([
    [401, 'UNAUTHORIZED', '접근 코드'],
    [429, 'RATE_LIMITED', '잠시 후 다시'],
    [400, 'BAD_REQUEST', '해설을 만들 수 없습니다'],
    [502, 'UPSTREAM', '응답을 받지 못했습니다'],
  ])('%i 오류는 사람이 읽을 수 있는 안내로 바꿔 보여준다', async (status, code, guide) => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code, message: 'internal detail' } }), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    );
    const { container, unmount } = render({ source: 'codedrill', id: 'C-07' });

    await act(async () => { buttonByName(container, '해설 생성').click(); });
    await flush();

    expect(container.textContent).toContain(guide);
    // 서버의 개발자용 메시지를 그대로 노출하지 않는다
    expect(container.textContent).not.toContain('internal detail');
    expect(buttonByName(container, '다시 시도')).toBeTruthy();

    unmount();
  });

  it('완료되면 usage 를 요약해 보여준다 — 캐시 적중 확인용', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: {"delta":"끝"}\n\n',
        'data: {"done":true,"usage":{"input_tokens":120,"cache_read_input_tokens":3000,"output_tokens":40}}\n\n',
      ])
    );
    const { container, unmount } = render({ source: 'codedrill', id: 'C-07' });

    await act(async () => { buttonByName(container, '해설 생성').click(); });
    await flush();

    expect(container.textContent).toContain('입력 120');
    expect(container.textContent).toContain('캐시 3000');
    expect(container.textContent).toContain('출력 40');

    unmount();
  });
});
