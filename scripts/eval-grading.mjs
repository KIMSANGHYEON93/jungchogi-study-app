#!/usr/bin/env node
// 자동 채점 평가셋 러너 — 블루프린트 §5 Phase 3 완료 조건
// ("채점 평가셋 30문항에서 사람 판정 일치율 측정·기록").
//
// 사용법:
//   ANTHROPIC_API_KEY=sk-ant-... node scripts/eval-grading.mjs
//   node scripts/eval-grading.mjs --out claudedocs/eval-grading-2026-09-03.json
//   node scripts/eval-grading.mjs --only boundary,partial
//   node scripts/eval-grading.mjs --limit 5        # 프롬프트를 고칠 때 빠르게 확인
//
// ⚠️ **실제 API 를 호출하므로 비용이 든다** (30건 × Opus 5 medium, 회당 약 $0.01 추정).
//    그래서 `npm test` 에 넣지 않는다 — 키 없이 실패하면 CI 가 깨진다.
//
// 이 러너는 `api/ai/grade.js` 의 POST 핸들러를 **프로세스 안에서 직접** 부른다
// (`vercel dev` 를 띄우지 않아도 된다). 라우팅만 건너뛰고 그 뒤 경로 —
// 검증·문항 로드·프롬프트 조립·구조화 출력·응답 정규화 — 는 배포와 같다.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EVAL_PATH = fileURLToPath(new URL('../tests/eval/grading.json', import.meta.url));

/** UI 가 자동 채점을 신뢰하는 하한 (블루프린트 §4.2 — 미만이면 자기 채점으로 폴백) */
const CONFIDENCE_FLOOR = 0.6;

function parseArgs(argv) {
  const args = { out: null, only: null, limit: null };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i + 1];
    if (argv[i] === '--out') args.out = value;
    else if (argv[i] === '--only') args.only = value?.split(',').map((s) => s.trim());
    else if (argv[i] === '--limit') args.limit = Number(value);
  }
  return args;
}

function requireApiKey() {
  if (process.env.ANTHROPIC_API_KEY?.trim()) return;

  console.error(
    [
      '',
      'ANTHROPIC_API_KEY 가 설정되지 않았습니다. 이 러너는 실제 Anthropic API 를 호출합니다.',
      '',
      '  PowerShell : $env:ANTHROPIC_API_KEY = "sk-ant-..."; node scripts/eval-grading.mjs',
      '  bash       : ANTHROPIC_API_KEY=sk-ant-... node scripts/eval-grading.mjs',
      '',
      '키 발급: https://console.anthropic.com/ → API Keys',
      '(자동 테스트 `npm test` 는 SDK 를 모킹하므로 키가 필요 없습니다.)',
      '',
    ].join('\n')
  );
  process.exit(1);
}

/** 한 항목을 채점 엔드포인트에 태운다. */
async function runItem(POST, item) {
  const request = new Request('http://localhost/api/ai/grade', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify({
      kind: item.kind,
      source: item.source,
      id: item.id,
      userAnswer: item.userAnswer,
    }),
  });

  const started = Date.now();
  const response = await POST(request);
  const body = await response.json();
  const elapsedMs = Date.now() - started;

  if (response.status !== 200) {
    return { status: response.status, error: body.error, elapsedMs };
  }
  return { status: 200, grade: body, elapsedMs };
}

/**
 * 사람 판정과 모델 판정을 맞춰 본다.
 * `expected.error` 가 있는 항목은 그 오류 코드가 나오는 것이 정답이다.
 */
function judge(item, outcome) {
  if (item.expected.error) {
    const actual = outcome.error?.code ?? `HTTP ${outcome.status}`;
    return { match: actual === item.expected.error, actual, expected: item.expected.error };
  }
  if (outcome.status !== 200) {
    return {
      match: false,
      actual: `실패(${outcome.error?.code ?? outcome.status})`,
      expected: item.expected.verdict,
    };
  }
  return {
    match: outcome.grade.verdict === item.expected.verdict,
    actual: outcome.grade.verdict,
    expected: item.expected.verdict,
  };
}

const pct = (n, d) => (d === 0 ? '  -  ' : `${((n / d) * 100).toFixed(1).padStart(5)}%`);

