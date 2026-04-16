import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';
import FlashcardPage from './pages/FlashcardPage';
import QuizPage from './pages/QuizPage';
import StudyPage from './pages/StudyPage';
import ExamPage from './pages/ExamPage';
import WrongNotePage from './pages/WrongNotePage';
import DashboardPage from './pages/DashboardPage';
import SearchPage from './pages/SearchPage';
import LandingPage from './pages/LandingPage';
import NotFoundPage from './pages/NotFoundPage';
import { useTheme, ThemeProvider } from './hooks/useTheme';

function AppLayout() {
  const location = useLocation();
  const isLanding = location.pathname === '/landing';

  return (
    <>
      {!isLanding && <Navbar />}
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/landing" element={<LandingPage />} />
        <Route path="/flashcard" element={<FlashcardPage />} />
        <Route path="/quiz" element={<QuizPage />} />
        <Route path="/study" element={<StudyPage />} />
        <Route path="/exam" element={<ExamPage />} />
        <Route path="/wrong" element={<WrongNotePage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}

export default function App() {
  const themeValue = useTheme();

  return (
    <ThemeProvider value={themeValue}>
      <BrowserRouter>
        <AppLayout />
      </BrowserRouter>
    </ThemeProvider>
  );
}
