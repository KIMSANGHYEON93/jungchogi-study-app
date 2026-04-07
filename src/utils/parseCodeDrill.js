// 코드트레이싱_드릴.md → [{id, title, code, lang, answer, pitfall}]
export function parseCodeDrill(mdText) {
  const problems = [];

  // Part별 언어 매핑
  const langSections = [
    { pattern: /## Part 1\. C언어/, lang: 'c' },
    { pattern: /## Part 2\. Java/, lang: 'java' },
    { pattern: /## Part 3\. Python/, lang: 'python' },
    { pattern: /## Part 4\. SQL/, lang: 'sql' },
  ];

  let currentLang = 'c';
  const lines = mdText.split('\n');
  let i = 0;

  while (i < lines.length) {
    // 언어 섹션 감지
    for (const sec of langSections) {
      if (sec.pattern.test(lines[i])) {
        currentLang = sec.lang;
      }
    }

    // 문제 감지: ### C-01. 제목 or ### J-01. or ### P-01. or ### S-01.
    const pMatch = lines[i].match(/^### ([CJPS]-\d{2})\.\s*(.+)/);
    if (pMatch) {
      const id = pMatch[1];
      const title = pMatch[2].trim();

      // 코드 블록 수집
      let code = '';
      let j = i + 1;
      // 첫 번째 코드 블록 찾기
      while (j < lines.length && !lines[j].startsWith('```')) j++;
      if (j < lines.length) {
        const langLine = lines[j]; // ```c, ```java, etc
        j++;
        while (j < lines.length && !lines[j].startsWith('```')) {
          code += lines[j] + '\n';
          j++;
        }
      }

      // details 블록 내 정답 + 함정
      let answer = '';
      let pitfall = '';
      let inDetails = false;
      while (j < lines.length) {
        if (lines[j].includes('<details>')) {
          inDetails = true;
          j++;
          if (j < lines.length && lines[j].includes('<summary>')) j++;
          continue;
        }
        if (lines[j].includes('</details>')) break;
        if (inDetails) {
          // 함정 라인 감지
          const pitfallMatch = lines[j].match(/^\*\*함정\*\*[:\s]*(.+)/);
          const pitfallMatch2 = lines[j].match(/^\*\*핵심[^*]*\*\*[:\s]*(.+)/);
          const pitfallMatch3 = lines[j].match(/^\*\*포인트\*\*[:\s]*(.+)/);
          const pitfallMatch4 = lines[j].match(/^\*\*필수[^*]*\*\*[:\s]*(.+)/);
          const pitfallMatch5 = lines[j].match(/^\*\*암기\*\*[:\s]*(.+)/);
          const pitfallMatch6 = lines[j].match(/^\*\*주의\*\*[:\s]*(.+)/);
          const pitfallMatch7 = lines[j].match(/^\*\*체크\*\*[:\s]*(.+)/);
          if (pitfallMatch) pitfall = pitfallMatch[1];
          else if (pitfallMatch2) pitfall = pitfallMatch2[1];
          else if (pitfallMatch3) pitfall = pitfallMatch3[1];
          else if (pitfallMatch4) pitfall = pitfallMatch4[1];
          else if (pitfallMatch5) pitfall = pitfallMatch5[1];
          else if (pitfallMatch6) pitfall = pitfallMatch6[1];
          else if (pitfallMatch7) pitfall = pitfallMatch7[1];
          else {
            answer += lines[j] + '\n';
          }
        }
        j++;
      }

      // answer에서 "출력:" 부분 추출
      let expectedOutput = '';
      const outputMatch = answer.match(/출력[:\s]*\n?([\s\S]*?)(?:\n```|$)/);
      if (outputMatch) {
        expectedOutput = outputMatch[1].trim();
      }

      problems.push({
        id,
        title,
        code: code.trim(),
        lang: currentLang,
        answer: answer.trim(),
        expectedOutput,
        pitfall,
      });
    }
    i++;
  }

  return problems;
}
