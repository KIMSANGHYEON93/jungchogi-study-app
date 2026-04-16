import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadProgress, saveProgress, getWrongNotes, clearProgress } from '../utils/storage';
import Icon from '../components/Icon';

const STUDY_DAYS = [
  { day: 1, label: 'C언어', icon: 'type' },
  { day: 2, label: 'Java', icon: 'coffee' },
  { day: 3, label: 'Python+SQL', icon: 'snake' },
  { day: 4, label: 'SQL심화', icon: 'database' },
  { day: 5, label: '디자인패턴', icon: 'building' },
  { day: 6, label: 'SW공학', icon: 'settings' },
  { day: 7, label: '코드복습', icon: 'refresh' },
  { day: 8, label: '이론총정리', icon: 'book-stack' },
  { day: 9, label: '모의고사1', icon: 'file-text' },
  { day: 10, label: '약점보강', icon: 'zap' },
  { day: 11, label: '모의고사2', icon: 'file-text' },
  { day: 12, label: '최종정리', icon: 'target' },
  { day: 13, label: '시험전날', icon: 'moon' },
  { day: 14, label: '시험당일', icon: 'trophy' },
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

  const flashcardTotal = 100;
  const flashcardDone = Object.values(flashcardKnown).filter(Boolean).length;
  const bogangTotal = 24;
  const bogangDone = Object.values(loadProgress('flashcard_known_bogang119', {})).filter(Boolean).length;
  const quizDone = Object.keys(quizResults).length;
  const quizTotal = 40;
  const wrongTotal = wrongNotes.length;
  const wrongReviewed = wrongNotes.filter((n) => n.reviewCount > 0).length;
  const daysCompleted = Object.values(dayChecks).filter(Boolean).length;

  const overallPercent = Math.round(
    ((flashcardDone / flashcardTotal) * 25 +
      (bogangDone / bogangTotal) * 15 +
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
      <div className="card recommend-card" onClick={recommendation.action} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); recommendation.action(); } }} role="button" tabIndex={0} style={{ cursor: 'pointer' }}>
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
        <div className="progress-bar" role="progressbar" aria-valuenow={overallPercent} aria-valuemin={0} aria-valuemax={100} aria-label="학습 진도" style={{ height: 10, marginBottom: 0 }}>
          <div className="fill" style={{ width: `${overallPercent}%`, background: overallPercent >= 60 ? 'var(--success)' : 'var(--primary)' }} />
        </div>
      </div>

      {/* 영역별 통계 카드 */}
      <div className="dashboard-grid">
        <div className="card dash-stat-card" onClick={() => navigate('/flashcard')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/flashcard'); } }} role="button" tabIndex={0} style={{ cursor: 'pointer' }}>
          <div className="dash-stat-icon"><Icon name="cards" size={28}/></div>
          <div className="dash-stat-title">플래시카드</div>
          <div className="dash-stat-value">{flashcardDone}<span>/{flashcardTotal}</span></div>
          <div className="progress-bar" role="progressbar" aria-valuenow={Math.round((flashcardDone / flashcardTotal) * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="학습 진도" style={{ marginTop: 8 }}>
            <div className="fill" style={{ width: `${(flashcardDone / flashcardTotal) * 100}%` }} />
          </div>
          <div className="dash-stat-sub">{Math.round((flashcardDone / flashcardTotal) * 100)}% 완료</div>
        </div>

        <div className="card dash-stat-card" onClick={() => navigate('/flashcard')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/flashcard'); } }} role="button" tabIndex={0} style={{ cursor: 'pointer' }}>
          <div className="dash-stat-icon"><Icon name="book-open" size={28}/></div>
          <div className="dash-stat-title">암기 119선</div>
          <div className="dash-stat-value">{bogangDone}<span>/{bogangTotal}</span></div>
          <div className="progress-bar" role="progressbar" aria-valuenow={Math.round((bogangDone / bogangTotal) * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="학습 진도" style={{ marginTop: 8 }}>
            <div className="fill" style={{ width: `${(bogangDone / bogangTotal) * 100}%`, background: 'var(--accent)' }} />
          </div>
          <div className="dash-stat-sub">{Math.round((bogangDone / bogangTotal) * 100)}% 완료</div>
        </div>

        <div className="card dash-stat-card" onClick={() => navigate('/quiz')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/quiz'); } }} role="button" tabIndex={0} style={{ cursor: 'pointer' }}>
          <div className="dash-stat-icon"><Icon name="terminal" size={28}/></div>
          <div className="dash-stat-title">코드 퀴즈</div>
          <div className="dash-stat-value">{quizDone}<span>/{quizTotal}</span></div>
          <div className="progress-bar" role="progressbar" aria-valuenow={Math.round((quizDone / quizTotal) * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="학습 진도" style={{ marginTop: 8 }}>
            <div className="fill" style={{ width: `${(quizDone / quizTotal) * 100}%` }} />
          </div>
          <div className="dash-stat-sub">{Math.round((quizDone / quizTotal) * 100)}% 완료</div>
        </div>

        <div className="card dash-stat-card" onClick={() => navigate('/wrong')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/wrong'); } }} role="button" tabIndex={0} style={{ cursor: 'pointer' }}>
          <div className="dash-stat-icon"><Icon name="x-circle" size={28}/></div>
          <div className="dash-stat-title">오답노트</div>
          <div className="dash-stat-value" style={{ color: wrongTotal > 0 ? 'var(--danger)' : 'var(--success)' }}>
            {wrongTotal}<span>개</span>
          </div>
          <div className="progress-bar" style={{ marginTop: 8 }}>
            <div className="fill" style={{ width: `${wrongTotal ? (wrongReviewed / wrongTotal) * 100 : 100}%`, background: 'var(--success)' }} />
          </div>
          <div className="dash-stat-sub">{wrongTotal > 0 ? `${wrongReviewed}개 복습완료` : '오답 없음'}</div>
        </div>

        <div className="card dash-stat-card" onClick={() => navigate('/exam')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/exam'); } }} role="button" tabIndex={0} style={{ cursor: 'pointer' }}>
          <div className="dash-stat-icon"><Icon name="file-text" size={28}/></div>
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
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleDay(d.day); } }}
            role="button"
            tabIndex={0}
          >
            <div className="day-check">{dayChecks[d.day] ? <Icon name="check-circle" size={20}/> : <Icon name={d.icon} size={20}/>}</div>
            <div className="day-num">Day {d.day}</div>
            <div className="day-label">{d.label}</div>
          </div>
        ))}
      </div>

      <div style={{ textAlign: 'center', marginTop: 16, color: 'var(--text-dim)', fontSize: '0.85rem' }}>
        {daysCompleted}/14일 완료 — 클릭하여 완료 표시
      </div>

      {/* 데이터 관리 */}
      <div className="card" style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: '1.1rem', marginBottom: 16 }}>데이터 관리</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn-outline"
            onClick={() => {
              const data = {};
              for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key.startsWith('jungchogi_')) {
                  data[key] = localStorage.getItem(key);
                }
              }
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `jungchogi_backup_${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            학습 데이터 내보내기
          </button>
          <button
            className="btn-outline"
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = '.json';
              input.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                  try {
                    const data = JSON.parse(ev.target.result);
                    let count = 0;
                    for (const [key, value] of Object.entries(data)) {
                      if (key.startsWith('jungchogi_')) {
                        localStorage.setItem(key, value);
                        count++;
                      }
                    }
                    window.alert(`${count}개 항목을 복원했습니다.`);
                    window.location.reload();
                  } catch {
                    window.alert('유효하지 않은 백업 파일입니다.');
                  }
                };
                reader.readAsText(file);
              };
              input.click();
            }}
          >
            데이터 가져오기
          </button>
          <button
            className="btn-outline"
            style={{ color: 'var(--danger)' }}
            onClick={() => {
              if (!window.confirm('모든 학습 진도를 초기화하시겠습니까?\n(플래시카드, 퀴즈, 오답노트, Day 체크 등 모든 데이터가 삭제됩니다)')) return;
              const keysToRemove = [];
              for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key.startsWith('jungchogi_')) keysToRemove.push(key);
              }
              keysToRemove.forEach((k) => localStorage.removeItem(k));
              window.location.reload();
            }}
          >
            전체 초기화
          </button>
        </div>
      </div>
    </div>
  );
}
