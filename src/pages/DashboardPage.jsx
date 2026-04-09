import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadProgress, saveProgress, getWrongNotes } from '../utils/storage';

const STUDY_DAYS = [
  { day: 1, label: 'C언어', icon: '🔤' },
  { day: 2, label: 'Java', icon: '☕' },
  { day: 3, label: 'Python+SQL', icon: '🐍' },
  { day: 4, label: 'SQL심화', icon: '🗄️' },
  { day: 5, label: '디자인패턴', icon: '🏗️' },
  { day: 6, label: 'SW공학', icon: '⚙️' },
  { day: 7, label: '코드복습', icon: '🔁' },
  { day: 8, label: '이론총정리', icon: '📚' },
  { day: 9, label: '모의고사1', icon: '📝' },
  { day: 10, label: '약점보강', icon: '💪' },
  { day: 11, label: '모의고사2', icon: '📝' },
  { day: 12, label: '최종정리', icon: '🎯' },
  { day: 13, label: '시험전날', icon: '🌙' },
  { day: 14, label: '시험당일', icon: '🏆' },
];

export default function DashboardPage() {
  const navigate = useNavigate();
  const [flashcardKnown, setFlashcardKnown] = useState({});
  const [quizResults, setQuizResults] = useState({});
  const [wrongNotes, setWrongNotes] = useState([]);
  const [dayChecks, setDayChecks] = useState({});

  useEffect(() => {
    setFlashcardKnown(loadProgress('flashcard_known_quiz100', {}));
    setQuizResults(loadProgress('quiz_results', {}));
    setWrongNotes(getWrongNotes());
    setDayChecks(loadProgress('day_checks', {}));
  }, []);

  const toggleDay = (day) => {
    const next = { ...dayChecks, [day]: !dayChecks[day] };
    setDayChecks(next);
    saveProgress('day_checks', next);
  };

  const bogangKnown = loadProgress('flashcard_known_bogang119', {});
  const flashcardTotal = 100;
  const flashcardDone = Object.values(flashcardKnown).filter(Boolean).length;
  const bogangDone = Object.values(bogangKnown).filter(Boolean).length;
  const quizDone = Object.keys(quizResults).length;
  const quizTotal = 40;
  const wrongTotal = wrongNotes.length;
  const wrongReviewed = wrongNotes.filter((n) => n.reviewCount > 0).length;
  const daysCompleted = Object.values(dayChecks).filter(Boolean).length;

  const overallPercent = Math.round(
    ((flashcardDone / flashcardTotal) * 40 +
      (quizDone / quizTotal) * 30 +
      (daysCompleted / 14) * 30)
  );

  // 추천 학습 결정
  const getRecommendation = () => {
    if (daysCompleted === 0) return { text: 'Day 1부터 학습을 시작하세요!', action: () => navigate('/study'), btn: '학습 시작' };
    if (flashcardDone < 30) return { text: '플래시카드로 기본 용어를 익히세요', action: () => navigate('/flashcard'), btn: '카드 학습' };
    if (wrongTotal > 0 && wrongReviewed < wrongTotal) return { text: `오답노트에 복습할 문제가 ${wrongTotal - wrongReviewed}개 있어요`, action: () => navigate('/wrong'), btn: '오답 복습' };
    if (quizDone < 20) return { text: '코드 트레이싱 퀴즈를 풀어보세요', action: () => navigate('/quiz'), btn: '퀴즈 풀기' };
    if (daysCompleted < 14) {
      const nextDay = STUDY_DAYS.find((d) => !dayChecks[d.day]);
      return { text: `Day ${nextDay?.day} — ${nextDay?.label} 학습을 진행하세요`, action: () => navigate('/study'), btn: '학습 계속' };
    }
    return { text: '모의고사로 실력을 점검하세요!', action: () => navigate('/exam'), btn: '모의고사' };
  };

  const recommendation = getRecommendation();

  return (
    <div className="page">
      <h1>학습 대시보드</h1>
      <p className="subtitle">정보처리기사 실기 학습 현황</p>

      {/* 추천 학습 */}
      <div className="card recommend-card" onClick={recommendation.action} style={{ cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div style={{ fontSize: '0.85rem', color: 'var(--warning)', fontWeight: 600, marginBottom: 4 }}>
              오늘의 추천
            </div>
            <div style={{ fontSize: '1.1rem', fontWeight: 500 }}>{recommendation.text}</div>
          </div>
          <button className="btn-primary" style={{ flexShrink: 0 }} onClick={(e) => { e.stopPropagation(); recommendation.action(); }}>
            {recommendation.btn}
          </button>
        </div>
      </div>

      {/* 종합 진도 */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ fontSize: '1.1rem' }}>종합 학습 진도</h2>
          <span style={{ fontSize: '1.8rem', fontWeight: 700, color: overallPercent >= 60 ? 'var(--success)' : 'var(--primary)' }}>
            {overallPercent}%
          </span>
        </div>
        <div className="progress-bar" style={{ height: 10, marginBottom: 0 }}>
          <div className="fill" style={{ width: `${overallPercent}%`, background: overallPercent >= 60 ? 'var(--success)' : 'var(--primary)' }} />
        </div>
      </div>

      {/* 영역별 통계 카드 */}
      <div className="dashboard-grid">
        <div className="card dash-stat-card" onClick={() => navigate('/flashcard')} style={{ cursor: 'pointer' }}>
          <div className="dash-stat-icon">📇</div>
          <div className="dash-stat-title">플래시카드</div>
          <div className="dash-stat-value">{flashcardDone}<span>/{flashcardTotal}</span></div>
          <div className="progress-bar" style={{ marginTop: 8 }}>
            <div className="fill" style={{ width: `${(flashcardDone / flashcardTotal) * 100}%` }} />
          </div>
          <div className="dash-stat-sub">{Math.round((flashcardDone / flashcardTotal) * 100)}% 완료</div>
        </div>

        <div className="card dash-stat-card" onClick={() => navigate('/quiz')} style={{ cursor: 'pointer' }}>
          <div className="dash-stat-icon">💻</div>
          <div className="dash-stat-title">코드 퀴즈</div>
          <div className="dash-stat-value">{quizDone}<span>/{quizTotal}</span></div>
          <div className="progress-bar" style={{ marginTop: 8 }}>
            <div className="fill" style={{ width: `${(quizDone / quizTotal) * 100}%` }} />
          </div>
          <div className="dash-stat-sub">{Math.round((quizDone / quizTotal) * 100)}% 완료</div>
        </div>

        <div className="card dash-stat-card" onClick={() => navigate('/wrong')} style={{ cursor: 'pointer' }}>
          <div className="dash-stat-icon">❌</div>
          <div className="dash-stat-title">오답노트</div>
          <div className="dash-stat-value" style={{ color: wrongTotal > 0 ? 'var(--danger)' : 'var(--success)' }}>
            {wrongTotal}<span>개</span>
          </div>
          <div className="progress-bar" style={{ marginTop: 8 }}>
            <div className="fill" style={{ width: `${wrongTotal ? (wrongReviewed / wrongTotal) * 100 : 100}%`, background: 'var(--success)' }} />
          </div>
          <div className="dash-stat-sub">{wrongTotal > 0 ? `${wrongReviewed}개 복습완료` : '오답 없음'}</div>
        </div>

        <div className="card dash-stat-card" onClick={() => navigate('/exam')} style={{ cursor: 'pointer' }}>
          <div className="dash-stat-icon">📝</div>
          <div className="dash-stat-title">모의고사</div>
          <div className="dash-stat-value">20<span>문제</span></div>
          <div style={{ marginTop: 8, fontSize: '0.85rem', color: 'var(--text-dim)' }}>
            단답형 12 + 코드 8
          </div>
          <div className="dash-stat-sub">150분 제한</div>
        </div>
      </div>

      {/* Day별 학습 체크리스트 */}
      <h2 style={{ fontSize: '1.1rem', marginTop: 32, marginBottom: 16 }}>14일 학습 체크리스트</h2>
      <div className="day-grid">
        {STUDY_DAYS.map((d) => (
          <div
            key={d.day}
            className={`card day-card ${dayChecks[d.day] ? 'completed' : ''}`}
            onClick={() => toggleDay(d.day)}
          >
            <div className="day-check">{dayChecks[d.day] ? '✅' : d.icon}</div>
            <div className="day-num">Day {d.day}</div>
            <div className="day-label">{d.label}</div>
          </div>
        ))}
      </div>

      <div style={{ textAlign: 'center', marginTop: 16, color: 'var(--text-dim)', fontSize: '0.85rem' }}>
        {daysCompleted}/14일 완료 — 클릭하여 완료 표시
      </div>
    </div>
  );
}
