// 생성물 파일의 **고정 계약** (블루프린트 §4.4) — 프론트엔드와 공유하는 shape 이다.
//
//   public/data/generated/<source>.json
//   { version, source, generatedAt, model, reviewed, items: [...] }
//
// 이 검증기는 **키 없이** 돌고 `npm test` 에 들어간다. 실제 생성물이 커밋되면
// 마지막 describe 가 CI 에서 그 파일들을 그대로 검증한다.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { loadSource, clearContentCache } from '../lib/ai/content.js';
import { collectVariantResults } from '../lib/ai/variants.js';
import {
  GENERATED_VERSION,
  generatedItemFields,
  buildGeneratedDoc,
  saveGeneratedDoc,
  validateGeneratedDoc,
  listGeneratedFiles,
} from '../lib/ai/generated.js';

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/ai-data', import.meta.url));
const FIXTURE_GENERATED = fileURLToPath(new URL('./fixtures/generated', import.meta.url));

beforeEach(() => {
  vi.stubEnv('JUNGCHOGI_DATA_DIR', FIXTURE_DIR);
  clearContentCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  clearContentCache();
});

const quizItem = (overrides = {}) => ({
  id: '001-v1',
  question: '변형 지문',
  answer: '변형 정답',
  category: '데이터베이스',
  variantOf: '001',
  generated: true,
  ...overrides,
});

const drillItem = (overrides = {}) => ({
  id: 'C-01-v1',
  title: '포인터 변형',
  context: '',
  code: 'int a = 1;',
  lang: 'c',
  answer: '추적표',
  expectedOutput: '1',
  pitfall: '주소 vs 값',
  variantOf: 'C-01',
  generated: true,
  ...overrides,
});

const doc = (source, items) =>
  buildGeneratedDoc({ source, items, generatedAt: '2026-09-03T12:00:00.000Z' });

const check = (source, items, originalSource = source) =>
  validateGeneratedDoc(doc(source, items), { originals: loadSource(originalSource) });

const messages = (result) => result.issues.map((issue) => issue.message).join(' | ');

describe('buildGeneratedDoc', () => {
  it('계약대로 봉투를 채운다', () => {
    const built = doc('quiz100', [quizItem()]);
    expect(built).toMatchObject({
      version: GENERATED_VERSION,
      source: 'quiz100',
      generatedAt: '2026-09-03T12:00:00.000Z',
      model: 'claude-opus-5',
      reviewed: false,
    });
    expect(built.items).toHaveLength(1);
  });

  it('reviewed 는 항상 false 로 시작한다 — 사람 검수 전에는 앱이 쓰지 않는다', () => {
    expect(doc('quiz100', []).reviewed).toBe(false);
  });
});

