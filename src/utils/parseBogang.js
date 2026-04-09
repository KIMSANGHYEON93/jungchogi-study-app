// 보강_기출분석_암기119선.md → [{id, question, answer, category}]
export function parseBogang(mdText) {
  const cards = [];

  const categoryMap = {
    'C언어': 'OS/기타',
    '연산자': 'OS/기타',
    '프로그래밍': 'OS/기타',
    '객체지향': '디자인패턴/UML',
    'DFD': '소프트웨어공학',
    'UML': '디자인패턴/UML',
    '데이터 모델': '데이터베이스',
    '함수적 종속': '데이터베이스',
    '인덱스': '데이터베이스',
    '연계': '소프트웨어공학',
    '서버': '소프트웨어공학',
    'UI': '소프트웨어공학',
    '테스트': '테스트',
    '화이트박스': '테스트',
    '소스코드': '소프트웨어공학',
    '비용': '소프트웨어공학',
    'DoS': '보안/네트워크',
    '보안': '보안/네트워크',
    '암호화': '보안/네트워크',
    'OS': 'OS/기타',
    '관계 DB': '데이터베이스',
    '네트워크': '보안/네트워크',
    '패키징': '소프트웨어공학',
    '기출': 'OS/기타',
  };

  const lines = mdText.split('\n');
  let i = 0;

  while (i < lines.length) {
    // "### 보강 N: 제목" 패턴 감지
    const match = lines[i].match(/^### 보강 (\d+):\s*(.+)/);
    if (match) {
      const id = `B${match[1].padStart(2, '0')}`;
      const question = match[2].replace(/\[.*?\]/g, '').trim();

      // 내용 수집: 다음 "### 보강" 또는 "## Part" 전까지
      let answer = '';
      let j = i + 1;
      while (j < lines.length) {
        if (lines[j].match(/^### 보강 \d+/) || lines[j].match(/^## Part/)) break;
        answer += lines[j] + '\n';
        j++;
      }

      // 카테고리 결정
      let category = 'OS/기타';
      for (const [keyword, cat] of Object.entries(categoryMap)) {
        if (question.includes(keyword)) {
          category = cat;
          break;
        }
      }

      cards.push({
        id,
        question: `[보강] ${question}`,
        answer: answer.trim().replace(/^---\s*$/gm, '').trim(),
        category,
      });
    }
    i++;
  }

  return cards;
}
