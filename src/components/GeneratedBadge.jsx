import { isGeneratedItem } from '../domain/generatedItems';

/**
 * "이 문항은 AI 가 만든 변형이다"를 알리는 배지.
 *
 * 원본과 구분되지 않으면 학습자가 AI 가 만든 정답을 교재 정답으로 오인한다.
 * 검수를 통과한 문항만 화면에 오지만, 검수는 사람이 하는 일이고 교재만큼
 * 확실하지는 않다. 그러니 어디서 왔는지는 언제나 보여 준다.
 *
 * VIVARA 의 `--accent` 를 쓴다 — 교재 문항이 이미 쓰는 primary(출처)·
 * warning(언어)·success(카테고리)·danger(오답)와 겹치지 않는 색이다.
 *
 * @param {{item: {id?: string, generated?: unknown}|null|undefined}} props
 */
export default function GeneratedBadge({ item }) {
  if (!isGeneratedItem(item)) return null;
  return (
    <span className="badge badge-accent" title="AI 가 교재 문항을 변형해 만든 문제입니다">
      AI 변형
    </span>
  );
}

/**
 * 변형 문항의 정답 옆에 붙는 주의 문구.
 *
 * 배지는 문항 머리에 있어 정답을 읽는 순간에는 시야 밖일 수 있다.
 * **정답을 외우는 바로 그 자리**에서 한 번 더 알린다.
 *
 * @param {{item: {id?: string, generated?: unknown}|null|undefined}} props
 */
export function GeneratedAnswerNotice({ item }) {
  if (!isGeneratedItem(item)) return null;
  return (
    <p className="generated-notice" role="note">
      AI 가 만든 변형 문제입니다. 정답이 교재와 다를 수 있으니 원본 문항으로 확인하세요.
    </p>
  );
}
