// 코드트레이싱_드릴.md → [{id, title, context, code, lang, answer, expectedOutput, pitfall}]
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
  const lines = mdText.split(/\r?\n/);
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

      // 이 문제의 영역: 다음 문제 헤딩 직전까지 (코드/정답 블록이 없는 문제가
      // 다음 문제의 것을 가져오지 않도록 경계를 둔다)
      let end = i + 1;
      while (end < lines.length && !lines[end].startsWith('### ')) end++;

      // 지문 영역: <details> 직전까지. 정답 블록 안의 코드펜스를 문제 코드로
      // 오인하지 않도록 경계를 둔다 (S-05·S-08 은 sql 펜스가 정답 쪽에만 있다).
      let detailsStart = i + 1;
      while (detailsStart < end && !lines[detailsStart].includes('<details>')) detailsStart++;

      // 지문의 코드펜스를 모두 수집한다
      const blocks = [];
      let j = i + 1;
      while (j < detailsStart) {
        if (lines[j].startsWith('```')) {
          // lines[j] 는 여는 코드펜스(```c, ```sql 등) — 뒤에 붙은 언어 표기를 태그로 쓴다
          const tag = lines[j].slice(3).trim();
          const body = [];
          j++;
          while (j < detailsStart && !lines[j].startsWith('```')) {
            body.push(lines[j]);
            j++;
          }
          blocks.push({ tag, text: body.join('\n').trim() });
        }
        j++;
      }

      // 문제의 코드 = 언어 태그가 붙은 마지막 펜스, 태그가 하나도 없으면 마지막 펜스.
      // SQL 문제는 [예제 테이블(태그 없음), 쿼리(```sql)] 두 펜스라 쿼리가 code 가 된다.
      // 나머지 펜스(예제 테이블·조건 지문)는 context 로 보존해 화면에 함께 띄운다.
      let codeIdx = blocks.length - 1;
      for (let k = blocks.length - 1; k >= 0; k--) {
        if (blocks[k].tag) {
          codeIdx = k;
          break;
        }
      }
      const code = codeIdx >= 0 ? blocks[codeIdx].text : '';
      const context = blocks
        .filter((_, k) => k !== codeIdx)
        .map((b) => b.text)
        .join('\n\n');

      // details 블록 내 정답 + 함정
      j = detailsStart;
      let answer = '';
      let pitfall = '';
      let inDetails = false;
      while (j < end) {
        if (lines[j].includes('<details>')) {
          inDetails = true;
          j++;
          if (j < end && lines[j].includes('<summary>')) j++;
          continue;
        }
        if (lines[j].includes('</details>')) break;
        if (inDetails) {
          // 함정 라인 감지 — 라벨(함정/핵심/포인트/암기/최다출제 함정 …)을 목록으로
          // 고정하지 않고 `**라벨**: 본문` 이라는 한 줄 요약 패턴으로 판정한다.
          // 콜론 뒤 본문이 비면(예: `**암기**:` 다음 줄부터 목록이 이어지는 S-08)
          // 한 줄 요약이 아니므로 라벨 줄째로 answer 에 남겨 원문대로 보이게 한다.
          const pitfallMatch = lines[j].match(/^\*\*[^*]+\*\*\s*:\s*(\S.*)$/);
          if (pitfallMatch) pitfall = pitfallMatch[1];
          else {
            answer += lines[j] + '\n';
          }
        }
        j++;
      }

      // answer에서 "출력:" 부분 추출 — 줄 첫머리의 `출력:` 만 본다.
      // 낱말 경계가 없으면 `"P1 " 출력` 이나 `출력 형식을 묻지 않는다` 같은
      // 문장 속 "출력" 뒤를 결과값으로 오인한다.
      let expectedOutput = '';
      // `m` 플래그를 쓰면 종료 조건의 `$` 가 줄 끝마다 걸려 여러 줄 출력이
      // 첫 줄에서 잘리므로, 줄머리 판정은 `(?:^|\n)` 으로 직접 한다.
      const outputMatch = answer.match(/(?:^|\n)출력[ \t]*:[ \t]*\n?([\s\S]*?)(?:\n```|$)/);
      if (outputMatch) {
        expectedOutput = outputMatch[1].trim();
      }

      problems.push({
        id,
        title,
        context,
        code,
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
