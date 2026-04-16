import { useState, useEffect, useRef, useCallback } from 'react';

const STATS_DATA = [
  { label: '합격률 향상', value: 94, suffix: '%' },
  { label: '누적 학습자', value: 12000, suffix: '+' },
  { label: '문제 수', value: 5000, suffix: '+' },
  { label: '평균 학습 시간 단축', value: 40, suffix: '%' },
];

const FEATURES = [
  {
    title: '플래시카드',
    desc: '핵심 개념을 반복 학습으로 완벽 암기',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="M2 8h20" />
        <path d="M8 4v4" />
      </svg>
    ),
  },
  {
    title: '코드퀴즈',
    desc: '실전 코드 문제로 알고리즘 실력 향상',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
        <line x1="14" y1="4" x2="10" y2="20" />
      </svg>
    ),
  },
  {
    title: '학습노트',
    desc: '체계적으로 정리된 과목별 학습 자료',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
        <line x1="8" y1="10" x2="16" y2="10" />
        <line x1="8" y1="14" x2="13" y2="14" />
      </svg>
    ),
  },
  {
    title: '모의고사',
    desc: '실제 시험과 동일한 환경의 모의고사',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    title: '오답노트',
    desc: '틀린 문제 자동 수집, 취약점 분석',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="9" y1="13" x2="15" y2="13" />
        <line x1="9" y1="17" x2="13" y2="17" />
      </svg>
    ),
  },
  {
    title: '검색',
    desc: '키워드로 빠르게 원하는 내용 찾기',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
  },
];

const STEPS = [
  {
    num: '01',
    title: '레벨 테스트',
    desc: '현재 실력을 진단합니다',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
  },
  {
    num: '02',
    title: '맞춤 학습',
    desc: 'AI가 취약 영역을 분석하여 학습 계획을 세웁니다',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
      </svg>
    ),
  },
  {
    num: '03',
    title: '합격 달성',
    desc: '체계적 복습으로 합격률을 극대화합니다',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 9l6 6 6-6" />
        <path d="M12 3v12" />
        <path d="M5 21h14" />
        <circle cx="12" cy="21" r="0" />
        <path d="M8.5 14.5L12 18l3.5-3.5" />
      </svg>
    ),
  },
];

function useCountUp(end, duration, shouldStart) {
  const [count, setCount] = useState(0);
  const frameRef = useRef(null);

  useEffect(() => {
    if (!shouldStart) {
      setCount(0);
      return;
    }

    let startTime = null;

    const animate = (timestamp) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(eased * end));

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      }
    };

    frameRef.current = requestAnimationFrame(animate);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [end, duration, shouldStart]);

  return count;
}

function StatCard({ label, value, suffix, shouldAnimate }) {
  const count = useCountUp(value, 1800, shouldAnimate);
  const display = shouldAnimate ? count.toLocaleString() : '0';

  return (
    <div className="landing-stat-card">
      <span className="landing-stat-value">
        {display}
        <span className="landing-stat-suffix">{suffix}</span>
      </span>
      <span className="landing-stat-label">{label}</span>
    </div>
  );
}

