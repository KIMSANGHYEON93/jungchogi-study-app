import Icon from './Icon';

/**
 * AI 변형 문제를 학습에 포함할지 켜고 끄는 버튼.
 *
 * 학습 화면의 필터 바에 둔다 — 설정 화면으로 갔다 오게 하면 "한번 켜 보고
 * 마음에 안 들면 끄는" 사용을 막는다. 기존 필터 버튼과 같은 생김새(`btn-outline`
 * + `active`)라 별도 학습이 필요 없다.
 *
 * **쓸 수 있는 변형이 없으면 그리지 않는다.** 생성물을 아직 커밋하지 않았거나
 * 검수를 통과하지 못한 상태가 기본값이고, 그때 눌러도 아무 일이 없는 설정을
 * 띄우면 사용자는 기능이 고장 났다고 읽는다. 다만 이미 켜 둔 사용자에게는
 * 남겨 둔다 — 끄는 방법까지 사라지면 안 된다.
 *
 * @param {Object} props
 * @param {boolean} props.enabled 지금 포함하고 있는가
 * @param {number} props.available 검수·계약을 통과해 실제로 쓸 수 있는 변형 수
 * @param {(next: boolean) => void} props.onChange
 */
export default function VariantToggle({ enabled, available, onChange }) {
  if (available <= 0 && !enabled) return null;

  return (
    <button
      type="button"
      className={`btn-outline variant-toggle ${enabled ? 'active' : ''}`}
      aria-pressed={enabled}
      aria-label={`AI 변형 문제 포함 (쓸 수 있는 변형 ${available}개)`}
      title="AI 가 교재 문항을 변형해 만든 문제를 학습에 포함합니다"
      onClick={() => onChange(!enabled)}
    >
      <Icon name="zap" size={14} /> AI 변형 {available}개
    </button>
  );
}
