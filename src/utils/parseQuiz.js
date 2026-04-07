// 단답형_100선.md → [{id, question, answer, category}]
export function parseQuiz(mdText) {
  const questions = [];
  let currentCategory = '';

  // 카테고리 매핑
  const categoryMap = {
    'A': '데이터베이스',
    'B': '소프트웨어공학',
    'C': '디자인패턴/UML',
    'D': '테스트',
    'E': '보안/네트워크',
    'F': 'OS/기타',
  };

  const lines = mdText.split('\n');
  let i = 0;

  while (i < lines.length) {
    // 카테고리 감지: ## A. or ## B. etc
    const catMatch = lines[i].match(/^## ([A-F])\./);
    if (catMatch) {
      currentCategory = categoryMap[catMatch[1]] || catMatch[1];
    }

    // 문제 감지: ### 001. 제목
    const qMatch = lines[i].match(/^### (\d{3})\.\s*(.+)/);
    if (qMatch) {
      const id = qMatch[1];
      const question = qMatch[2].trim();

      // details 블록 내 정답 수집
      let answer = '';
      let inDetails = false;
      let j = i + 1;
      while (j < lines.length) {
        if (lines[j].includes('<details>')) {
          inDetails = true;
          j++;
          // skip <summary> line
          if (j < lines.length && lines[j].includes('<summary>')) j++;
          continue;
        }
        if (lines[j].includes('</details>')) break;
        if (inDetails) {
          answer += lines[j] + '\n';
        }
        j++;
      }

      questions.push({
        id,
        question,
        answer: answer.trim(),
        category: currentCategory,
      });
    }
    i++;
  }

  return questions;
}
