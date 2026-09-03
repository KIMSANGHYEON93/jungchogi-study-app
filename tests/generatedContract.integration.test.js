// 생성 스크립트가 실제로 뱉은 파일이 앱의 계약을 지키는지 (BLUEPRINT §4.4).
//
// `tests/fixtures/generated/*.json` 은 `scripts/generate-variants.mjs` 가
// 만든 모양 그대로다. 여기서 **실제 교재를 파싱한 덱**과 합쳐 본다 —
// 스크립트 절반과 앱 절반이 같은 계약을 보고 있는지 확인하는 유일한 지점이다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseQuiz } from '../src/utils/parseQuiz.js';
import { parseCodeDrill } from '../src/utils/parseCodeDrill.js';
import { acceptGeneratedFile, mergeGenerated } from '../src/domain/generatedItems.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf-8');
const readJson = (p) => JSON.parse(read(p));

const QUIZ_BASE = parseQuiz(read('public/data/정처기_단답형_100선.md'));
const DRILL_BASE = parseCodeDrill(read('public/data/정처기_코드트레이싱_드릴.md'));

const CASES = [
  { source: 'quiz100', fixture: 'tests/fixtures/generated/quiz100.json', base: QUIZ_BASE },
  { source: 'codedrill', fixture: 'tests/fixtures/generated/codedrill.json', base: DRILL_BASE },
];

describe.each(CASES)('$source 생성물', ({ source, fixture, base }) => {
  const raw = readJson(fixture);

  // ★ 스크립트는 reviewed: false 로 낸다 — 사람이 검수하기 전이기 때문이다.
  //   그 파일을 그대로 배포해도 앱은 한 문항도 쓰지 않아야 한다.
  it('스크립트가 낸 그대로는 학습에 들어가지 않는다', () => {
    expect(raw.reviewed).toBe(false);
    expect(acceptGeneratedFile(raw, source).items).toEqual([]);
  });

  it('검수를 통과시키면 실제 교재 덱에 그대로 합쳐진다', () => {
    const { items, warnings } = acceptGeneratedFile({ ...raw, reviewed: true }, source);
    expect(warnings).toEqual([]);
    expect(items.length).toBeGreaterThan(0);

    const merged = mergeGenerated(base, items, source);
    // 계약을 어긴 항목이 하나도 없어야 한다 — 있으면 두 절반의 계약이 어긋난 것이다
    expect(merged.warnings).toEqual([]);
    expect(merged.items).toHaveLength(base.length + items.length);
  });

  it('생성 문항의 variantOf 가 모두 실제 교재 문항을 가리킨다', () => {
    const baseIds = new Set(base.map((item) => item.id));
    for (const item of raw.items) {
      expect(baseIds.has(item.variantOf)).toBe(true);
    }
  });

  it('생성 id 가 교재 id 와 겹치지 않는다', () => {
    const baseIds = new Set(base.map((item) => item.id));
    for (const item of raw.items) {
      expect(baseIds.has(item.id)).toBe(false);
    }
  });

  it('합친 문항이 기존 파서 출력과 같은 필드를 갖는다', () => {
    const { items } = acceptGeneratedFile({ ...raw, reviewed: true }, source);
    // 화면은 파서 출력 shape 만 알고 있다 — 필드가 빠지면 그 자리가 빈 채로 그려진다
    const required = Object.keys(base[0]);
    for (const item of items) {
      expect(Object.keys(item)).toEqual(expect.arrayContaining(required));
    }
  });
});
