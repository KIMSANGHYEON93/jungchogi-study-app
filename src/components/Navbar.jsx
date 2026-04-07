import { NavLink } from 'react-router-dom';

export default function Navbar() {
  return (
    <>
      {/* Desktop: top bar */}
      <nav className="navbar desktop-nav">
        <span className="logo">정처기 학습</span>
        <NavLink to="/flashcard">플래시카드</NavLink>
        <NavLink to="/quiz">코드퀴즈</NavLink>
        <NavLink to="/study">학습노트</NavLink>
        <NavLink to="/exam">모의고사</NavLink>
      </nav>

      {/* Mobile: bottom tab bar */}
      <nav className="mobile-tab-bar">
        <NavLink to="/flashcard">
          <span className="tab-icon">📇</span>
          <span className="tab-label">카드</span>
        </NavLink>
        <NavLink to="/quiz">
          <span className="tab-icon">💻</span>
          <span className="tab-label">퀴즈</span>
        </NavLink>
        <NavLink to="/study">
          <span className="tab-icon">📖</span>
          <span className="tab-label">노트</span>
        </NavLink>
        <NavLink to="/exam">
          <span className="tab-icon">📝</span>
          <span className="tab-label">시험</span>
        </NavLink>
      </nav>
    </>
  );
}
