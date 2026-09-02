import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parseCodeDrill } from '../src/utils/parseCodeDrill.js';

const sample = readFileSync(
  fileURLToPath(new URL('./fixtures/code-drill-sample.md', import.meta.url)),
  'utf8'
);

const byId = (problems, id) => problems.find((p) => p.id === id);

describe('parseCodeDrill — 실제 콘텐츠 형식', () => {
  it('`### X-NN.` 헤딩을 가진 문제만 추출한다', () => {
    const problems = parseCodeDrill(sample);
    expect(problems.map((p) => p.id)).toEqual(['C-01', 'J-01', 'S-01', 'S-05']);
  });

  it('lang 은 문제 ID 접두사가 아니라 직전 `## Part` 섹션에서 결정된다', () => {
    const problems = parseCodeDrill(sample);
    expect(byId(problems, 'C-01').lang).toBe('c');
    expect(byId(problems, 'J-01').lang).toBe('java');
    expect(byId(problems, 'S-01').lang).toBe('sql');

    // ID 접두사와 섹션이 어긋나면 섹션이 이긴다
    const [mismatched] = parseCodeDrill('## Part 3. Python\n\n### C-01. 제목\n\n```\nx\n```\n');
    expect(mismatched.lang).toBe('python');
  });

  it('Part 섹션 이전 문제의 lang 기본값은 c 다', () => {
    const [p] = parseCodeDrill('### C-01. 제목\n\n```\nx = 1\n```\n');
    expect(p.lang).toBe('c');
  });

  it('title 은 헤딩에서, code 는 첫 코드펜스 내부에서 가져온다', () => {
    const c01 = byId(parseCodeDrill(sample), 'C-01');
    expect(c01.title).toBe('포인터 기본');
    expect(c01.code).toContain('#include <stdio.h>');
    expect(c01.code).toContain('printf("%d %d", a, b);');
    expect(c01.code.startsWith('```')).toBe(false);
    expect(c01.code).not.toContain('```');
  });

  it('details 블록 본문을 answer 로, `**함정**` 류 라인을 pitfall 로 분리한다', () => {
    const c01 = byId(parseCodeDrill(sample), 'C-01');
    expect(c01.answer).toContain('추적표:');
    expect(c01.pitfall).toBe(
      '`*p + b`에서 a가 30으로 바뀐 뒤, 이후 `*p + a`의 a는 이미 30임'
    );
    expect(c01.answer).not.toContain('함정');
  });

  it('라벨 목록에 없던 `**최다출제 함정**` 도 pitfall 로 잡는다', () => {
    const j01 = byId(parseCodeDrill(sample), 'J-01');
    expect(j01.pitfall).toBe('변수=선언타입(부모), 메서드=실제객체(자식). 반드시 구분!');
    expect(j01.answer).not.toContain('최다출제 함정');
  });

  it('라벨은 고정 목록이 아니라 `**...**:` 패턴으로 판정한다', () => {
    const mk = (label) =>
      parseCodeDrill(
        ['### C-01. 제목', '```', 'x', '```', '<details>', '<summary>정답</summary>', `**${label}**: 잡힌다`, '</details>'].join('\n')
      )[0].pitfall;
    expect(mk('함정')).toBe('잡힌다');
    expect(mk('핵심 함정')).toBe('잡힌다');
    expect(mk('필수 암기')).toBe('잡힌다');
    expect(mk('포인트')).toBe('잡힌다');
    expect(mk('주의')).toBe('잡힌다');
    expect(mk('체크')).toBe('잡힌다');
    expect(mk('최다출제 함정')).toBe('잡힌다');
    expect(mk('한 번도 쓴 적 없는 라벨')).toBe('잡힌다');
  });

  it('콜론이 없거나 콜론 뒤가 비면 라벨이 아니라 answer 로 남긴다', () => {
    // S-08 은 `**암기**:` 다음 줄부터 목록이 이어진다. 한 줄짜리 pitfall 이 아니므로
    // 라벨 줄째로 answer 에 남겨 마크다운 목록 그대로 보이게 한다.
    const mk = (lines) =>
      parseCodeDrill(
        ['### C-01. 제목', '```', 'x', '```', '<details>', '<summary>정답</summary>', ...lines, '</details>'].join('\n')
      )[0];

    const empty = mk(['**암기**:', '- GRANT: TO 사용자', '- REVOKE: FROM 사용자']);
    expect(empty.pitfall).toBe('');
    expect(empty.answer).toContain('**암기**:');
    expect(empty.answer).toContain('- GRANT: TO 사용자');

    const noColon = mk(['**참고** 콜론이 없다']);
    expect(noColon.pitfall).toBe('');
    expect(noColon.answer).toContain('**참고** 콜론이 없다');
  });

  it('answer 안의 `출력:` 이후 텍스트를 expectedOutput 으로 뽑는다', () => {
    const problems = parseCodeDrill(sample);
    expect(byId(problems, 'C-01').expectedOutput).toBe('30 50');
    expect(byId(problems, 'J-01').expectedOutput).toBe('10 B');
  });

  it('지문 코드펜스가 둘이면 언어 태그가 붙은 쪽이 code, 나머지는 context 다', () => {
    const s01 = byId(parseCodeDrill(sample), 'S-01');
    expect(s01.code).toContain('SELECT 부서, COUNT(*) AS 인원, AVG(급여) AS 평균');
    expect(s01.code).toContain('HAVING COUNT(*) >= 3;');
    expect(s01.code).not.toContain('테이블: 사원');

    expect(s01.context).toContain('테이블: 사원(이름, 부서, 급여)');
    expect(s01.context).toContain('| 김 | 개발 | 400 |');
    expect(s01.context).not.toContain('SELECT');
  });

  it('지문 코드펜스가 하나뿐이면 그것이 code 이고 context 는 빈 문자열이다', () => {
    const c01 = byId(parseCodeDrill(sample), 'C-01');
    expect(c01.code).toContain('#include <stdio.h>');
    expect(c01.context).toBe('');
  });

  it('`<details>` 안의 코드펜스는 정답이므로 code 로 잡지 않는다', () => {
    // S-05 는 지문이 태그 없는 펜스 하나뿐이고 sql 펜스는 정답 쪽에 있다
    const s05 = byId(parseCodeDrill(sample), 'S-05');
    expect(s05.code).toContain('다음 조건에 맞는 CREATE TABLE 문을 작성하시오:');
    expect(s05.code).not.toContain('CREATE TABLE 학생 (');
    expect(s05.context).toBe('');
    expect(s05.answer).toContain('CREATE TABLE 학생 (');
  });
});

