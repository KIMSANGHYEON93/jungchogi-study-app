// 문제 지문 블록 — SQL 드릴의 예제 테이블처럼 "코드가 아닌 지문"을 보여준다.
// 문제 코드(SyntaxHighlighter)와 달리 구문 강조 없이 원문 그대로 출력한다.
export default function ProblemContext({ text, fontSize = '0.85rem' }) {
  if (!text) return null;

  return (
    <pre
      className="quiz-code"
      style={{ fontSize, margin: '0 0 12px', whiteSpace: 'pre', color: 'var(--text-dim)' }}
    >
      {text}
    </pre>
  );
}
