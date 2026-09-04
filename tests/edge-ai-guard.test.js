// 요청 입력 경계 하드닝 — `lib/ai/guard.js`.
//
// `tests/ai-guard.test.js` 는 계약(허용 source·id 형식·상한)을 다룬다.
// 여기서는 "형식은 맞는데 값이 이상한" 입력을 훑는다:
//   · 프로토타입 오염 키(`__proto__` · `constructor` · `prototype`)
//   · 유니코드 — 이모지·조합형 한글·서로게이트 페어
//   · 제어문자
//   · 숫자처럼 생긴 문자열, 아주 긴 값, 공백만 있는 값

import { describe, it, expect } from 'vitest';
import {
  validatePlanBody,
  validateTutorBody,
  validateGradeBody,
  MAX_USER_ANSWER_LENGTH,
  MAX_SNAPSHOT_TEXT,
  MAX_SNAPSHOT_MAP_KEYS,
  MAX_WRONG_NOTES,
  MAX_SNAPSHOT_BYTES,
} from '../lib/ai/guard.js';

const planBody = (snapshot) => ({
  snapshot: { availableMinutes: 90, wrongNotes: [], ...snapshot },
});

/** JSON 을 거쳐야 `__proto__` 가 **자기 속성**으로 만들어진다 (리터럴은 프로토타입 설정이다) */
const withProtoKey = (json) => JSON.parse(json);

describe('프로토타입 오염 키', () => {
  it('quizResults 의 __proto__ 키가 조용히 사라지지 않는다', () => {
    const result = validatePlanBody(
      planBody({ quizResults: withProtoKey('{"__proto__":"correct","001":"incorrect"}') })
    );

    expect(result.ok).toBe(true);
    // 자기 속성으로 남아야 한다 — `value[key] = ...` 는 __proto__ 에서 대입이 먹지 않아
    // 값이 조용히 증발한다. 증발하면 "보낸 기록이 서버에서 사라지는" 셈이다.
    expect(Object.keys(result.value.snapshot.quizResults).sort()).toEqual(['001', '__proto__']);
  });

  it('스냅샷 맵의 프로토타입이 바뀌지 않는다', () => {
    const result = validatePlanBody(
      planBody({
        quizResults: withProtoKey('{"__proto__":"correct"}'),
        examResults: withProtoKey('{"__proto__":"incorrect"}'),
        studyTime: withProtoKey('{"__proto__":5}'),
        dayChecks: withProtoKey('{"__proto__":true}'),
      })
    );

    expect(result.ok).toBe(true);
    for (const map of [
      result.value.snapshot.quizResults,
      result.value.snapshot.examResults,
      result.value.snapshot.studyTime,
      result.value.snapshot.dayChecks,
    ]) {
      expect(Object.getPrototypeOf(map)).toBe(Object.prototype);
    }
  });

  it('Object.prototype 을 오염시키지 않는다', () => {
    validatePlanBody(
      planBody({
        quizResults: withProtoKey('{"__proto__":"correct","constructor":"x","prototype":"y"}'),
      })
    );

    expect(Object.prototype.correct).toBeUndefined();
    expect({}.correct).toBeUndefined();
    expect(({}).x).toBeUndefined();
  });

  it('constructor·prototype 키도 값으로 보존한다', () => {
    const result = validatePlanBody(
      planBody({ quizResults: { constructor: 'correct', prototype: 'incorrect' } })
    );

    expect(result.ok).toBe(true);
    expect(Object.keys(result.value.snapshot.quizResults).sort()).toEqual([
      'constructor',
      'prototype',
    ]);
    expect(result.value.snapshot.quizResults.constructor).toBe('correct');
  });

  it('오답노트에 __proto__ 필드가 있어도 화이트리스트만 남는다', () => {
    const note = JSON.parse('{"source":"quiz100","id":"001","__proto__":{"polluted":true}}');
    const result = validatePlanBody(planBody({ wrongNotes: [note] }));

    expect(result.ok).toBe(true);
    expect(Object.keys(result.value.snapshot.wrongNotes[0]).sort()).toEqual([
      'addedAt',
      'category',
      'id',
      'lastReviewed',
      'mastered',
      'question',
      'reviewCount',
      'source',
    ]);
    expect({}.polluted).toBeUndefined();
  });
});

