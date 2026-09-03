// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import VariantToggle from '../src/components/VariantToggle.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function render(props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(createElement(VariantToggle, props)));
  return container;
}

const button = (c) => c.querySelector('button');

afterEach(() => {
  document.body.innerHTML = '';
});

describe('VariantToggle', () => {
  it('쓸 수 있는 변형이 없으면 아무것도 그리지 않는다', () => {
    // 눌러도 아무 일이 없는 설정을 띄우면 사용자는 기능이 고장 났다고 읽는다
    expect(render({ enabled: false, available: 0, onChange: () => {} }).innerHTML).toBe('');
  });

  it('켜 둔 상태라면 변형이 사라져도 끌 수 있게 남겨 둔다', () => {
    // 생성물이 회수됐는데 설정만 켜져 있으면 끄는 방법이 없어진다
    const c = render({ enabled: true, available: 0, onChange: () => {} });
    expect(button(c)).not.toBeNull();
  });

  it('쓸 수 있는 변형 수를 함께 보여준다', () => {
    const c = render({ enabled: false, available: 12, onChange: () => {} });
    expect(c.textContent).toContain('12');
  });

  it('켜짐/꺼짐을 aria-pressed 로 알린다', () => {
    expect(button(render({ enabled: false, available: 3, onChange: () => {} })).getAttribute('aria-pressed')).toBe('false');
    expect(button(render({ enabled: true, available: 3, onChange: () => {} })).getAttribute('aria-pressed')).toBe('true');
  });

  it('꺼진 상태에서 누르면 켜 달라고 알린다', () => {
    const onChange = vi.fn();
    const c = render({ enabled: false, available: 3, onChange });
    act(() => button(c).click());
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('켜진 상태에서 누르면 꺼 달라고 알린다', () => {
    const onChange = vi.fn();
    const c = render({ enabled: true, available: 3, onChange });
    act(() => button(c).click());
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('켜져 있으면 필터 바의 active 표시를 쓴다', () => {
    expect(button(render({ enabled: true, available: 3, onChange: () => {} })).className).toContain('active');
    expect(button(render({ enabled: false, available: 3, onChange: () => {} })).className).not.toContain('active');
  });
});
