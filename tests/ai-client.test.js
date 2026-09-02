import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import {
  MODEL,
  TUTOR_MAX_TOKENS,
  TUTOR_EFFORT,
  USE_SERVER_FALLBACK,
  SERVER_FALLBACK_BETA,
  getClient,
  resetClient,
  hasApiKey,
  classifyUpstreamError,
  buildTutorRequest,
} from '../lib/ai/client.js';

const headers = () => new Headers();

beforeEach(() => {
  resetClient();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetClient();
});

describe('모델·요청 상수', () => {
  it('모델 ID 는 날짜 접미사 없는 claude-opus-5 다', () => {
    expect(MODEL).toBe('claude-opus-5');
  });

  it('해설 effort 는 블루프린트 §7-1 대로 low 다', () => {
    expect(TUTOR_EFFORT).toBe('low');
  });

  it('해설은 짧아야 하므로 max_tokens 를 낮게 잡는다', () => {
    expect(TUTOR_MAX_TOKENS).toBe(4000);
  });
});

describe('getClient', () => {
  it('키가 없으면 클라이언트를 만들다가 실패한다', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    expect(hasApiKey()).toBe(false);
    expect(() => getClient()).toThrow();
  });

  it('키가 있으면 인스턴스를 만들고 재사용한다', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    expect(hasApiKey()).toBe(true);
    const client = getClient();
    expect(client).toBeInstanceOf(Anthropic);
    expect(getClient()).toBe(client);
  });

  it('resetClient 뒤에는 새로 만든다', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    const first = getClient();
    resetClient();
    expect(getClient()).not.toBe(first);
  });
});

describe('buildTutorRequest — SDK 요청 파라미터', () => {
  const system = [{ type: 'text', text: '고정 프리픽스' }];
  const messages = [{ role: 'user', content: '질문' }];

  it('모델·max_tokens·effort 를 계약대로 채운다', () => {
    const params = buildTutorRequest({ system, messages });
    expect(params.model).toBe('claude-opus-5');
    expect(params.max_tokens).toBe(4000);
    expect(params.output_config).toEqual({ effort: 'low' });
    expect(params.system).toBe(system);
    expect(params.messages).toBe(messages);
  });

  it('thinking 파라미터를 보내지 않는다 (Opus 5 기본 adaptive)', () => {
    expect(buildTutorRequest({ system, messages })).not.toHaveProperty('thinking');
  });

  it('budget_tokens 를 절대 보내지 않는다 (Opus 5 에서 400)', () => {
    expect(JSON.stringify(buildTutorRequest({ system, messages }))).not.toContain('budget_tokens');
  });

  it('폴백을 켜면 betas 와 fallbacks 를 붙인다', () => {
    const params = buildTutorRequest({ system, messages, useServerFallback: true });
    expect(params.betas).toEqual([SERVER_FALLBACK_BETA]);
    expect(params.fallbacks).toBe('default');
  });

  it('폴백을 끄면 betas·fallbacks 가 없다', () => {
    const params = buildTutorRequest({ system, messages, useServerFallback: false });
    expect(params).not.toHaveProperty('betas');
    expect(params).not.toHaveProperty('fallbacks');
  });

  it('기본값은 모듈 상수를 따른다', () => {
    const params = buildTutorRequest({ system, messages });
    expect('betas' in params).toBe(USE_SERVER_FALLBACK);
  });
});

describe('classifyUpstreamError — 재시도 가능/불가능 구분', () => {
  it('404 는 재시도 불가 UPSTREAM', () => {
    const result = classifyUpstreamError(new Anthropic.NotFoundError(404, {}, 'nope', headers()));
    expect(result).toMatchObject({ code: 'UPSTREAM', retryable: false });
  });

  it('429 는 재시도 가능 RATE_LIMITED', () => {
    const result = classifyUpstreamError(new Anthropic.RateLimitError(429, {}, 'slow', headers()));
    expect(result).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
  });

  it('네트워크 오류는 재시도 가능 UPSTREAM', () => {
    const result = classifyUpstreamError(new Anthropic.APIConnectionError({ message: 'ECONNRESET' }));
    expect(result).toMatchObject({ code: 'UPSTREAM', retryable: true });
  });

  it('5xx 는 재시도 가능 UPSTREAM', () => {
    const result = classifyUpstreamError(
      new Anthropic.InternalServerError(503, {}, 'overloaded', headers())
    );
    expect(result).toMatchObject({ code: 'UPSTREAM', retryable: true });
  });

  it('400 은 재시도 불가 UPSTREAM', () => {
    const result = classifyUpstreamError(new Anthropic.BadRequestError(400, {}, 'bad', headers()));
    expect(result).toMatchObject({ code: 'UPSTREAM', retryable: false });
  });

  it('업스트림 인증 실패는 서버 설정 문제이지 접근 코드 문제가 아니다', () => {
    const result = classifyUpstreamError(
      new Anthropic.AuthenticationError(401, {}, 'bad key', headers())
    );
    expect(result.code).toBe('UPSTREAM');
    expect(result.retryable).toBe(false);
  });

  it('SDK 예외가 아닌 값도 UPSTREAM 으로 감싼다', () => {
    expect(classifyUpstreamError(new TypeError('boom'))).toMatchObject({
      code: 'UPSTREAM',
      retryable: false,
    });
    expect(classifyUpstreamError(undefined).code).toBe('UPSTREAM');
  });

  it('업스트림 원문을 클라이언트 메시지로 흘리지 않는다', () => {
    const result = classifyUpstreamError(
      new Anthropic.AuthenticationError(401, {}, 'invalid x-api-key sk-ant-secret', headers())
    );
    expect(result.message).not.toContain('sk-ant-secret');
  });
});
