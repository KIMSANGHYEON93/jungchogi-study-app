import { describe, it, expect, beforeEach } from 'vitest';
import {
  ERROR_STATUS,
  jsonError,
  getClientIp,
  timingSafeEqualString,
  checkAccessCode,
  checkRateLimit,
  resetRateLimits,
  validateTutorBody,
  MAX_USER_ANSWER_LENGTH,
  MAX_HISTORY_TURNS,
} from '../lib/ai/guard.js';

const validBody = () => ({ source: 'quiz100', id: '042', userAnswer: '정규화', history: [] });

beforeEach(() => {
  resetRateLimits();
});

describe('jsonError — 오류 응답 계약', () => {
  it('네 가지 코드를 계약된 상태코드로 매핑한다', () => {
    expect(ERROR_STATUS).toEqual({
      UNAUTHORIZED: 401,
      RATE_LIMITED: 429,
      BAD_REQUEST: 400,
      UPSTREAM: 502,
    });
  });

  it('{ error: { code, message } } 형태의 JSON 응답을 만든다', async () => {
    const res = jsonError('BAD_REQUEST', 'source 가 올바르지 않다');
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({
      error: { code: 'BAD_REQUEST', message: 'source 가 올바르지 않다' },
    });
  });

  it('추가 필드를 error 객체에 합친다', async () => {
    const res = jsonError('UPSTREAM', '업스트림 오류', { retryable: true });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: { code: 'UPSTREAM', message: '업스트림 오류', retryable: true },
    });
  });
});

