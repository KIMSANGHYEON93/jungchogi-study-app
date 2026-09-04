import { useState } from 'react';
import Icon from './Icon';
import {
  clearUsageLedger,
  downloadUsageLedger,
  getUsageSummaries,
} from '../utils/usageLedger';

/**
 * 엔드포인트 이름 → 화면 라벨.
 * 서버 계약의 이름(`tutor`)을 그대로 띄우면 사용자는 그게 무슨 기능인지 모른다.
 */
const ENDPOINT_LABEL = {
  tutor: '해설',
  plan: '플래너',
  grade: '채점',
  generate: '변형 문제 생성',
  unknown: '기타',
};

// 화면에 세우는 순서. 쓰이지 않은 엔드포인트는 줄을 만들지 않는다.
const ENDPOINT_ORDER = ['tutor', 'plan', 'grade', 'generate', 'unknown'];

/**
 * 비용 표기.
 *
 * 회당 비용은 센트 단위(약 $0.01)라 소수 둘째 자리로 자르면 전부 `$0.01` 로 뭉개진다.
 * $1 미만은 넷째 자리까지 보여 주고, 그 위로는 두 자리로 읽기 쉽게 둔다.
 */
function formatUsd(value) {
  if (!value) return '$0';
  return value >= 1 ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`;
}

/** 캐시 적중률. 잴 것이 없으면(입력 토큰 0) 0% 가 아니라 `—` 다. */
function formatRate(rate) {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

function formatTokens(count) {
  if (count < 1000) return String(count);
  if (count < 1000000) return `${(count / 1000).toFixed(1)}K`;
  return `${(count / 1000000).toFixed(2)}M`;
}

/**
 * AI 사용량 카드 (BLUEPRINT §5 Phase 5).
 *
 * 이 앱은 사용자 본인의 API 키로 돈다 — 해설·플래너·채점을 부를 때마다
 * 사용자 지갑에서 돈이 나간다. 얼마를 썼는지 볼 수 있어야 조절할 수 있다.
 *
 * **기록이 하나도 없는 것이 기본 상태다.** 아직 아무도 AI 를 쓰지 않았을 때
 * 0 이 늘어선 표를 띄우면 화면만 어지럽고 알려 주는 것이 없다 — 한 줄로 접는다.
 *
 * 집계는 열 때 한 번만 읽는다. effect 에서 setState 를 하지 않으므로
 * react-hooks 의 set-state-in-effect 를 건드리지 않는다.
 */
export default function UsageSummaryCard() {
  const [summaries, setSummaries] = useState(getUsageSummaries);

  const handleClear = () => {
    if (!window.confirm('AI 사용 기록을 모두 지웁니다. 학습 데이터는 그대로 남습니다. 계속할까요?')) {
      return;
    }
    clearUsageLedger();
    setSummaries(getUsageSummaries());
  };

  if (!summaries.hasRecords) {
    return (
      <div className="card" style={{ marginTop: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Icon name="zap" size={18} />
          <h2 style={{ fontSize: '1.1rem', margin: 0 }}>AI 사용량</h2>
        </div>
        <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: '0.88rem', lineHeight: 1.6 }}>
          아직 AI 기능을 사용한 기록이 없습니다. 해설·플래너·채점을 쓰면 여기에 예상 비용이 쌓입니다.
        </p>
      </div>
    );
  }

  const { today, week, all } = summaries;
  const usedEndpoints = ENDPOINT_ORDER.filter((name) => all.byEndpoint[name]);

  return (
    <div className="card" style={{ marginTop: 32 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="zap" size={18} />
          <h2 style={{ fontSize: '1.1rem', margin: 0 }}>AI 사용량</h2>
        </div>
        {/* 비용은 서버가 계산해 보낸 추정치다. 실제 청구액은 Anthropic 콘솔이 정한다. */}
        <span className="badge badge-warning" title="서버가 계산한 추정 비용입니다">
          추정치
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 8,
          marginBottom: 16,
        }}
      >
        {[
          { label: '오늘', summary: today },
          { label: '이번 주', summary: week },
          { label: '전체', summary: all },
        ].map(({ label, summary }) => (
          <div
            key={label}
            style={{
              background: 'var(--bg-hover)',
              borderRadius: 'var(--radius)',
              padding: 'var(--space-md)',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text)' }}>
              {formatUsd(summary.costUsd)}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginTop: 2 }}>
              {summary.calls}회
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '0.85rem',
            marginBottom: 6,
          }}
        >
          {/* 캐시가 듣고 있는지가 비용의 첫 번째 레버다 (BLUEPRINT §6.1) */}
          <span style={{ color: 'var(--text-dim)' }}>캐시 적중률</span>
          <span style={{ fontWeight: 600 }}>{formatRate(all.cacheHitRate)}</span>
        </div>
        <div className="progress-bar">
          <div
            className="fill"
            style={{
              width: `${(all.cacheHitRate ?? 0) * 100}%`,
              background: 'var(--success)',
            }}
          />
        </div>
        <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginTop: 6 }}>
          입력 {formatTokens(all.inputTokens + all.cacheReadTokens + all.cacheCreationTokens)} · 출력{' '}
          {formatTokens(all.outputTokens)} 토큰
        </div>
      </div>

      <ul style={{ listStyle: 'none', margin: '0 0 16px', padding: 0 }}>
        {usedEndpoints.map((name) => {
          const bucket = all.byEndpoint[name];
          return (
            <li
              key={name}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: 8,
                padding: '6px 0',
                borderTop: '1px solid var(--border)',
                fontSize: '0.88rem',
              }}
            >
              <span>{ENDPOINT_LABEL[name]}</span>
              <span style={{ color: 'var(--text-dim)' }}>
                {bucket.calls}회 · {formatUsd(bucket.costUsd)}
              </span>
            </li>
          );
        })}
      </ul>

      {all.failedCalls > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 16,
            fontSize: '0.85rem',
            color: 'var(--warning)',
          }}
        >
          <Icon name="alert-circle" size={14} />
          실패한 호출 {all.failedCalls}회 — 실패해도 입력 토큰은 청구될 수 있습니다.
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn-outline" onClick={() => downloadUsageLedger()}>
          사용 기록 내보내기
        </button>
        <button className="btn-outline" style={{ color: 'var(--danger)' }} onClick={handleClear}>
          사용 기록 비우기
        </button>
      </div>
    </div>
  );
}
