import { useState, useEffect, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { parseQuiz } from '../utils/parseQuiz';
import { parseBogang } from '../utils/parseBogang';
import { saveProgress, loadProgress, variantKnownKey } from '../utils/storage';
import useSwipe from '../hooks/useSwipe';
import useStudyTimer from '../hooks/useStudyTimer';
import useVariantPreference from '../hooks/useVariantPreference';
import { fetchMarkdown } from '../utils/mdCache';
import { applyGeneratedItems } from '../utils/generatedDeck';
import Icon from '../components/Icon';
import GeneratedBadge, { GeneratedAnswerNotice } from '../components/GeneratedBadge';
import VariantToggle from '../components/VariantToggle';
import { isGeneratedItem } from '../domain/generatedItems';

const CATEGORIES = ['전체', '데이터베이스', '소프트웨어공학', '디자인패턴/UML', '테스트', '보안/네트워크', 'OS/기타'];

// `source` 는 생성물 파일 이름(BLUEPRINT §4.4)이다.
// 덱 키(bogang119)와 교재 출처 이름(bogang)이 달라 한 곳에서 맞춰 둔다.
const DECKS = [
  { key: 'quiz100', label: '단답형 100선', file: '정처기_단답형_100선.md', parser: 'quiz', source: 'quiz100' },
  { key: 'bogang119', label: '암기 119선 보강', file: '정처기_보강_기출분석_암기119선.md', parser: 'bogang', source: 'bogang' },
];

export default function FlashcardPage() {
  useStudyTimer();
  const [deck, setDeck] = useState('quiz100');
  const [allCards, setAllCards] = useState([]);
  const [shuffled, setShuffled] = useState(null);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [category, setCategory] = useState('전체');
  const [known, setKnown] = useState({});
  // 변형 카드의 "외움"은 별도 맵에 쌓는다 — 아래 markKnown 주석 참조
  const [variantKnown, setVariantKnown] = useState({});
  const [filterMode, setFilterMode] = useState('all');
  const [includeVariants, changeIncludeVariants] = useVariantPreference();
  const [variantsAvailable, setVariantsAvailable] = useState(0);

  // 덱 변경 시 데이터 로드
  useEffect(() => {
    let cancelled = false;
    const deckInfo = DECKS.find((d) => d.key === deck);
    fetchMarkdown(deckInfo.file)
      .then((text) => {
        const parsed = deckInfo.parser === 'quiz' ? parseQuiz(text) : parseBogang(text);
        return applyGeneratedItems(parsed, deckInfo.source, includeVariants);
      })
      .then(({ items, available }) => {
        if (cancelled) return;
        setAllCards(items);
        setVariantsAvailable(available);
        setKnown(loadProgress(`flashcard_known_${deck}`, {}));
        setVariantKnown(loadProgress(variantKnownKey(deck), {}));
        setIdx(0);
        setFlipped(false);
        setCategory('전체');
        setFilterMode('all');
      });
    return () => { cancelled = true; };
  }, [deck, includeVariants]);

  // 외움 여부는 교재 카드와 변형 카드가 서로 다른 맵에 있다.
  // id 는 겹치지 않도록 병합 단계에서 보장되므로 카드가 어느 쪽인지만 보면 된다.
  const isKnown = useCallback(
    (card) => !!(isGeneratedItem(card) ? variantKnown : known)[card.id],
    [known, variantKnown]
  );

  // 필터 결과는 파생 상태 — effect 없이 렌더 중 계산한다
  const filtered = useMemo(() => {
    let f = allCards;
    if (category !== '전체') f = f.filter((c) => c.category === category);
    if (filterMode === 'unknown') f = f.filter((c) => !isKnown(c));
    return f;
  }, [allCards, category, filterMode, isKnown]);

  // 셔플은 그 대상이 지금의 filtered 와 같을 때만 유효하다
  const cards = shuffled && shuffled.source === filtered ? shuffled.order : filtered;

  // 변형 카드의 진도는 교재 진도와 **다른 키**에 쌓는다.
  // 대시보드는 `flashcard_known_<deck>` 의 값 개수를 분모 100(단답형)·24(보강)에
  // 나눠 진도를 낸다. 변형 id 가 같은 맵에 들어가면 진도가 100% 를 넘고
  // 종합 달성률까지 부풀려진다. 그래서 키를 갈라 둔다.
  const markKnown = useCallback((card, val) => {
    if (isGeneratedItem(card)) {
      const next = { ...variantKnown, [card.id]: val };
      setVariantKnown(next);
      saveProgress(variantKnownKey(deck), next);
      return;
    }
    const next = { ...known, [card.id]: val };
    setKnown(next);
    saveProgress(`flashcard_known_${deck}`, next);
  }, [known, variantKnown, deck]);

  const next = useCallback(() => { setFlipped(false); setIdx((i) => Math.min(i + 1, cards.length - 1)); }, [cards.length]);
  const prev = useCallback(() => { setFlipped(false); setIdx((i) => Math.max(i - 1, 0)); }, []);

  const shuffle = useCallback(() => {
    const a = [...cards];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    // 셔플 결과를 현재 filtered 에 묶어 둔다 — 필터가 바뀌면 자동 폐기된다
    setShuffled({ source: filtered, order: a });
    setIdx(0);
    setFlipped(false);
  }, [cards, filtered]);

  // 필터를 바꾸면 첫 카드로 되돌린다 — effect 대신 이벤트 핸들러에서 리셋
  const changeCategory = (cat) => { setCategory(cat); setIdx(0); setFlipped(false); };
  const changeFilterMode = (mode) => { setFilterMode(mode); setIdx(0); setFlipped(false); };

  useEffect(() => {
    const handler = (e) => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setFlipped((f) => !f); }
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [next, prev]);

  const swipeHandlers = useSwipe({
    onSwipeLeft: next,
    onSwipeRight: prev,
  });

  // 진도는 **교재 카드만** 센다 — 변형은 덤이지 진도의 분모가 아니다
  const baseCards = allCards.filter((c) => !isGeneratedItem(c));
  const knownCount = baseCards.filter((c) => known[c.id]).length;
  // 모르는 것만 필터에서 카드를 외움 처리하면 목록이 줄어 idx 가 범위를 벗어날 수 있다
  const idxInRange = idx < cards.length ? idx : 0;
  const current = cards[idxInRange];

  return (
    <div className="page">
      <h1>플래시카드</h1>
      <p className="subtitle">탭하여 뒤집기, 좌우 스와이프로 이동</p>

      {/* 덱 선택 */}
      <div className="deck-selector">
        {DECKS.map((d) => (
          <button
            key={d.key}
            className={`deck-btn ${deck === d.key ? 'active' : ''}`}
            onClick={() => setDeck(d.key)}
          >
            {d.label}
          </button>
        ))}
      </div>

      <div className="stats">
        <div className="stat-box">
          <div className="value">{baseCards.length}</div>
          <div className="label">전체 문제</div>
        </div>
        <div className="stat-box">
          <div className="value" style={{ color: 'var(--success)' }}>{knownCount}</div>
          <div className="label">외운 문제</div>
        </div>
        <div className="stat-box">
          <div className="value" style={{ color: 'var(--warning)' }}>{baseCards.length - knownCount}</div>
          <div className="label">남은 문제</div>
        </div>
      </div>

      <div className="progress-bar">
        <div className="fill" style={{ width: `${baseCards.length ? (knownCount / baseCards.length) * 100 : 0}%` }} />
      </div>

      <div className="filter-bar">
        {CATEGORIES.map((cat) => (
          <button key={cat} className={`btn-outline ${category === cat ? 'active' : ''}`} onClick={() => changeCategory(cat)}>
            {cat}
          </button>
        ))}
        <span style={{ margin: '0 8px', borderLeft: '1px solid var(--border)', height: 28 }} />
        <button className={`btn-outline ${filterMode === 'all' ? 'active' : ''}`} onClick={() => changeFilterMode('all')}>전체</button>
        <button className={`btn-outline ${filterMode === 'unknown' ? 'active' : ''}`} onClick={() => changeFilterMode('unknown')}>모르는 것만</button>
        <span style={{ margin: '0 8px', borderLeft: '1px solid var(--border)', height: 28 }} />
        <button className="btn-outline" onClick={shuffle} title="카드 순서 섞기"><Icon name="refresh" size={14}/> 섞기</button>
        <VariantToggle
          enabled={includeVariants}
          available={variantsAvailable}
          onChange={(next) => { changeIncludeVariants(next); setIdx(0); setFlipped(false); }}
        />
      </div>

      {cards.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 60 }}>
          {filterMode === 'unknown' ? <><Icon name="party" size={24}/> 모든 카드를 외웠습니다!</> : '문제를 불러오는 중...'}
        </div>
      ) : current ? (
        <>
          <div className="flashcard-container" {...swipeHandlers}>
            <div className={`flashcard ${flipped ? 'flipped' : ''} ${deck === 'bogang119' && flipped ? 'flashcard-tall' : ''}`} onClick={() => setFlipped(!flipped)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFlipped(!flipped); } }} role="button" tabIndex={0} aria-label="카드 뒤집기">
              <div className="flashcard-face">
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  <span className="badge badge-primary">{current.category}</span>
                  <GeneratedBadge item={current} />
                </div>
                <h2 style={{ fontSize: '1.3rem', textAlign: 'center', lineHeight: 1.6 }}>
                  {current.id}. {current.question}
                </h2>
                <p style={{ color: 'var(--text-dim)', marginTop: 16, fontSize: '0.85rem' }}>클릭하여 정답 확인</p>
              </div>
              <div className="flashcard-face flashcard-back">
                <div className="md-content" style={{ width: '100%', fontSize: deck === 'bogang119' ? '0.85rem' : '0.95rem' }}>
                  <GeneratedAnswerNotice item={current} />
                  <ReactMarkdown>{current.answer}</ReactMarkdown>
                </div>
              </div>
            </div>
          </div>

          <div className="flashcard-nav">
            <button className="btn-outline" onClick={prev} disabled={idxInRange === 0} aria-label="이전 카드"><Icon name="chevron-left" size={16}/> 이전</button>
            <button className="btn-danger" onClick={() => markKnown(current, false)} style={{ padding: '10px 16px' }} aria-label="모름 표시"><Icon name="x" size={16}/> 모름</button>
            <span className="flashcard-counter" aria-live="polite">{idxInRange + 1} / {cards.length}</span>
            <button className="btn-success" onClick={() => { markKnown(current, true); next(); }} style={{ padding: '10px 16px' }} aria-label="외움 표시"><Icon name="check" size={16}/> 외움</button>
            <button className="btn-outline" onClick={next} disabled={idxInRange === cards.length - 1} aria-label="다음 카드">다음 <Icon name="chevron-right" size={16}/></button>
          </div>
        </>
      ) : null}
    </div>
  );
}
