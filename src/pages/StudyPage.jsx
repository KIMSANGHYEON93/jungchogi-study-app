import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import MarkdownViewer from '../components/MarkdownViewer';
import useStudyTimer from '../hooks/useStudyTimer';
import { fetchMarkdown } from '../utils/mdCache';

const FILES = [
  { name: 'Day 01 — C언어', file: '정처기_Day01_C언어.md' },
  { name: 'Day 02 — Java', file: '정처기_Day02_Java.md' },
  { name: 'Day 03 — Python+SQL', file: '정처기_Day03_Python_SQL.md' },
  { name: 'Day 04 — SQL심화', file: '정처기_Day04_SQL심화_알고리즘.md' },
  { name: 'Day 05 — 디자인패턴/UML', file: '정처기_Day05_디자인패턴_UML.md' },
  { name: 'Day 06 — SW공학', file: '정처기_Day06_소프트웨어공학.md' },
  { name: 'Day 07 — 코드복습', file: '정처기_Day07_코드종합복습.md' },
  { name: 'Day 08 — 이론총정리', file: '정처기_Day08_이론용어총정리.md' },
  { name: 'Day 09 — 모의고사1', file: '정처기_Day09_모의고사1회.md' },
  { name: 'Day 10 — 약점보강', file: '정처기_Day10_약점보강.md' },
  { name: 'Day 11 — 모의고사2', file: '정처기_Day11_모의고사2회.md' },
  { name: 'Day 12 — 최종정리', file: '정처기_Day12_최종정리.md' },
  { name: 'Day 13 — 시험전날', file: '정처기_Day13_시험전날.md' },
  { name: 'Day 14 — 시험당일', file: '정처기_Day14_시험당일.md' },
  { name: '보강 — 기출+암기119선', file: '정처기_보강_기출분석_암기119선.md' },
  { name: '단답형 100선', file: '정처기_단답형_100선.md' },
  { name: '코드 트레이싱 드릴', file: '정처기_코드트레이싱_드릴.md' },
  { name: '합격 전략 가이드', file: '정보처리기사_실기_합격전략.md' },
];

// `/study?day=6` → FILES 인덱스. Day N 은 FILES[N-1] 이다.
// 오늘의 계획 카드의 study_day 항목이 이 경로로 들어온다.
function indexForDayParam(raw) {
  const day = Number(raw);
  if (!Number.isInteger(day) || day < 1 || day > 14) return 0;
  return day - 1;
}

export default function StudyPage() {
  useStudyTimer();
  const [searchParams] = useSearchParams();
  // 첫 렌더에만 URL 을 읽는다 — 이후 선택은 사용자 조작이 소유한다.
  // effect 로 동기화하지 않으므로 set-state-in-effect 가 생기지 않는다.
  const [selectedIdx, setSelectedIdx] = useState(() => indexForDayParam(searchParams.get('day')));
  // 로드 결과에 해당 인덱스를 함께 담아 loading/content 를 파생 상태로 계산한다
  const [loaded, setLoaded] = useState({ idx: -1, text: '' });
  const loading = loaded.idx !== selectedIdx;
  const content = loading ? '' : loaded.text;

  useEffect(() => {
    let cancelled = false;
    fetchMarkdown(FILES[selectedIdx].file)
      .then((text) => {
        if (cancelled) return;
        setLoaded({ idx: selectedIdx, text });
        window.scrollTo(0, 0);
      })
      .catch(() => {
        if (cancelled) return;
        setLoaded({ idx: selectedIdx, text: '파일을 불러올 수 없습니다.' });
      });
    return () => { cancelled = true; };
  }, [selectedIdx]);

  return (
    <div className="page">
      <h1>학습 노트</h1>
      <p className="subtitle">Day 1~14 학습 자료 + 보강 자료 뷰어</p>

      <div className="layout-with-sidebar">
        <aside className="sidebar" role="tablist" aria-label="학습 주제">
          {FILES.map((f, i) => (
            <div
              key={i}
              className={`sidebar-item ${i === selectedIdx ? 'active' : ''}`}
              onClick={() => setSelectedIdx(i)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedIdx(i); } }}
              role="tab"
              tabIndex={0}
              aria-selected={i === selectedIdx}
            >
              {f.name}
            </div>
          ))}
        </aside>

        <div className="main-content" role="tabpanel">
          {loading ? (
            <div className="card" style={{ textAlign: 'center', padding: 60 }}>
              불러오는 중...
            </div>
          ) : (
            <div className="card">
              <MarkdownViewer content={content} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