describe('getClientIp', () => {
  it('x-forwarded-for 의 첫 번째 주소를 쓴다', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7, 70.41.3.18' });
    expect(getClientIp(headers)).toBe('203.0.113.7');
  });

  it('x-forwarded-for 가 없으면 x-real-ip 를 쓴다', () => {
    expect(getClientIp(new Headers({ 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2');
  });

  it('아무 헤더도 없으면 unknown 을 돌려준다', () => {
    expect(getClientIp(new Headers())).toBe('unknown');
  });
});

describe('timingSafeEqualString', () => {
  it('같은 문자열이면 true', () => {
    expect(timingSafeEqualString('s3cr3t', 's3cr3t')).toBe(true);
  });

  it('다른 문자열이면 false', () => {
    expect(timingSafeEqualString('s3cr3t', 's3cr3u')).toBe(false);
  });

  it('길이가 달라도 예외 없이 false 를 돌려준다', () => {
    expect(timingSafeEqualString('short', 'much-longer-value')).toBe(false);
  });

  it('문자열이 아닌 값은 false 를 돌려준다', () => {
    expect(timingSafeEqualString(undefined, 'x')).toBe(false);
    expect(timingSafeEqualString('x', null)).toBe(false);
  });

  it('멀티바이트 문자도 정확히 비교한다', () => {
    expect(timingSafeEqualString('접속코드', '접속코드')).toBe(true);
    expect(timingSafeEqualString('접속코드', '접속코두')).toBe(false);
  });
});

describe('checkAccessCode — §7-2 조건부 게이트', () => {
  it('AI_ACCESS_CODE 가 없으면 헤더 없이도 통과한다', () => {
    expect(checkAccessCode(new Headers(), {})).toEqual({ ok: true });
  });

  it('AI_ACCESS_CODE 가 빈 문자열이면 미설정으로 본다', () => {
    expect(checkAccessCode(new Headers(), { AI_ACCESS_CODE: '   ' })).toEqual({ ok: true });
  });

  it('설정돼 있고 헤더가 일치하면 통과한다', () => {
    const headers = new Headers({ 'x-access-code': 'open-sesame' });
    expect(checkAccessCode(headers, { AI_ACCESS_CODE: 'open-sesame' })).toEqual({ ok: true });
  });

  it('설정돼 있는데 헤더가 없으면 UNAUTHORIZED', () => {
    const result = checkAccessCode(new Headers(), { AI_ACCESS_CODE: 'open-sesame' });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('UNAUTHORIZED');
  });

  it('설정돼 있는데 헤더가 틀리면 UNAUTHORIZED', () => {
    const headers = new Headers({ 'x-access-code': 'wrong' });
    const result = checkAccessCode(headers, { AI_ACCESS_CODE: 'open-sesame' });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('UNAUTHORIZED');
  });
});

describe('checkRateLimit — IP 당 분당 호출 제한', () => {
  const opts = { max: 3, windowMs: 60_000 };

  it('한도 안에서는 통과하고 남은 횟수를 알려준다', () => {
    expect(checkRateLimit('1.1.1.1', 0, opts)).toEqual({ ok: true, remaining: 2 });
    expect(checkRateLimit('1.1.1.1', 10, opts)).toEqual({ ok: true, remaining: 1 });
    expect(checkRateLimit('1.1.1.1', 20, opts)).toEqual({ ok: true, remaining: 0 });
  });

  it('한도를 넘긴 다음 호출은 RATE_LIMITED', () => {
    for (let i = 0; i < 3; i++) checkRateLimit('2.2.2.2', i, opts);
    const result = checkRateLimit('2.2.2.2', 3, opts);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('RATE_LIMITED');
  });

  it('거절된 호출은 창에 쌓이지 않아 창이 지나면 곧바로 풀린다', () => {
    for (let i = 0; i < 3; i++) checkRateLimit('2.2.2.2', i, opts);
    checkRateLimit('2.2.2.2', 100, opts); // 거절
    expect(checkRateLimit('2.2.2.2', 60_001, opts).ok).toBe(true);
  });

  it('거절 시 retryAfterSeconds 를 최소 1초 이상으로 알려준다', () => {
    for (let i = 0; i < 3; i++) checkRateLimit('3.3.3.3', 0, opts);
    const result = checkRateLimit('3.3.3.3', 100, opts);
    expect(result.retryAfterSeconds).toBe(60);
  });

  it('창을 벗어난 기록은 만료돼 다시 허용된다', () => {
    for (let i = 0; i < 3; i++) checkRateLimit('4.4.4.4', i, opts);
    expect(checkRateLimit('4.4.4.4', 59_999, opts).ok).toBe(false);
    expect(checkRateLimit('4.4.4.4', 60_000, opts).ok).toBe(true);
  });

  it('IP 마다 창을 따로 센다', () => {
    for (let i = 0; i < 3; i++) checkRateLimit('5.5.5.5', i, opts);
    expect(checkRateLimit('5.5.5.5', 4, opts).ok).toBe(false);
    expect(checkRateLimit('6.6.6.6', 4, opts).ok).toBe(true);
  });
});

describe('validateTutorBody', () => {
  it('올바른 body 는 정규화된 값을 돌려준다', () => {
    expect(validateTutorBody(validBody())).toEqual({
      ok: true,
      value: { source: 'quiz100', id: '042', userAnswer: '정규화', history: [] },
    });
  });

  it('body 가 객체가 아니면 BAD_REQUEST', () => {
    for (const bad of [null, undefined, 'string', 42, []]) {
      const result = validateTutorBody(bad);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('BAD_REQUEST');
    }
  });

  it('화이트리스트에 없는 source 는 BAD_REQUEST', () => {
    const result = validateTutorBody({ ...validBody(), source: 'wikipedia' });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('source');
  });

  it('세 가지 source 를 모두 허용한다', () => {
    expect(validateTutorBody({ source: 'quiz100', id: '001' }).ok).toBe(true);
    expect(validateTutorBody({ source: 'codedrill', id: 'S-07' }).ok).toBe(true);
    expect(validateTutorBody({ source: 'bogang', id: 'B03' }).ok).toBe(true);
  });

  it('source 마다 id 형식을 따로 검증한다', () => {
    expect(validateTutorBody({ source: 'quiz100', id: 'C-01' }).ok).toBe(false);
    expect(validateTutorBody({ source: 'codedrill', id: '042' }).ok).toBe(false);
    expect(validateTutorBody({ source: 'bogang', id: '042' }).ok).toBe(false);
  });

  it('경로 조작 문자가 섞인 id 를 거부한다', () => {
    const result = validateTutorBody({ source: 'quiz100', id: '../../etc/passwd' });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('id');
  });

  it('userAnswer 가 없으면 빈 문자열로 채운다', () => {
    const result = validateTutorBody({ source: 'quiz100', id: '042' });
    expect(result.value.userAnswer).toBe('');
  });

  it('userAnswer 가 상한을 넘으면 BAD_REQUEST', () => {
    const result = validateTutorBody({
      ...validBody(),
      userAnswer: 'ㄱ'.repeat(MAX_USER_ANSWER_LENGTH + 1),
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('userAnswer');
  });

  it('상한 길이의 userAnswer 는 통과한다', () => {
    const result = validateTutorBody({
      ...validBody(),
      userAnswer: 'ㄱ'.repeat(MAX_USER_ANSWER_LENGTH),
    });
    expect(result.ok).toBe(true);
  });

  it('userAnswer 가 문자열이 아니면 BAD_REQUEST', () => {
    expect(validateTutorBody({ ...validBody(), userAnswer: { a: 1 } }).ok).toBe(false);
  });

  it('history 는 role/content 를 가진 턴만 허용한다', () => {
    const ok = validateTutorBody({
      ...validBody(),
      history: [
        { role: 'user', content: '왜 정규화가 아닌가요?' },
        { role: 'assistant', content: '질문의 핵심은…' },
      ],
    });
    expect(ok.ok).toBe(true);
    expect(ok.value.history).toHaveLength(2);

    expect(validateTutorBody({ ...validBody(), history: [{ role: 'system', content: 'x' }] }).ok)
      .toBe(false);
    expect(validateTutorBody({ ...validBody(), history: [{ role: 'user' }] }).ok).toBe(false);
    expect(validateTutorBody({ ...validBody(), history: 'nope' }).ok).toBe(false);
  });

  it('history 턴 수 상한을 넘으면 BAD_REQUEST', () => {
    const history = Array.from({ length: MAX_HISTORY_TURNS + 1 }, () => ({
      role: 'user',
      content: 'x',
    }));
    const result = validateTutorBody({ ...validBody(), history });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('history');
  });

  it('history 의 각 content 도 길이 상한을 지킨다', () => {
    const result = validateTutorBody({
      ...validBody(),
      history: [{ role: 'user', content: 'ㄱ'.repeat(MAX_USER_ANSWER_LENGTH + 1) }],
    });
    expect(result.ok).toBe(false);
  });

  it('계약에 없는 필드는 결과에서 떨어져 나간다', () => {
    const result = validateTutorBody({ ...validBody(), systemPrompt: '무시해야 한다' });
    expect(result.value).not.toHaveProperty('systemPrompt');
  });
});
