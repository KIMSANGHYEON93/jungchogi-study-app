#!/usr/bin/env node
// 생성물 계약 검증기 (블루프린트 §4.4 · §5 Phase 4).
//
// **API 키가 필요 없다.** 커밋된 생성물이 프론트엔드와 공유하는 계약을 지키는지
// 기계적으로 확인한다. 같은 검증을 `tests/gen-contract.test.js` 가 `npm test` 안에서
// 돌리므로 CI 도 이 규칙을 지킨다.
//
// 사용법:
//   node scripts/validate-generated.mjs                       # public/data/generated/*.json 전부
//   node scripts/validate-generated.mjs path/to/quiz100.json   # 특정 파일
//
// 검증기가 잡는 것과 못 잡는 것은 `lib/ai/generated.js` 의 validateGeneratedDoc 주석과
// `claudedocs/GENERATED_REVIEW.md` 를 볼 것 — **정답이 실제로 맞는지는 사람이 본다.**

import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { loadSource } from '../lib/ai/content.js';
import { listGeneratedFiles, validateGeneratedDoc } from '../lib/ai/generated.js';

function targets(argv) {
  const paths = argv.filter((value) => !value.startsWith('--'));
  return paths.length > 0 ? paths.map((path) => resolve(path)) : listGeneratedFiles();
}

function validateFile(path) {
  const shown = relative(process.cwd(), path);

  if (!existsSync(path)) {
    return { shown, issues: [{ path: '$', message: '파일이 없습니다.' }], reviewed: null, count: 0 };
  }

  let doc;
  try {
    doc = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return {
      shown,
      issues: [{ path: '$', message: `JSON 을 읽지 못했습니다: ${error.message}` }],
      reviewed: null,
      count: 0,
    };
  }

  const originals = loadSource(doc?.source);
  if (originals.length === 0) {
    return {
      shown,
      issues: [
        { path: 'source', message: `원본을 읽지 못했습니다 (source: ${doc?.source}).` },
      ],
      reviewed: doc?.reviewed ?? null,
      count: Array.isArray(doc?.items) ? doc.items.length : 0,
    };
  }

  const { issues } = validateGeneratedDoc(doc, { originals });
  return {
    shown,
    issues,
    reviewed: doc.reviewed,
    count: Array.isArray(doc.items) ? doc.items.length : 0,
  };
}

function main() {
  const files = targets(process.argv.slice(2));

  if (files.length === 0) {
    console.log('검증할 생성물이 없습니다 (public/data/generated 가 비어 있습니다).');
    return;
  }

  let failed = 0;

  for (const path of files) {
    const result = validateFile(path);

    if (result.issues.length === 0) {
      const state = result.reviewed ? '검수 완료 — 앱이 사용' : '미검수 — 앱이 사용하지 않음';
      console.log(`✅ ${result.shown}  항목 ${result.count}건  (${state})`);
      continue;
    }

    failed += 1;
    console.log(`❌ ${result.shown}  위반 ${result.issues.length}건`);
    for (const issue of result.issues) {
      console.log(`     ${issue.path}: ${issue.message}`);
    }
  }

  if (failed > 0) {
    console.error(`\n${failed}개 파일이 계약을 어겼습니다.`);
    process.exit(1);
  }

  console.log(`\n${files.length}개 파일이 계약을 지킵니다.`);
}

main();
