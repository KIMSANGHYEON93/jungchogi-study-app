import { NavLink } from 'react-router-dom';
import { useThemeContext } from '../hooks/useTheme';
import Icon from './Icon';

const SunIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>
);

const MoonIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

export default function Navbar() {
  const { theme, toggle } = useThemeContext();

  return (
    <>
      {/* Desktop: top bar */}
      <nav className="navbar desktop-nav" role="navigation" aria-label="메인 네비게이션">
        <NavLink to="/" className="logo-link"><span className="logo">정처기 학습</span></NavLink>
        <NavLink to="/flashcard">플래시카드</NavLink>
        <NavLink to="/quiz">코드퀴즈</NavLink>
        <NavLink to="/study">학습노트</NavLink>
        <NavLink to="/exam">모의고사</NavLink>
        <NavLink to="/wrong">오답노트</NavLink>
        <NavLink to="/search">검색</NavLink>
        <button
          className="theme-toggle"
          onClick={toggle}
          aria-label={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
          title={theme === 'dark' ? '라이트 모드' : '다크 모드'}
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
      </nav>

      {/* Mobile: bottom tab bar */}
      <nav className="mobile-tab-bar" role="navigation" aria-label="모바일 네비게이션">
        <NavLink to="/" end>
          <span className="tab-icon"><Icon name="home" size={20}/></span>
          <span className="tab-label">홈</span>
        </NavLink>
        <NavLink to="/flashcard">
          <span className="tab-icon"><Icon name="cards" size={20}/></span>
          <span className="tab-label">카드</span>
        </NavLink>
        <NavLink to="/quiz">
          <span className="tab-icon"><Icon name="code" size={20}/></span>
          <span className="tab-label">퀴즈</span>
        </NavLink>
        <NavLink to="/exam">
          <span className="tab-icon"><Icon name="exam" size={20}/></span>
          <span className="tab-label">시험</span>
        </NavLink>
        <NavLink to="/study">
          <span className="tab-icon"><Icon name="notebook" size={20}/></span>
          <span className="tab-label">노트</span>
        </NavLink>
        <NavLink to="/wrong">
          <span className="tab-icon"><Icon name="wrong" size={20}/></span>
          <span className="tab-label">오답</span>
        </NavLink>
      </nav>
    </>
  );
}
