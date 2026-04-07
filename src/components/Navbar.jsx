import { NavLink } from 'react-router-dom';

export default function Navbar() {
  return (
    <nav className="navbar">
      <span className="logo">정처기 학습</span>
      <NavLink to="/flashcard">플래시카드</NavLink>
      <NavLink to="/quiz">코드퀴즈</NavLink>
      <NavLink to="/study">학습노트</NavLink>
      <NavLink to="/exam">모의고사</NavLink>
    </nav>
  );
}
