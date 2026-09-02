# jungchogi-app — 정보처리기사 실기 학습 앱

Vite + React 19 기반 순수 클라이언트 SPA. 14일 학습 문서, 플래시카드, 코드트레이싱 드릴, 모의고사, 오답노트(간격 반복), 학습 대시보드를 제공한다. 서버 없이 `localStorage`에 진행 상태를 저장하고 Vercel에 정적 배포한다.

> 진행 단계·로드맵·에이전트 AI 적용 계획: **[claudedocs/BLUEPRINT.md](claudedocs/BLUEPRINT.md)**

## 현재 상태 (2026-09-02)
- 기능 개발 완료 후 VIVARA 디자인 적용, react-hooks lint 0 errors
- 블루프린트 **Phase 0(기반 정비) 완료** — Vitest 93 tests, GitHub Actions CI(lint→test→build), 파서·스토리지 결함 8건 해소
- AI 기능 없음 → 블루프린트 Phase 1에서 착수 예정

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
api/ai/tutor.js       오답 해설 엔드포인트 (Vercel Function, SSE 스트리밍)
lib/ai/               서버 라이브러리 — client(SDK)·guard(접근제어)·content(md 로드)
design-system/vivara/ 디자인 토큰·규칙
```

## 실행
```bash
npm install
npm run dev         # 개발 서버
npm run lint        # ESLint (0 errors 유지)
npm test            # Vitest 1회 실행
npm run test:watch  # Vitest watch 모드
npm run build       # dist/ 생성
```

배포: Vercel. `vercel.json`이 `/api/`·`/data/`를 제외한 모든 경로를 `index.html`로 rewrite한다.

## AI 서버 (블루프린트 Phase 1)

`POST /api/ai/tutor` — 틀린 문항 하나에 대한 해설을 SSE로 스트리밍한다.

```
요청  { "source": "quiz100"|"codedrill"|"bogang", "id": "042",
        "userAnswer": "정규화", "history": [] }
      AI_ACCESS_CODE 가 설정된 경우에만 헤더 x-access-code 필요

성공  200 text/event-stream
        data: {"delta":"..."}\n\n            ← 0회 이상
        data: {"done":true,"usage":{...}}\n\n ← 마지막 1회

실패  JSON { "error": { "code", "message", "retryable"? } }
        401 UNAUTHORIZED · 429 RATE_LIMITED · 400 BAD_REQUEST · 502 UPSTREAM
      스트림이 시작된 뒤의 오류는 SSE 프레임으로:
        data: {"error":{"code":"UPSTREAM","message":"..."}}\n\n
```

- **모델**: `claude-opus-5`, `output_config.effort: "low"`, `max_tokens: 4000`.
  `thinking` 은 보내지 않는다(Opus 5는 기본 adaptive). `budget_tokens`·assistant prefill은 400이라 쓰지 않는다.
- **프롬프트 캐싱**: 시스템 프롬프트 + `정보처리기사_실기_합격전략.md` 를 고정 프리픽스로 두고
  마지막 블록에 `cache_control: {type:"ephemeral", ttl:"1h"}` 를 건다. 문항·답안·관련 섹션 같은
  가변 내용은 전부 `messages` 에 둔다. 적중 지표는 `usage.cache_read_input_tokens > 0`.
- **접근 제어**(블루프린트 §7-2): 레이트리밋은 **항상**, 접근 코드는 `AI_ACCESS_CODE` 가 설정된 경우에만.
  ⚠️ 레이트리밋 카운터는 함수 인스턴스 메모리에 살고 서버리스는 인스턴스가 여러 개 뜨므로
  실제 허용량은 인스턴스 수만큼 늘어날 수 있다. **정확한 분산 한도가 아니라 남용 억제용 최선 노력**이다.
  정확한 한도가 필요하면 Vercel KV·Firewall 로 옮겨야 한다(이번 범위 밖).
- **서버측 폴백**: `lib/ai/client.js` 의 `USE_SERVER_FALLBACK` 상수 하나로 켜고 끈다.
  기본은 `true` 지만 **실제 호출로 검증되지 않았다** — 라이브 확인에서 400이 나오면 `false` 로 내리면 된다.
- **콘텐츠 로드**: `lib/ai/content.js` 가 `src/utils/parse*.js` 를 **그대로 import** 한다(복사 금지).
  파서는 브라우저 API를 안 쓰는 순수 함수라 Node 에서도 돈다. 규칙이 한 곳에만 있어야 화면과 해설이 어긋나지 않는다.
- **환경변수와 라이브 스모크 테스트 절차**: **[`.env.example`](.env.example)** 참조.
  자동 테스트는 SDK를 모킹하므로 실제 스트리밍·캐시 적중은 `vercel dev` 로 한 번 사람이 확인해야 한다.

## 테스트
`tests/`에 Vitest 특성 테스트(characterization test)를 둔다. 파서는 node 환경, `localStorage`가 필요한 파일만 상단 `// @vitest-environment jsdom` 주석으로 jsdom을 쓴다.

| 파일 | 대상 |
|---|---|
| `tests/parseQuiz.test.js` | 단답형 파서 — 문항 추출, 카테고리 매핑, details 경계 |
| `tests/parseBogang.test.js` | 보강 파서 — id 패딩, 본문 경계, 키워드→카테고리 |
| `tests/parseCodeDrill.test.js` | 코드드릴 파서 — Part별 lang, 코드펜스, 함정 라벨, 출력 추출 |
| `tests/storage.test.js` | `localStorage` 계층 — 접두사·직렬화·오답노트·간격반복·용량 |
| `tests/ai-guard.test.js` | 접근 제어 — 오류 계약, 타이밍 안전 비교, 레이트리밋 경계, body 검증 |
| `tests/ai-content.test.js` | 콘텐츠 로드 — 파서 재사용, 경로 탈출 방지, 섹션 검색 적합도 |
| `tests/ai-client.test.js` | SDK 초기화 — 요청 파라미터, 업스트림 오류 분류(재시도 가능/불가) |
| `tests/ai-tutor.test.js` | 엔드포인트 — SSE 프레임 형식, 401/400/429/502, 스트림 중간 오류, 캐시 프리픽스 안정성 |

픽스처(`tests/fixtures/*.md`, `tests/fixtures/ai-data/*.md`)는 `public/data`의 실제 콘텐츠에서 발췌했다.
`ai-tutor` 는 `vi.mock('@anthropic-ai/sdk')` 로 SDK를 모킹한다(오류 클래스는 실물을 그대로 쓴다).
섹션 검색 적합도만 실물 `public/data` 를 쓴다 — 발췌 픽스처로는 "흔한 낱말 vs 희귀한 낱말"이 갈리지 않는다.

CI: `.github/workflows/ci.yml` — main push와 main 대상 PR에서 Node 22로 lint → test → build를 순차 실행한다.
