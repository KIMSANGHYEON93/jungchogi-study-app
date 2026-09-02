# jungchogi-app — 정보처리기사 실기 학습 앱

Vite + React 19 기반 순수 클라이언트 SPA. 14일 학습 문서, 플래시카드, 코드트레이싱 드릴, 모의고사, 오답노트(간격 반복), 학습 대시보드를 제공한다. 서버 없이 `localStorage`에 진행 상태를 저장하고 Vercel에 정적 배포한다.

> 진행 단계·로드맵·에이전트 AI 적용 계획: **[claudedocs/BLUEPRINT.md](claudedocs/BLUEPRINT.md)**

## 현재 상태 (2026-09-02, `283e544`)
- 기능 개발 완료 후 VIVARA 디자인 적용, react-hooks lint 0 errors
- 테스트·CI 없음, AI 기능 없음 → 블루프린트 Phase 0~1에서 착수 예정

## 기능
| 경로 | 기능 |
|---|---|
| `/` | 대시보드 — D-Day, 종합 진도, 주간 학습 시간, 오답 유형 분석, 간격 반복 대기, 14일 체크리스트, 데이터 관리 |
| `/study` | Day01~14 학습 문서 뷰어 (인라인 정답 확인) |
| `/flashcard` | 단답형 100선 · 암기 119선 플래시카드 (셔플, 아는 카드 표시) |
| `/quiz` | 단답형 퀴즈 (자기 채점 → 오답노트 연동) |
| `/exam` | 모의고사 (타이머, 코드/단답 혼합) |
| `/wrong` | 오답노트 (복습 횟수, 1/3/7일 간격 반복) |
| `/search` | 전체 학습 자료 검색 |

## 구조
```
public/data/*.md      학습 콘텐츠 18개 (런타임 fetch)
src/pages/            페이지 9개 (lazy 로딩)
src/utils/parse*.js   md → 문항 객체 파서 (quiz, bogang, codeDrill)
src/utils/storage.js  localStorage 저장 계층 (오답노트, 학습시간, D-Day, 간격반복)
src/hooks/            useTheme, useStudyTimer, useSwipe
design-system/vivara/ 디자인 토큰·규칙
```

## 실행
```bash
npm install
npm run dev      # 개발 서버
npm run lint     # ESLint (0 errors 유지)
npm run build    # dist/ 생성
```

배포: Vercel. `vercel.json`이 `/data/`를 제외한 모든 경로를 `index.html`로 rewrite한다.
