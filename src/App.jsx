import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';
import ErrorBoundary from './components/ErrorBoundary';
import { useTheme, ThemeProvider } from './hooks/useTheme';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const LandingPage = lazy(() => import('./pages/LandingPage'));
const FlashcardPage = lazy(() => import('./pages/FlashcardPage'));
const QuizPage = lazy(() => import('./pages/QuizPage'));
const StudyPage = lazy(() => import('./pages/StudyPage'));
const ExamPage = lazy(() => import('./pages/ExamPage'));
const WrongNotePage = lazy(() => import('./pages/WrongNotePage'));
const SearchPage = lazy(() => import('./pages/SearchPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

function PageLoader() {
  return (
    <div className="page" style={{ textAlign: 'center', padding: '80px 0' }}>
      <div className="loading-spinner" />
      <p style={{ color: 'var(--text-dim)', marginTop: 16 }}>로딩 중...</p>
    </div>
  );
}

function AppLayout() {
  const location = useLocation();
  const isLanding = location.pathname === '/landing';

  return (
    <>
      {!isLanding && <Navbar />}
      <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>
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
      </Suspense>
      </ErrorBoundary>
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