describe('parseCodeDrill — 엣지 케이스', () => {
  it('빈 문자열은 빈 배열을 반환한다', () => {
    expect(parseCodeDrill('')).toEqual([]);
  });

  it('문제 헤딩이 없으면 빈 배열을 반환한다', () => {
    expect(parseCodeDrill('## Part 1. C언어\n\n본문만 있다\n')).toEqual([]);
  });

  it('번호가 두 자리가 아니거나 접두사가 다르면 문제로 보지 않는다', () => {
    expect(parseCodeDrill('### C-1. 한 자리\n### X-01. 없는 접두사\n### C01. 하이픈 없음\n')).toEqual([]);
  });

  it('details 블록이 없으면 answer·pitfall·expectedOutput 이 모두 빈 문자열이다', () => {
    const [p] = parseCodeDrill('## Part 1. C언어\n\n### C-01. 정답 없음\n\n```\nint a;\n```\n');
    expect(p.answer).toBe('');
    expect(p.pitfall).toBe('');
    expect(p.expectedOutput).toBe('');
    expect(p.code).toBe('int a;');
    expect(p.context).toBe('');
  });

  it('answer 에 `출력` 이라는 낱말이 아예 없으면 expectedOutput 은 빈 문자열이다', () => {
    const [p] = parseCodeDrill(
      [
        '### C-01. 결과 표기 없음',
        '```',
        'int a;',
        '```',
        '<details>',
        '<summary>정답</summary>',
        '설명만 있다',
        '</details>',
      ].join('\n')
    );
    expect(p.expectedOutput).toBe('');
  });

  it('`출력` 은 콜론 없이 문장 속에 있어도 그 뒤를 expectedOutput 으로 오인한다', () => {
    // 현행 동작 기록: 정규식이 /출력[:\s]*/ 라 낱말 단위 경계가 없다.
    const [p] = parseCodeDrill(
      [
        '### C-01. 오탐 사례',
        '```',
        'int a;',
        '```',
        '<details>',
        '<summary>정답</summary>',
        '이 문제는 출력 형식을 묻지 않는다',
        '</details>',
      ].join('\n')
    );
    expect(p.expectedOutput).toBe('형식을 묻지 않는다');
  });

  it('pitfall 라벨이 여러 개면 마지막 것이 남는다', () => {
    const [p] = parseCodeDrill(
      [
        '### C-01. 라벨 두 개',
        '```',
        'int a;',
        '```',
        '<details>',
        '<summary>정답</summary>',
        '**함정**: 첫 번째',
        '**주의**: 두 번째',
        '</details>',
      ].join('\n')
    );
    expect(p.pitfall).toBe('두 번째');
  });

  it('코드펜스가 없는 문제는 code 가 빈 문자열이다', () => {
    const [p] = parseCodeDrill('### C-01. 코드 없음\n\n설명만 있다\n');
    expect(p.code).toBe('');
  });

  it('코드펜스가 없는 문제는 다음 문제의 코드를 가져오지 않는다', () => {
    const problems = parseCodeDrill(
      ['### C-01. 코드 없음', '설명만 있다', '', '### C-02. 코드 있음', '```', 'int b;', '```', ''].join('\n')
    );
    expect(problems).toHaveLength(2);
    expect(problems[0].code).toBe('');
    expect(problems[1].code).toBe('int b;');
  });

  it('details 블록이 없는 문제는 다음 문제의 정답을 가져오지 않는다', () => {
    const problems = parseCodeDrill(
      [
        '### C-01. 정답 없음',
        '```',
        'int a;',
        '```',
        '',
        '### C-02. 정답 있음',
        '```',
        'int b;',
        '```',
        '<details>',
        '<summary>정답</summary>',
        'C-02의 정답',
        '</details>',
      ].join('\n')
    );
    expect(problems[0].answer).toBe('');
    expect(problems[1].answer).toBe('C-02의 정답');
  });

  it('CRLF 개행 문서에서도 LF 문서와 완전히 같은 결과를 낸다', () => {
    expect(parseCodeDrill(sample.replace(/\n/g, '\r\n'))).toEqual(parseCodeDrill(sample));
  });
});
