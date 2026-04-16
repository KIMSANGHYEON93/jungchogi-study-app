import { useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';

export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="page" style={{ textAlign: 'center', paddingTop: 80 }}>
      <div style={{ marginBottom: 24 }}>
        <Icon name="frown" size={64} />
      </div>
      <h1 style={{ fontSize: '3rem', marginBottom: 8 }}>404</h1>
      <p style={{ fontSize: '1.2rem', color: 'var(--text-dim)', marginBottom: 32 }}>
        페이지를 찾을 수 없습니다
      </p>
      <button className="btn-primary" onClick={() => navigate('/')} style={{ padding: '14px 40px', fontSize: '1rem' }}>
        대시보드로 돌아가기
      </button>
    </div>
  );
}