describe('유니코드', () => {
  const EMOJI = '🙂👨‍👩‍👧‍👦'; // 서로게이트 페어 + ZWJ 시퀀스
  const COMBINING = '각'; // 조합형 "각"

  it('이모지·조합형 한글이 든 답안을 통과시킨다 (해설)', () => {
    const answer = `정규화 ${EMOJI} ${COMBINING}`;
    const result = validateTutorBody({ source: 'quiz100', id: '001', userAnswer: answer });

    expect(result.ok).toBe(true);
    expect(result.value.userAnswer).toBe(answer);
  });

  it('이모지·조합형 한글이 든 답안을 통과시킨다 (채점)', () => {
    const answer = `${COMBINING}${EMOJI}`;
    const result = validateGradeBody({
      kind: 'short',
      source: 'quiz100',
      id: '001',
      userAnswer: answer,
    });

    expect(result.ok).toBe(true);
    expect(result.value.userAnswer).toBe(answer);
  });

  it('상한은 UTF-16 코드 단위로 센다 — 서로게이트 페어는 2 단위다', () => {
    // 이모지 1,000개 = 2,000 코드 단위 → 상한 정확히 채움
    const exact = '🙂'.repeat(MAX_USER_ANSWER_LENGTH / 2);
    expect(exact.length).toBe(MAX_USER_ANSWER_LENGTH);
    expect(validateGradeBody({ kind: 'short', source: 'quiz100', id: '001', userAnswer: exact }).ok)
      .toBe(true);

    const over = `${exact}🙂`;
    expect(validateGradeBody({ kind: 'short', source: 'quiz100', id: '001', userAnswer: over }).ok)
      .toBe(false);
  });

  it('스냅샷 문자열을 자를 때 짝 잃은 서로게이트를 남기지 않는다', () => {
    // 500번째 자리에서 이모지가 반으로 갈리는 길이를 만든다
    const question = `${'가'.repeat(MAX_SNAPSHOT_TEXT - 1)}🙂뒤쪽`;
    const result = validatePlanBody(
      planBody({ wrongNotes: [{ source: 'quiz100', id: '001', question }] })
    );

    expect(result.ok).toBe(true);
    const cut = result.value.snapshot.wrongNotes[0].question;
    // 짝 잃은 서로게이트는 JSON 으로 나갈 때 \ud83d 로 이스케이프돼 프롬프트에 깨진 글자로 실린다
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(cut)).toBe(
      false
    );
    expect(cut.length).toBeLessThanOrEqual(MAX_SNAPSHOT_TEXT);
  });
});