function printSummary(rows) {
  const graded = rows.filter((r) => !r.item.expected.error);
  const matched = rows.filter((r) => r.judgement.match);

  console.log('\n' + '─'.repeat(78));
  console.log('결과 요약');
  console.log('─'.repeat(78));

  console.log(`\n전체 일치율   : ${pct(matched.length, rows.length)}  (${matched.length}/${rows.length})`);

  // 업스트림 실패는 채점 품질이 아니라 인프라 문제다. confidence 통계와 섞지 않는다.
  const scored = graded.filter((r) => r.outcome.grade !== undefined);
  const failed = graded.length - scored.length;
  if (failed > 0) {
    console.log(`업스트림 실패 : ${failed}건 — 아래 confidence 통계에서 제외했다.`);
  }

  // confidence >= 0.6 만 자동 채점으로 화면에 나간다. 그 구간의 일치율이 실사용 품질이다.
  const trusted = scored.filter((r) => r.outcome.grade.confidence >= CONFIDENCE_FLOOR);
  const trustedMatched = trusted.filter((r) => r.judgement.match);
  console.log(
    `자신 있는 채점: ${pct(trustedMatched.length, trusted.length)}  (${trustedMatched.length}/${trusted.length})  ` +
      `— confidence >= ${CONFIDENCE_FLOOR} 인 것만. 화면에 실제로 나가는 판정이다.`
  );

  const lowConfidence = scored.length - trusted.length;
  console.log(
    `자기 채점 폴백: ${pct(lowConfidence, scored.length)}  (${lowConfidence}/${scored.length})  ` +
      `— confidence < ${CONFIDENCE_FLOOR}. 너무 높으면 자동 채점의 의미가 없고, ` +
      `사람 판정과 어긋난 항목이 여기 몰려 있으면 confidence 정의가 제 몫을 한 것이다.`
  );

  const byGroup = (key) => {
    const groups = new Map();
    for (const row of rows) {
      const name = key(row);
      const group = groups.get(name) ?? { total: 0, matched: 0 };
      group.total += 1;
      if (row.judgement.match) group.matched += 1;
      groups.set(name, group);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  };

  console.log('\n카테고리별');
  for (const [name, g] of byGroup((r) => r.item.category)) {
    console.log(`  ${name.padEnd(10)} ${pct(g.matched, g.total)}  (${g.matched}/${g.total})`);
  }

  console.log('\nkind 별');
  for (const [name, g] of byGroup((r) => r.item.kind)) {
    console.log(`  ${name.padEnd(10)} ${pct(g.matched, g.total)}  (${g.matched}/${g.total})`);
  }

  const mismatches = rows.filter((r) => !r.judgement.match);
  if (mismatches.length > 0) {
    console.log('\n불일치 항목 (여기가 프롬프트를 고칠 자리다)');
    for (const { item, judgement, outcome } of mismatches) {
      const confidence = outcome.grade?.confidence;
      console.log(
        `  ${item.source}/${item.id} [${item.category}] ` +
          `사람=${judgement.expected} 모델=${judgement.actual}` +
          (confidence === undefined ? '' : ` (confidence ${confidence})`)
      );
      console.log(`      근거: ${item.expected.note}`);
      if (outcome.grade?.feedback) console.log(`      모델: ${outcome.grade.feedback}`);
    }
  }

  const totalMs = rows.reduce((sum, r) => sum + r.outcome.elapsedMs, 0);
  console.log(`\n총 소요 ${(totalMs / 1000).toFixed(1)}초 (건당 평균 ${(totalMs / rows.length / 1000).toFixed(1)}초)`);
  console.log('\n토큰 사용량은 위 [ai/grade] 로그 줄의 usage 에 있다.');
  console.log('기록할 것은 `.env.example` 하단 "평가셋 측정 절차" 를 볼 것.');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  requireApiKey();

  // 러너는 한 IP 로 30건을 연달아 보낸다. 기본 레이트리밋(분당 10)에 걸리므로
  // 여기서만 올린다. guard.js 가 모듈 로드 시점에 읽으므로 import 전에 설정해야 한다.
  process.env.AI_RATE_LIMIT_PER_MIN ||= '1000';
  // 접근 코드는 배포 게이트라 평가에는 상관없다. 켜져 있으면 401 이 나므로 끈다.
  process.env.AI_ACCESS_CODE = '';

  const { POST } = await import('../api/ai/grade.js');

  const evalSet = JSON.parse(readFileSync(EVAL_PATH, 'utf8'));
  let items = evalSet.items;
  if (args.only) items = items.filter((item) => args.only.includes(item.category));
  if (args.limit) items = items.slice(0, args.limit);

  if (items.length === 0) {
    console.error('돌릴 항목이 없습니다. --only 값을 확인하세요.');
    process.exit(1);
  }

  console.log(`평가셋 ${items.length}건을 채점합니다 (실제 API 호출 — 비용이 발생합니다).\n`);

  const rows = [];
  for (const [index, item] of items.entries()) {
    const label = `[${String(index + 1).padStart(2)}/${items.length}] ${item.source}/${item.id} (${item.kind}, ${item.category})`;

    let outcome;
    try {
      outcome = await runItem(POST, item);
    } catch (error) {
      // 한 건이 터져도 나머지는 계속 돈다 — 30건을 다시 태우는 비용이 아깝다.
      outcome = { status: 0, error: { code: 'RUNNER', message: String(error) }, elapsedMs: 0 };
    }

    const judgement = judge(item, outcome);
    rows.push({ item, outcome, judgement });

    console.log(
      `${label}  ${judgement.match ? '일치' : '불일치'}  ` +
        `사람=${judgement.expected} 모델=${judgement.actual}` +
        (outcome.grade ? ` score=${outcome.grade.score} conf=${outcome.grade.confidence}` : '')
    );
  }

  printSummary(rows);

  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(
      args.out,
      JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          evalSetVersion: evalSet.version,
          total: rows.length,
          matched: rows.filter((r) => r.judgement.match).length,
          rows,
        },
        null,
        2
      ),
      'utf8'
    );
    console.log(`\n원자료를 ${args.out} 에 저장했습니다.`);
  }
}

main().catch((error) => {
  console.error('평가셋 실행이 실패했습니다:', error);
  process.exit(1);
});
