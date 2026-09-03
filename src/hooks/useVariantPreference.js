import { useCallback, useState } from 'react';
import { getIncludeVariants, setIncludeVariants } from '../utils/storage';

/**
 * "AI 변형 문제를 학습에 포함할지" 설정을 읽고 쓴다.
 *
 * 학습 화면 여러 곳이 같은 설정을 쓰므로 저장·복원을 한 곳에 모은다.
 * effect 없이 초기값을 읽고 이벤트 핸들러에서만 바꾼다 —
 * effect 안에서 setState 하면 react-hooks 의 `set-state-in-effect` 위반이다.
 *
 * @returns {[boolean, (next: boolean) => void]}
 */
export default function useVariantPreference() {
  const [enabled, setEnabled] = useState(getIncludeVariants);

  const change = useCallback((next) => {
    const on = next === true;
    setEnabled(on);
    setIncludeVariants(on);
  }, []);

  return [enabled, change];
}
