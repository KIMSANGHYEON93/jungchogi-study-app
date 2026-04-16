import { useState, useEffect } from 'react';
import MarkdownViewer from '../components/MarkdownViewer';
import useStudyTimer from '../hooks/useStudyTimer';

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

export default function StudyPage() {
  useStudyTimer();
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/data/${FILES[selectedIdx].file}`)
      .then((r) => r.text())
      .then((text) => {
        setContent(text);
        setLoading(false);
        window.scrollTo(0, 0);
      })
      .catch(() => {
        setContent('파일을 불러올 수 없습니다.');
        setLoading(false);
      });
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
