import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="page" style={{ textAlign: 'center', paddingTop: 80 }}>
          <h2 style={{ marginBottom: 12 }}>문제가 발생했습니다</h2>
          <p style={{ color: 'var(--text-dim)', marginBottom: 24 }}>
            페이지를 새로고침하거나 다른 메뉴를 이용해주세요.
          </p>
          <button
            className="btn-primary"
            onClick={() => {
              this.setState({ hasError: false });
              window.location.href = '/';
            }}
          >
            대시보드로 돌아가기
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