describe('validateGeneratedDoc — 봉투', () => {
  it('올바른 생성물은 통과한다', () => {
    const result = check('quiz100', [quizItem()]);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('version 이 계약과 다르면 잡는다', () => {
    const bad = { ...doc('quiz100', [quizItem()]), version: 2 };
    const result = validateGeneratedDoc(bad, { originals: loadSource('quiz100') });
    expect(result.ok).toBe(false);
    expect(messages(result)).toContain('version');
  });

  it('알 수 없는 source 는 잡는다', () => {
    const bad = { ...doc('quiz100', []), source: 'nope' };
    const result = validateGeneratedDoc(bad, { originals: [] });
    expect(messages(result)).toContain('source');
  });

  it('reviewed 가 boolean 이 아니면 잡는다', () => {
    const bad = { ...doc('quiz100', [quizItem()]), reviewed: 'yes' };
    expect(messages(validateGeneratedDoc(bad, { originals: loadSource('quiz100') }))).toContain(
      'reviewed'
    );
  });

  it('generatedAt 이 ISO 시각이 아니면 잡는다', () => {
    const bad = { ...doc('quiz100', [quizItem()]), generatedAt: '어제' };
    expect(messages(validateGeneratedDoc(bad, { originals: loadSource('quiz100') }))).toContain(
      'generatedAt'
    );
  });

  it('model 이 비면 잡는다', () => {
    const bad = { ...doc('quiz100', [quizItem()]), model: '' };
    expect(messages(validateGeneratedDoc(bad, { originals: loadSource('quiz100') }))).toContain(
      'model'
    );
  });

  it('items 가 배열이 아니면 잡는다', () => {
    const bad = { ...doc('quiz100', []), items: {} };
    expect(messages(validateGeneratedDoc(bad, { originals: [] }))).toContain('items');
  });
});

describe('validateGeneratedDoc — 항목', () => {
  it('필수 필드가 빠지면 잡는다', () => {
    const item = quizItem();
    delete item.category;
    const result = check('quiz100', [item]);
    expect(result.ok).toBe(false);
    expect(messages(result)).toContain('category');
  });

  it('빈 문자열을 잡는다', () => {
    const result = check('quiz100', [quizItem({ answer: '   ' })]);
    expect(result.ok).toBe(false);
    expect(messages(result)).toContain('answer');
  });

  it('계약에 없는 필드가 섞이면 잡는다', () => {
    const result = check('quiz100', [quizItem({ lang: 'c' })]);
    expect(result.ok).toBe(false);
    expect(messages(result)).toContain('lang');
  });

  it('generated 가 true 가 아니면 잡는다', () => {
    const result = check('quiz100', [quizItem({ generated: false })]);
    expect(messages(result)).toContain('generated');
  });

  it('생성물 안에서 id 가 겹치면 잡는다', () => {
    const result = check('quiz100', [quizItem(), quizItem({ variantOf: '002' })]);
    expect(result.ok).toBe(false);
    expect(messages(result)).toContain('중복');
  });

  it('원본 id 와 충돌하면 잡는다', () => {
    const result = check('quiz100', [quizItem({ id: '001' })]);
    expect(result.ok).toBe(false);
    expect(messages(result)).toContain('충돌');
  });

  it('variantOf 가 실제 원본을 가리키지 않으면 잡는다', () => {
    const result = check('quiz100', [quizItem({ id: '777-v1', variantOf: '777' })]);
    expect(result.ok).toBe(false);
    expect(messages(result)).toContain('variantOf');
  });

  it('id 가 variantOf 로 시작하지 않으면 잡는다 (원본 추적이 끊긴다)', () => {
    const result = check('quiz100', [quizItem({ id: '002-v1', variantOf: '001' })]);
    expect(result.ok).toBe(false);
    expect(messages(result)).toContain('id');
  });
});

describe('validateGeneratedDoc — codedrill', () => {
  it('올바른 드릴 항목은 통과한다', () => {
    expect(check('codedrill', [drillItem()]).issues).toEqual([]);
  });

  it('lang 이 허용값(c/java/python/sql) 밖이면 잡는다', () => {
    const result = check('codedrill', [drillItem({ lang: 'rust' })]);
    expect(result.ok).toBe(false);
    expect(messages(result)).toContain('lang');
  });

  it('lang 이 원본과 다르면 잡는다', () => {
    const result = check('codedrill', [drillItem({ lang: 'sql' })]);
    expect(result.ok).toBe(false);
    expect(messages(result)).toContain('lang');
  });

  it('context·expectedOutput·pitfall 은 비어도 된다 (원본에도 빈 문항이 있다)', () => {
    const result = check('codedrill', [
      drillItem({ context: '', expectedOutput: '', pitfall: '' }),
    ]);
    expect(result.issues).toEqual([]);
  });

  it('code 가 비면 잡는다', () => {
    expect(messages(check('codedrill', [drillItem({ code: '' })]))).toContain('code');
  });
});

describe('생성물 항목은 기존 파서 출력과 같은 shape 이다', () => {
  it.each([
    ['quiz100', 'quiz100'],
    ['bogang', 'bogang'],
    ['codedrill', 'codedrill'],
  ])('%s — 파서 출력 필드 + variantOf/generated', (source) => {
    const parsed = loadSource(source)[0];
    const contract = generatedItemFields(source);
    expect(contract.sort()).toEqual([...Object.keys(parsed), 'variantOf', 'generated'].sort());
  });
});

describe('픽스처 생성물은 계약을 지킨다', () => {
  it.each(['quiz100', 'codedrill'])('tests/fixtures/generated/%s.json', (source) => {
    const parsed = JSON.parse(readFileSync(`${FIXTURE_GENERATED}/${source}.json`, 'utf8'));
    const result = validateGeneratedDoc(parsed, { originals: loadSource(source) });
    expect(messages(result)).toBe('');
  });
});

describe('커밋된 생성물 (public/data/generated)', () => {
  // 실제 생성물이 커밋되면 CI 가 여기서 계약 위반을 잡는다.
  // 아직 아무것도 없으면 이 describe 는 통과할 것이 없다 — 그것이 정상이다.
  it('있는 파일은 모두 계약을 지킨다', () => {
    vi.unstubAllEnvs(); // 실제 public/data 원본으로 검증한다
    clearContentCache();

    for (const path of listGeneratedFiles()) {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      const result = validateGeneratedDoc(parsed, { originals: loadSource(parsed.source) });
      expect(`${basename(path)}: ${messages(result)}`).toBe(`${basename(path)}: `);
    }
  });
});

describe('부분 실패 뒤에도 성공분은 파일로 남는다', () => {
  it('실패 3건이 섞여도 성공 1건이 계약을 지킨 채 저장된다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jungchogi-generated-'));
    try {
      const rows = [
        { custom_id: 'quiz100__001__v1', result: { type: 'expired' } },
        {
          custom_id: 'quiz100__002__v1',
          result: {
            type: 'succeeded',
            message: {
              stop_reason: 'end_turn',
              content: [{ type: 'text', text: JSON.stringify({ question: '살아남은 지문', answer: '살아남은 정답' }) }],
              usage: { input_tokens: 10, output_tokens: 20 },
            },
          },
        },
        {
          custom_id: 'quiz100__026__v1',
          result: { type: 'errored', error: { error: { message: '서버 오류' } } },
        },
        { custom_id: 'quiz100__001__v2', result: { type: 'canceled' } },
      ];

      const { items, failures } = await collectVariantResults({
        results: (async function* () {
          yield* rows;
        })(),
        source: 'quiz100',
        originals: loadSource('quiz100'),
      });

      expect(failures).toHaveLength(3);

      const path = saveGeneratedDoc(
        buildGeneratedDoc({ source: 'quiz100', items, generatedAt: '2026-09-03T12:00:00.000Z' }),
        { path: join(dir, 'quiz100.json') }
      );

      const written = JSON.parse(readFileSync(path, 'utf8'));
      expect(written.items).toHaveLength(1);
      expect(written.items[0].id).toBe('002-v1');
      expect(written.reviewed).toBe(false);
      expect(
        validateGeneratedDoc(written, { originals: loadSource('quiz100') }).issues
      ).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
