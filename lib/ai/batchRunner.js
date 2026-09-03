// Batch API 호출 계층 — 생성 · 폴링 · 결과 수거 · 재개 기록.
//
// Batch 는 **최대 24시간** 걸릴 수 있다. 그래서 두 가지가 필요하다:
//   1) 지수 백오프 폴링 — 한 시간을 5초마다 두드릴 이유가 없다.
//   2) 재개 — 배치를 만들자마자 batch id 를 파일로 남기고, 나중에
//      `--resume <batch_id>` 로 결과만 다시 수거할 수 있게 한다.
//
// 순수 로직(요청 조립·결과 매칭)은 `lib/ai/variants.js`, 파일 계약은
// `lib/ai/generated.js` 에 있다. 여기는 SDK 를 만지는 층이다.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getClient, classifyUpstreamError } from './client.js';

/** 첫 폴링 간격. 짧은 배치(문항 몇 개)는 1분 안에 끝나기도 한다. */
export const POLL_INITIAL_MS = 5_000;
/** 폴링 간격 상한. 이보다 뜸해지면 끝난 배치를 오래 붙잡고 있게 된다. */
export const POLL_MAX_MS = 60_000;
export const POLL_FACTOR = 1.6;
/** 기본 대기 상한 — Batch 자체의 만료 시간(24시간)과 같게 둔다. */
export const DEFAULT_TIMEOUT_MS = 24 * 60 * 60 * 1_000;

/**
 * 재개 기록을 두는 곳. 생성물(`public/`)과 섞지 않는다 — 배포에 나갈 파일이 아니다.
 * @returns {string}
 */
export function defaultRecordDir() {
  return fileURLToPath(new URL('../../claudedocs/generated-batches', import.meta.url));
}

/**
 * 다음 폴링 간격.
 * @param {number} previousMs 직전 간격 (첫 폴링이면 0)
 * @returns {number}
 */
export function nextPollDelay(previousMs) {
  if (!previousMs) return POLL_INITIAL_MS;
  return Math.min(POLL_MAX_MS, Math.round(previousMs * POLL_FACTOR));
}

/** SDK 예외를 계약된 오류로 바꿔 다시 던진다 (`classifyUpstreamError` 재사용). */
function rethrowUpstream(error) {
  const failure = classifyUpstreamError(error);
  const wrapped = new Error(failure.message);
  Object.assign(wrapped, failure, { cause: error });
  throw wrapped;
}

/**
 * 배치를 만든다.
 * @param {Array<{custom_id: string, params: object}>} requests
 * @returns {Promise<object>} MessageBatch
 */
export async function createVariantBatch(requests) {
  try {
    return await getClient().messages.batches.create({ requests });
  } catch (error) {
    return rethrowUpstream(error);
  }
}

/**
 * `processing_status` 가 `ended` 가 될 때까지 기다린다.
 *
 * `in_progress` 와 `canceling` 은 둘 다 "아직" 이다 — `ended` 만 끝이다.
 * 제한 시간을 넘기면 **batch id 를 메시지에 담아** 던진다. 그래야 `--resume` 으로
 * 이어받을 수 있다.
 *
 * @param {string} batchId
 * @param {{sleep?: (ms: number) => Promise<void>|void, onPoll?: (batch: object) => void,
 *          now?: () => number, timeoutMs?: number}} [options]
 * @returns {Promise<object>} 끝난 MessageBatch
 */
export async function waitForBatchEnd(batchId, options = {}) {
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = now();

  let delay = 0;
  for (;;) {
    let batch;
    try {
      batch = await getClient().messages.batches.retrieve(batchId);
    } catch (error) {
      rethrowUpstream(error);
    }

    options.onPoll?.(batch);
    if (batch.processing_status === 'ended') return batch;

    if (now() - startedAt >= timeoutMs) {
      throw new Error(
        `배치 ${batchId} 가 제한 시간 안에 끝나지 않았습니다. ` +
          `--resume ${batchId} 로 결과만 다시 수거할 수 있습니다.`
      );
    }

    delay = nextPollDelay(delay);
    await sleep(delay);
  }
}

/**
 * 결과 스트림(JSONL 디코더)을 연다. 소비는 `for await`.
 * @param {string} batchId
 * @returns {Promise<AsyncIterable<object>>}
 */
export async function streamBatchResults(batchId) {
  try {
    return await getClient().messages.batches.results(batchId);
  } catch (error) {
    return rethrowUpstream(error);
  }
}

/**
 * 배치를 취소한다 (`ended` 전에만 의미가 있다).
 * @param {string} batchId
 * @returns {Promise<object>}
 */
export async function cancelBatch(batchId) {
  try {
    return await getClient().messages.batches.cancel(batchId);
  } catch (error) {
    return rethrowUpstream(error);
  }
}

/** batch id 를 파일명으로 쓰기 전에 경로 구분자를 막는다. */
function assertSafeBatchId(batchId) {
  if (typeof batchId !== 'string' || batchId === '' || /[\\/]/.test(batchId) || batchId.includes('..')) {
    throw new Error(`batch id 로 쓸 수 없는 값입니다: ${batchId}`);
  }
  return batchId;
}

/**
 * @param {string} batchId
 * @param {string} [dir]
 * @returns {string}
 */
export function batchRecordPath(batchId, dir = defaultRecordDir()) {
  return join(dir, `${assertSafeBatchId(batchId)}.json`);
}

/**
 * @typedef {object} BatchRecord
 * @property {string} batchId
 * @property {string} source
 * @property {string[]} ids 이 배치에 넣은 원본 문항 id
 * @property {number} variantsPerItem
 * @property {string} out 결과를 쓸 파일 경로
 * @property {string} createdAt
 */

/**
 * 재개 기록을 남긴다. **배치를 만든 직후** 부르는 것이 중요하다 —
 * 그 뒤에 프로세스가 죽어도 batch id 를 잃지 않는다.
 * @param {BatchRecord} record
 * @param {{dir?: string}} [options]
 * @returns {string} 기록 파일 경로
 */
export function saveBatchRecord(record, options = {}) {
  const dir = options.dir ?? defaultRecordDir();
  const path = batchRecordPath(record.batchId, dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return path;
}

/**
 * @param {string} batchId
 * @param {{dir?: string}} [options]
 * @returns {BatchRecord|null} 기록이 없으면 null
 */
export function loadBatchRecord(batchId, options = {}) {
  const path = batchRecordPath(batchId, options.dir ?? defaultRecordDir());
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}
