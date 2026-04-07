import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import FlashcardPage from './pages/FlashcardPage';
import QuizPage from './pages/QuizPage';
import StudyPage from './pages/StudyPage';
import ExamPage from './pages/ExamPage';

export default function App() {
  return (
    <BrowserRouter>
      <Navbar />
      <Routes>
        <Route path="/" element={<Navigate to="/flashcard" replace />} />
        <Route path="/flashcard" element={<FlashcardPage />} />
        <Route path="/quiz" element={<QuizPage />} />
        <Route path="/study" element={<StudyPage />} />
        <Route path="/exam" element={<ExamPage />} />
      </Routes>
    </BrowserRouter>
  );
}
