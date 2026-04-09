import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import FlashcardPage from './pages/FlashcardPage';
import QuizPage from './pages/QuizPage';
import StudyPage from './pages/StudyPage';
import ExamPage from './pages/ExamPage';
import WrongNotePage from './pages/WrongNotePage';
import DashboardPage from './pages/DashboardPage';

export default function App() {
  return (
    <BrowserRouter>
      <Navbar />
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/flashcard" element={<FlashcardPage />} />
        <Route path="/quiz" element={<QuizPage />} />
        <Route path="/study" element={<StudyPage />} />
        <Route path="/exam" element={<ExamPage />} />
        <Route path="/wrong" element={<WrongNotePage />} />
      </Routes>
    </BrowserRouter>
  );
}
