import { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { parseQuiz } from '../utils/parseQuiz';
import { saveProgress, loadProgress } from '../utils/storage';
import useSwipe from '../hooks/useSwipe';

const CATEGORIES = ['전체', '데이터베이스', '소프트웨어공학', '디자인패턴/UML', '테스트', '보안/네트워크', 'OS/기타'];

export default function FlashcardPage() {
  const [allCards, setAllCards] = useState([]);
  const [cards, setCards] = useState([]);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [category, setCategory] = useState('전체');
  const [known, setKnown] = useState({});      // { id: true/false }
  const [filterMode, setFilterMode] = useState('all'); // all | unknown

  useEffect(() => {
    fetch('/data/정처기_단답형_100선.md')
      .then((r) => r.text())
      .then((text) => {
        const parsed = parseQuiz(text);
        setAllCards(parsed);
        setCards(parsed);
        setKnown(loadProgress('flashcard_known', {}));
      });
  }, []);

  useEffect(() => {
    let filtered = allCards;
    if (category !== '전체') {
      filtered = filtered.filter((c) => c.category === category);
    }
    if (filterMode === 'unknown') {
      filtered = filtered.filter((c) => !known[c.id]);
    }
    setCards(filtered);
    setIdx(0);
    setFlipped(false);
  }, [category, filterMode, allCards, known]);

  const markKnown = useCallback((id, val) => {
    const next = { ...known, [id]: val };
    setKnown(next);
    saveProgress('flashcard_known', next);
  }, [known]);

  const next = () => { setFlipped(false); setIdx((i) => Math.min(i + 1, cards.length - 1)); };
  const prev = () => { setFlipped(false); setIdx((i) => Math.max(i - 1, 0)); };

  useEffect(() => {
    const handler = (e) => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setFlipped((f) => !f); }
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [cards]);

  const swipeHandlers = useSwipe({
    onSwipeLeft: next,
    onSwipeRight: prev,
  });

  const knownCount = allCards.filter((c) => known[c.id]).length;
  const current = cards[idx];

  return (
    <div className="page">
      <h1>플래시카드</h1>
      <p className="subtitle">단답형 100선 — 탭하여 뒤집기, 좌우 스와이프로 이동</p>

      <div className="stats">
        <div className="stat-box">
          <div className="value">{allCards.length}</div>
          <div className="label">전체 문제</div>
        </div>
        <div className="stat-box">
          <div className="value" style={{ color: 'var(--success)' }}>{knownCount}</div>
          <div className="label">외운 문제</div>
        </div>
        <div className="stat-box">
          <div className="value" style={{ color: 'var(--warning)' }}>{allCards.length - knownCount}</div>
          <div className="label">남은 문제</div>
        </div>
      </div>

      <div className="progress-bar">
        <div className="fill" style={{ width: `${allCards.length ? (knownCount / allCards.length) * 100 : 0}%` }} />
      </div>

      <div className="filter-bar">
        {CATEGORIES.map((cat) => (
          <button key={cat} className={`btn-outline ${category === cat ? 'active' : ''}`} onClick={() => setCategory(cat)}>
            {cat}
          </button>
        ))}
        <span style={{ margin: '0 8px', borderLeft: '1px solid var(--border)', height: 28 }} />
        <button className={`btn-outline ${filterMode === 'all' ? 'active' : ''}`} onClick={() => setFilterMode('all')}>전체</button>
        <button className={`btn-outline ${filterMode === 'unknown' ? 'active' : ''}`} onClick={() => setFilterMode('unknown')}>모르는 것만</button>
      </div>

      {cards.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 60 }}>
          {filterMode === 'unknown' ? '모든 카드를 외웠습니다! 🎉' : '문제를 불러오는 중...'}
        </div>
      ) : current ? (
        <>
          <div className="flashcard-container" {...swipeHandlers}>
            <div className={`flashcard ${flipped ? 'flipped' : ''}`} onClick={() => setFlipped(!flipped)}>
              <div className="flashcard-face">
                <span className="badge badge-primary" style={{ marginBottom: 16 }}>{current.category}</span>
                <h2 style={{ fontSize: '1.3rem', textAlign: 'center', lineHeight: 1.6 }}>
                  {current.id}. {current.question}
                </h2>
                <p style={{ color: 'var(--text-dim)', marginTop: 16, fontSize: '0.85rem' }}>클릭하여 정답 확인</p>
              </div>
              <div className="flashcard-face flashcard-back">
                <div className="md-content" style={{ width: '100%', fontSize: '0.95rem' }}>
                  <ReactMarkdown>{current.answer}</ReactMarkdown>
                </div>
              </div>
            </div>
          </div>

          <div className="flashcard-nav">
            <button className="btn-outline" onClick={prev} disabled={idx === 0}>◀ 이전</button>
            <button className="btn-danger" onClick={() => markKnown(current.id, false)} style={{ padding: '10px 16px' }}>모름 ✕</button>
            <span className="flashcard-counter">{idx + 1} / {cards.length}</span>
            <button className="btn-success" onClick={() => { markKnown(current.id, true); next(); }} style={{ padding: '10px 16px' }}>외움 ✓</button>
            <button className="btn-outline" onClick={next} disabled={idx === cards.length - 1}>다음 ▶</button>
          </div>
        </>
      ) : null}
    </div>
  );
}
