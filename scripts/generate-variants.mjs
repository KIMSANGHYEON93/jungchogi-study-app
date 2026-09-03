#!/usr/bin/env node
// 변형 문제 생성기 — Batch API (블루프린트 §4.4 · §5 Phase 4).
//
// **엔드포인트가 아니라 스크립트다.** 블루프린트 §4.4 의 정정 사유:
//   · Vercel 서버리스는 파일시스템이 읽기 전용이라 `public/data/` 에 쓸 수 없다.
//   · 결과물은 런타임 생성이 아니라 **리포에 커밋되는 파일**이다.
//   · Batch 는 완료까지 최대 24시간 걸려 함수 실행 시간 안에 끝나지 않는다.
//
// 사용법:
//   node scripts/generate-variants.mjs --source quiz100 --ids 001,002,042
//   node scripts/generate-variants.mjs --source codedrill --category sql --variants 3
//   node scripts/generate-variants.mjs --source bogang --all --yes
//   node scripts/generate-variants.mjs --resume msgbatch_01ABC...     # 결과만 다시 수거
//
// 옵션:
//   --source <quiz100|codedrill|bogang>   필수 (--resume 이면 기록에서 읽는다)
//   --ids <id,id,...>                     문항 선택. --all / --category 와 택일
//   --all                                 source 전체
//   --category <이름>                     카테고리(드릴은 언어)로 선택
//   --variants <n>                        문항당 변형 수 (기본 2)
//   --out <path>                          기본 public/data/generated/<source>.json
//   --yes                                 비용 확인 프롬프트를 건너뛴다
//   --resume <batch_id>                   이미 만든 배치의 결과만 수거한다
//   --record-dir <path>                   재개 기록 위치 (기본 claudedocs/generated-batches)
//   --timeout-hours <n>                   폴링 대기 상한 (기본 24 — Batch 만료와 같다)
//
// ⚠️ **실제 API 를 호출하므로 비용이 든다.** 그래서 `npm test` 에 넣지 않는다 —
//    키 없이 실패하면 CI 가 깨진다. 계약 검증만 하려면 `scripts/validate-generated.mjs`.
//
// 생성물은 항상 `reviewed: false` 로 나온다. 사람 검수를 통과해야 손으로 true 로 올리며,
// 그 전까지 앱은 이 파일을 쓰지 않는다. 검수 절차: `claudedocs/GENERATED_REVIEW.md`

import { relative } from 'node:path';
import { createInterface } from 'node:readline/promises';

import {
  DEFAULT_VARIANTS,
  PRICE_INPUT_PER_MTOK,
  PRICE_OUTPUT_PER_MTOK,
  BATCH_DISCOUNT,
  VARIANT_SOURCES,
  selectProblems,
  buildVariantRequests,
  estimateVariantCost,
  collectVariantResults,
} from '../lib/ai/variants.js';
import { loadSource } from '../lib/ai/content.js';
import {
  buildGeneratedDoc,
  saveGeneratedDoc,
  generatedPath,
  validateGeneratedDoc,
} from '../lib/ai/generated.js';
import {
  createVariantBatch,
  waitForBatchEnd,
  streamBatchResults,
  saveBatchRecord,
  loadBatchRecord,
} from '../lib/ai/batchRunner.js';

const HOUR_MS = 60 * 60 * 1_000;

function parseArgs(argv) {
  const args = {
    source: null,
    ids: null,
    all: false,
    category: null,
    variants: DEFAULT_VARIANTS,
    out: null,
    yes: false,
    resume: null,
    recordDir: null,
    timeoutHours: 24,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--source') args.source = value;
    else if (flag === '--ids') args.ids = value?.split(',').map((s) => s.trim()).filter(Boolean);
    else if (flag === '--all') args.all = true;
    else if (flag === '--category') args.category = value;
    else if (flag === '--variants') args.variants = Number(value);
    else if (flag === '--out') args.out = value;
    else if (flag === '--yes' || flag === '-y') args.yes = true;
    else if (flag === '--resume') args.resume = value;
    else if (flag === '--record-dir') args.recordDir = value;
    else if (flag === '--timeout-hours') args.timeoutHours = Number(value);
  }
  return args;
}