export default function LandingPage() {
  const [statsVisible, setStatsVisible] = useState(false);
  const [visibleFeatures, setVisibleFeatures] = useState(new Set());
  const [visibleSteps, setVisibleSteps] = useState(new Set());
  const [navScrolled, setNavScrolled] = useState(false);

  const statsRef = useRef(null);
  const featuresRef = useRef(null);
  const stepsRef = useRef(null);
  const featureCardsRef = useRef([]);
  const stepCardsRef = useRef([]);

  const scrollToSection = useCallback((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  // Nav scroll effect
  useEffect(() => {
    const handleScroll = () => {
      setNavScrolled(window.scrollY > 40);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Stats intersection observer
  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      setStatsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setStatsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 }
    );

    if (statsRef.current) observer.observe(statsRef.current);
    return () => observer.disconnect();
  }, []);

  // Features intersection observer
  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const idx = featureCardsRef.current.indexOf(entry.target);
            if (idx !== -1) {
              if (prefersReduced) {
                setVisibleFeatures((prev) => new Set([...prev, idx]));
              } else {
                setTimeout(() => {
                  setVisibleFeatures((prev) => new Set([...prev, idx]));
                }, idx * 100);
              }
              observer.unobserve(entry.target);
            }
          }
        });
      },
      { threshold: 0.15 }
    );

    featureCardsRef.current.forEach((el) => {
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  // Steps intersection observer
  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const idx = stepCardsRef.current.indexOf(entry.target);
            if (idx !== -1) {
              if (prefersReduced) {
                setVisibleSteps((prev) => new Set([...prev, idx]));
              } else {
                setTimeout(() => {
                  setVisibleSteps((prev) => new Set([...prev, idx]));
                }, idx * 150);
              }
              observer.unobserve(entry.target);
            }
          }
        });
      },
      { threshold: 0.2 }
    );

    stepCardsRef.current.forEach((el) => {
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="landing">
      {/* Navigation */}
      <nav className={`landing-nav${navScrolled ? ' landing-nav--scrolled' : ''}`} role="navigation" aria-label="Landing page navigation">
        <div className="landing-nav-inner">
          <span className="landing-nav-logo" aria-label="정처기 학습 홈">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </svg>
            정처기 학습
          </span>
          <div className="landing-nav-links">
            <a href="/landing#features" onClick={(e) => { e.preventDefault(); scrollToSection('features'); }}>기능</a>
            <a href="/landing#how-it-works" onClick={(e) => { e.preventDefault(); scrollToSection('how-it-works'); }}>이용 방법</a>
            <a href="/" className="landing-nav-btn-ghost">로그인</a>
            <a href="/" className="landing-nav-btn-primary">시작하기</a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="landing-hero" aria-labelledby="hero-heading">
        <div className="landing-hero-bg" aria-hidden="true" />
        <div className="landing-hero-content">
          <h1 id="hero-heading" className="landing-hero-title">
            정보처리기사,<br />이제 스마트하게 합격하세요
          </h1>
          <p className="landing-hero-subtitle">
            AI 기반 맞춤 학습으로 합격률을 높이는 정처기 학습 플랫폼
          </p>
          <div className="landing-hero-actions">
            <a href="/" className="landing-btn landing-btn--primary landing-btn--lg">
              무료로 시작하기
            </a>
            <button
              type="button"
              className="landing-btn landing-btn--outline landing-btn--lg"
              onClick={() => scrollToSection('features')}
            >
              기능 둘러보기
            </button>
          </div>
        </div>
        <div className="landing-scroll-indicator" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14" />
            <path d="M19 12l-7 7-7-7" />
          </svg>
        </div>
      </section>

      {/* Stats */}
      <section className="landing-stats" ref={statsRef} aria-label="주요 통계">
        <div className="landing-stats-grid">
          {STATS_DATA.map((s) => (
            <StatCard key={s.label} {...s} shouldAnimate={statsVisible} />
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="landing-features" id="features" ref={featuresRef} aria-labelledby="features-heading">
        <div className="landing-section-inner">
          <h2 id="features-heading" className="landing-section-title">
            합격을 위한 모든 기능
          </h2>
          <p className="landing-section-subtitle">
            체계적인 학습 도구로 정보처리기사 시험을 효율적으로 준비하세요
          </p>
          <div className="landing-features-grid">
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                className={`landing-feature-card${visibleFeatures.has(i) ? ' landing-feature-card--visible' : ''}`}
                ref={(el) => { featureCardsRef.current[i] = el; }}
              >
                <div className="landing-feature-icon" aria-hidden="true">{f.icon}</div>
                <h3 className="landing-feature-title">{f.title}</h3>
                <p className="landing-feature-desc">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="landing-steps" id="how-it-works" ref={stepsRef} aria-labelledby="steps-heading">
        <div className="landing-section-inner">
          <h2 id="steps-heading" className="landing-section-title">
            이렇게 시작하세요
          </h2>
          <p className="landing-section-subtitle">
            3단계로 합격까지 가는 가장 빠른 길
          </p>
          <div className="landing-steps-grid">
            {STEPS.map((s, i) => (
              <div
                key={s.num}
                className={`landing-step-card${visibleSteps.has(i) ? ' landing-step-card--visible' : ''}`}
                ref={(el) => { stepCardsRef.current[i] = el; }}
              >
                <div className="landing-step-num" aria-hidden="true">{s.num}</div>
                <div className="landing-step-icon" aria-hidden="true">{s.icon}</div>
                <h3 className="landing-step-title">{s.title}</h3>
                <p className="landing-step-desc">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="landing-cta" aria-labelledby="cta-heading">
        <div className="landing-cta-inner">
          <h2 id="cta-heading" className="landing-cta-title">
            지금 바로 정처기 학습을 시작하세요
          </h2>
          <a href="/" className="landing-btn landing-btn--primary landing-btn--lg">
            무료 체험 시작
          </a>
          <p className="landing-cta-note">
            신용카드 불필요 &middot; 언제든 해지 가능
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer" role="contentinfo">
        <div className="landing-footer-inner">
          <div className="landing-footer-links">
            <a href="/terms">이용약관</a>
            <a href="/privacy">개인정보처리방침</a>
            <a href="/contact">문의하기</a>
          </div>
          <p className="landing-footer-copy">
            &copy; 2026 정처기 학습. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