describe('제어문자·공백·숫자처럼 생긴 값', () => {
  it('스냅샷 문자열에서 제어문자를 지운다 (줄바꿈·탭은 남긴다)', () => {
    const result = validatePlanBody(
      planBody({
        wrongNotes: [
          // 앞 + NUL + ESC[31m + 가운데 + DEL + 개행 + 뒤 + 탭 + 끝
          {
            source: 'quiz100',
            id: '001',
            question: '\uC55E\u0000\u001B[31m\uAC00\uC6B4\uB370\u007F\n\uB4A4\t\uB05D',
          },
        ],
      })
    );

    expect(result.ok).toBe(true);
    expect(result.value.snapshot.wrongNotes[0].question).toBe('앞[31m가운데\n뒤\t끝');
  });

  it('맵의 키에서도 제어문자를 지운다', () => {
    const result = validatePlanBody(
      planBody({ quizResults: { '0\u000001': 'correct' } })
    );

    expect(result.ok).toBe(true);
    expect(Object.keys(result.value.snapshot.quizResults)).toEqual(['001']);
  });

  it('공백만 있는 답안은 해설에서는 통과하고 채점에서는 막힌다', () => {
    const blank = '   \t\n  ';
    expect(validateTutorBody({ source: 'quiz100', id: '001', userAnswer: blank }).ok).toBe(true);
    // 채점은 채점할 내용이 없으면 업스트림에 가기 전에 끊는다
    expect(
      validateGradeBody({ kind: 'short', source: 'quiz100', id: '001', userAnswer: blank }).ok
    ).toBe(false);
  });

  // ── userAnswer 의 제어문자 (Phase 5 잔여) ──
  //
  // 답안은 프롬프트에 그대로 실린다. NUL·ESC 가 섞이면 터미널 이스케이프가 로그를
  // 물들이고 프롬프트에 보이지 않는 바이트가 들어간다. 그렇다고 전부 지우면 안 된다 —
  // **코드 트레이싱 채점은 탭·개행이 비교 대상**이라 답안 원문을 바꾸면 채점이 달라진다.
  // 그래서 경계는 `\t`·`\n`·`\r` 보존, 나머지 C0/C1 제거다 (스냅샷 문자열과 같은 규칙).

  it('해설 요청의 답안에서 제어문자를 지우고 탭·개행·복귀는 남긴다', () => {
    const result = validateTutorBody({
      source: 'quiz100',
      id: '001',
      userAnswer: '앞\u0000\u001B[31m가운데\u007F\n뒤\t끝\r\n',
    });

    expect(result.ok).toBe(true);
    expect(result.value.userAnswer).toBe('앞[31m가운데\n뒤\t끝\r\n');
  });

  it('채점 요청의 답안에서도 같은 규칙을 쓴다', () => {
    const result = validateGradeBody({
      kind: 'code',
      source: 'codedrill',
      id: 'C-01',
      userAnswer: '10 20\u0000\n\u001B30 40',
    });

    expect(result.ok).toBe(true);
    expect(result.value.userAnswer).toBe('10 20\n30 40');
  });

  it('코드 트레이싱 답안의 들여쓰기와 줄바꿈은 한 글자도 바뀌지 않는다', () => {
    // 이 답안이 바뀌면 채점 결과가 바뀐다. 회귀를 여기서 고정한다.
    const traced = '\t10\r\n\t20\n\n  30\t40\n';
    const result = validateGradeBody({
      kind: 'code',
      source: 'codedrill',
      id: 'C-01',
      userAnswer: traced,
    });

    expect(result.ok).toBe(true);
    expect(result.value.userAnswer).toBe(traced);
  });

  it('제어문자만 있는 답안은 채점에서 빈 답안으로 막힌다', () => {
    expect(
      validateGradeBody({
        kind: 'short',
        source: 'quiz100',
        id: '001',
        userAnswer: '\u0000\u001B\u007F',
      }).ok
    ).toBe(false);
  });

  it('제어문자를 지운 뒤의 길이로 상한을 잰다', () => {
    // 지워질 바이트를 채워 넣어 상한을 넘긴 것처럼 보이게 하는 요청을 막지 않는다 —
    // 업스트림에 실리는 것은 정리된 문자열이고, 상한은 그 문자열에 대한 약속이다
    const answer = 'a'.repeat(MAX_USER_ANSWER_LENGTH) + '\u0000'.repeat(50);
    const result = validateGradeBody({
      kind: 'short',
      source: 'quiz100',
      id: '001',
      userAnswer: answer,
    });

    expect(result.ok).toBe(true);
    expect(result.value.userAnswer).toHaveLength(MAX_USER_ANSWER_LENGTH);
  });

  it('숫자처럼 생긴 문자열 id 는 형식이 맞으면 통과하고 숫자면 막힌다', () => {
    expect(validateTutorBody({ source: 'quiz100', id: '001', userAnswer: 'a' }).ok).toBe(true);
    expect(validateTutorBody({ source: 'quiz100', id: 1, userAnswer: 'a' }).ok).toBe(false);
    expect(validateTutorBody({ source: 'quiz100', id: '1', userAnswer: 'a' }).ok).toBe(false);
  });

  it('availableMinutes 는 숫자처럼 생긴 문자열을 받아들이지 않는다', () => {
    expect(validatePlanBody({ snapshot: { availableMinutes: '90' } }).ok).toBe(false);
    expect(validatePlanBody({ snapshot: { availableMinutes: NaN } }).ok).toBe(false);
    expect(validatePlanBody({ snapshot: { availableMinutes: Infinity } }).ok).toBe(false);
  });
});

describe('아주 큰 입력', () => {
  it('맵 키 개수 상한을 넘으면 거절한다', () => {
    const big = {};
    for (let i = 0; i <= MAX_SNAPSHOT_MAP_KEYS; i += 1) big[`k${i}`] = 'correct';
    expect(validatePlanBody(planBody({ quizResults: big })).ok).toBe(false);
  });

  it('오답노트 개수 상한을 넘으면 거절한다', () => {
    const notes = Array.from({ length: MAX_WRONG_NOTES + 1 }, (_, i) => ({
      source: 'quiz100',
      id: String(i),
    }));
    expect(validatePlanBody(planBody({ wrongNotes: notes })).ok).toBe(false);
  });

  it('개수는 적어도 바이트 총량이 크면 거절한다 (노트 하나에 거대한 문자열)', () => {
    const huge = 'ㄱ'.repeat(MAX_SNAPSHOT_BYTES); // UTF-8 로 3바이트/글자
    const result = validatePlanBody(
      planBody({ wrongNotes: [{ source: 'quiz100', id: '001', question: huge }] })
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain('상한');
  });
});