function requireApiKey() {
  if (process.env.ANTHROPIC_API_KEY?.trim()) return;

  console.error(
    [
      '',
      'ANTHROPIC_API_KEY 가 설정되지 않았습니다. 이 생성기는 실제 Anthropic Batch API 를 호출합니다.',
      '',
      '  PowerShell : $env:ANTHROPIC_API_KEY = "sk-ant-..."; node scripts/generate-variants.mjs --source quiz100 --ids 001',
      '  bash       : ANTHROPIC_API_KEY=sk-ant-... node scripts/generate-variants.mjs --source quiz100 --ids 001',
      '',
      '키 발급: https://console.anthropic.com/ → API Keys',
      '(자동 테스트 `npm test` 는 SDK 를 모킹하므로 키가 필요 없습니다.',
      ' 이미 만든 생성물의 계약 검증만 하려면 `node scripts/validate-generated.mjs` — 키가 필요 없습니다.)',
      '',
    ].join('\n')
  );
  process.exit(1);
}

const usd = (n) => `$${n.toFixed(4)}`;

/** 실행 전에 자릿수를 알려주고, `--yes` 가 없으면 사람에게 묻는다. */
async function confirmCost({ source, problems, variants, requests, out, yes }) {
  const estimate = estimateVariantCost(requests);

  console.log('');
  console.log('─'.repeat(78));
  console.log(`source          : ${source}`);
  console.log(`문항            : ${problems.length}개`);
  console.log(`변형            : 문항당 ${variants}개`);
  console.log(`요청            : ${estimate.requestCount}건`);
  console.log(
    `추정 토큰       : 입력 ${estimate.inputTokens.toLocaleString()} · ` +
      `출력 ${estimate.outputTokens.toLocaleString()} (thinking 포함)`
  );
  console.log(
    `추정 비용       : 약 ${usd(estimate.usd)} ` +
      `(Opus 5 정가 $${PRICE_INPUT_PER_MTOK}/$${PRICE_OUTPUT_PER_MTOK} per MTok, ` +
      `Batch ${BATCH_DISCOUNT * 100}% 할인 반영)`
  );
  console.log(`저장 위치       : ${out}`);
  console.log('─'.repeat(78));
  console.log(
    '토큰 수는 글자 수에서 어림한 값이라 ±50% 는 어긋날 수 있습니다. ' +
      '실제 사용량은 배치가 끝난 뒤 찍힙니다.'
  );

  if (yes) return;

  if (!process.stdin.isTTY) {
    console.error('\n대화형 터미널이 아닙니다. 비용을 확인했다면 --yes 를 붙여 다시 실행하세요.');
    process.exit(1);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('\n이대로 배치를 만들까요? [y/N] ');
  rl.close();

  if (!/^y(es)?$/i.test(answer.trim())) {
    console.log('취소했습니다. 아무것도 보내지 않았습니다.');
    process.exit(0);
  }
}

/** 폴링 진행 상황 한 줄 */
function reportPoll(batch, startedAt) {
  const counts = batch.request_counts;
  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  console.log(
    `[${String(elapsed).padStart(5)}s] ${batch.processing_status.padEnd(12)} ` +
      `처리중 ${counts.processing} · 성공 ${counts.succeeded} · 오류 ${counts.errored} · ` +
      `만료 ${counts.expired} · 취소 ${counts.canceled}`
  );
}

function reportFailures(failures) {
  if (failures.length === 0) {
    console.log('\n실패한 요청은 없습니다.');
    return;
  }

  const byType = new Map();
  for (const failure of failures) {
    byType.set(failure.type, [...(byType.get(failure.type) ?? []), failure]);
  }

  console.log(`\n실패 ${failures.length}건`);
  for (const [type, rows] of [...byType.entries()].sort()) {
    console.log(`  ${type.padEnd(10)} ${rows.length}건 — ${rows.map((r) => r.customId).join(', ')}`);
    console.log(`             ${rows[0].message}`);
  }
  console.log(
    '\n  expired 는 다시 제출해야 하고, errored 는 같은 문항으로 다시 돌리면 됩니다.\n' +
      '  invalid/truncated 는 프롬프트나 max_tokens 를 손볼 자리입니다.'
  );
}

function reportUsage(usage) {
  const actual =
    ((usage.inputTokens * PRICE_INPUT_PER_MTOK + usage.outputTokens * PRICE_OUTPUT_PER_MTOK) /
      1_000_000) *
    BATCH_DISCOUNT;

  console.log(
    `\n실제 사용량: 입력 ${usage.inputTokens.toLocaleString()} · ` +
      `출력 ${usage.outputTokens.toLocaleString()} · ` +
      `캐시 읽기 ${usage.cacheReadInputTokens.toLocaleString()} → 약 ${usd(actual)}`
  );
  if (usage.cacheReadInputTokens === 0) {
    console.log(
      '  ⚠️ 캐시 읽기가 0 입니다. 같은 시스템 프리픽스를 쓰는 요청이 여러 건인데도 ' +
        '적중하지 않았다면 프리픽스에 가변 요소가 섞인 것입니다.'
    );
  }
}

/** 배치 결과를 수거해 파일로 굳힌다 (신규 실행과 --resume 이 공유하는 경로). */
async function collectAndSave({ batchId, source, out, startedAt, timeoutHours }) {
  console.log(`\n배치 ${batchId} 가 끝나기를 기다립니다. 최대 24시간까지 걸릴 수 있습니다.`);
  console.log(`중간에 끊기면 --resume ${batchId} 로 결과만 다시 수거할 수 있습니다.\n`);

  await waitForBatchEnd(batchId, {
    onPoll: (batch) => reportPoll(batch, startedAt),
    timeoutMs: timeoutHours * HOUR_MS,
  });

  const results = await streamBatchResults(batchId);
  const { items, failures, usage } = await collectVariantResults({
    results,
    source,
    originals: loadSource(source),
  });

  reportFailures(failures);
  reportUsage(usage);

  if (items.length === 0) {
    console.error('\n저장할 항목이 없습니다. 파일을 건드리지 않았습니다.');
    process.exit(1);
  }

  const doc = buildGeneratedDoc({ source, items });
  const validation = validateGeneratedDoc(doc, { originals: loadSource(source) });

  const path = saveGeneratedDoc(doc, { path: out });
  console.log(`\n생성 문항 ${items.length}건을 ${relative(process.cwd(), path)} 에 저장했습니다.`);

  if (!validation.ok) {
    console.error(`\n⚠️ 계약 위반 ${validation.issues.length}건 — 검수 전에 먼저 고쳐야 합니다.`);
    for (const issue of validation.issues.slice(0, 20)) {
      console.error(`  ${issue.path}: ${issue.message}`);
    }
    process.exit(1);
  }

  console.log(
    '\n계약 검증 통과. 이 파일은 `reviewed: false` 입니다 — 앱은 아직 쓰지 않습니다.\n' +
      '사람 검수 절차는 claudedocs/GENERATED_REVIEW.md 를 보세요.'
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  requireApiKey();

  const startedAt = Date.now();

  if (args.resume) {
    const record = loadBatchRecord(args.resume, { dir: args.recordDir ?? undefined });
    if (!record) {
      console.error(
        `배치 기록을 찾지 못했습니다: ${args.resume}\n` +
          '--source 와 --out 을 직접 주면 기록 없이도 수거할 수 있습니다.'
      );
      if (!args.source) process.exit(1);
    }

    const source = args.source ?? record.source;
    const out = args.out ?? record?.out ?? generatedPath(source);
    await collectAndSave({
      batchId: args.resume,
      source,
      out,
      startedAt,
      timeoutHours: args.timeoutHours,
    });
    return;
  }

  if (!VARIANT_SOURCES.includes(args.source)) {
    console.error(
      `--source 가 필요합니다 (${VARIANT_SOURCES.join('|')}). 받은 값: ${args.source}`
    );
    process.exit(1);
  }

  if (!args.all && !args.ids && !args.category) {
    console.error(
      '문항을 골라야 합니다: --ids <id,id,...> 또는 --category <이름> 또는 --all.\n' +
        'source 전체를 돌리면 비용이 큽니다 — --all 은 의도적으로 명시해야 합니다.'
    );
    process.exit(1);
  }

  const problems = selectProblems({
    source: args.source,
    ids: args.ids,
    category: args.category,
  });
  const requests = buildVariantRequests({
    source: args.source,
    problems,
    variantsPerItem: args.variants,
  });
  const out = args.out ?? generatedPath(args.source);

  await confirmCost({
    source: args.source,
    problems,
    variants: args.variants,
    requests,
    out,
    yes: args.yes,
  });

  const batch = await createVariantBatch(requests);

  // 배치를 만든 **직후** 기록을 남긴다 — 여기서 프로세스가 죽어도 batch id 를 잃지 않는다.
  const recordPath = saveBatchRecord(
    {
      batchId: batch.id,
      source: args.source,
      ids: problems.map((problem) => problem.id),
      variantsPerItem: args.variants,
      out,
      createdAt: new Date().toISOString(),
    },
    { dir: args.recordDir ?? undefined }
  );
  console.log(`\n배치 ${batch.id} 를 만들었습니다. 기록: ${relative(process.cwd(), recordPath)}`);

  await collectAndSave({
    batchId: batch.id,
    source: args.source,
    out,
    startedAt,
    timeoutHours: args.timeoutHours,
  });
}

main().catch((error) => {
  console.error('\n변형 생성이 실패했습니다:', error.message ?? error);
  if (error.code) console.error(`  분류: ${error.code} (retryable: ${error.retryable})`);
  process.exit(1);
});
