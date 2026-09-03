// @vitest-environment jsdom
//
// 변형 문항 표시. 원본과 구분되지 않으면 학습자가 AI 가 만든 정답을
// 교재 정답으로 오인한다 — 이 앱에서 가장 직접적인 해악이다.
import { describe, it, expect, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import GeneratedBadge, { GeneratedAnswerNotice } from '../src/components/GeneratedBadge.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function render(node) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return container;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('GeneratedBadge', () => {
  it('변형 문항에는 배지를 붙인다', () => {
    const c = render(createElement(GeneratedBadge, { item: { id: '001-v1', generated: true } }));
    expect(c.textContent).toContain('AI 변형');
  });

  it('교재 문항에는 아무것도 그리지 않는다', () => {
    const c = render(createElement(GeneratedBadge, { item: { id: '001' } }));
    expect(c.innerHTML).toBe('');
  });

  it('문항이 없으면 아무것도 그리지 않는다', () => {
    expect(render(createElement(GeneratedBadge, { item: null })).innerHTML).toBe('');
  });

  it('VIVARA 배지 토큰을 쓴다', () => {
    const c = render(createElement(GeneratedBadge, { item: { id: '001-v1', generated: true } }));
    const badge = c.querySelector('span');
    expect(badge.className).toContain('badge');
    expect(badge.className).toContain('badge-accent');
  });
});

describe('GeneratedAnswerNotice', () => {
  it('변형 문항의 정답에는 교재와 다를 수 있다고 알린다', () => {
    // 배지만으로는 부족하다 — 정답을 읽는 그 순간에 다시 말해야 한다
    const c = render(createElement(GeneratedAnswerNotice, { item: { id: '001-v1', generated: true } }));
    expect(c.textContent).toContain('AI');
    expect(c.textContent).toContain('교재');
  });

  it('교재 문항에는 아무것도 그리지 않는다', () => {
    expect(render(createElement(GeneratedAnswerNotice, { item: { id: '001' } })).innerHTML).toBe('');
  });
});
