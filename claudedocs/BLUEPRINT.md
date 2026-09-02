# jungchogi-app 블루프린트 — 에이전트 AI 적용 로드맵

> 작성일: 2026-09-02 · 기준 커밋: `283e544` (main) · 상태: **초안(사용자 검토 필요)**
> 목적: 현재까지의 진행 단계를 확정하고, 에이전트 AI를 단계적으로 도입하는 계획을 명세 우선(SDD)으로 정리한다.

---

## 1. 현재 상태 진단 (As-Is)

### 1.1 기술 스택
| 항목 | 내용 |
|---|---|
| 프레임워크 | Vite 8 + React 19.2 (JSX, TypeScript 미사용) |
| 라우팅 | react-router-dom 7, 페이지 lazy 로딩 |
| 콘텐츠 | `public/data/*.md` 18개 (약 300KB) → 런타임 fetch + 정규식 파서 |
| 저장소 | `localStorage` 전용 (`jungchogi_` 접두사), 서버 없음 |
| 배포 | Vercel 정적 호스팅 (`vercel.json` SPA rewrite, `/data/` 제외) |
| 디자인 | VIVARA 디자인 시스템 (`design-system/vivara/MASTER.md`) |
| 품질 | ESLint 9 + react-hooks 7 → **0 errors**. Vitest 4 + jsdom → **81 tests**(파서 3종·storage). GitHub Actions CI(lint→test→build) |
| 규모 | `src/` 약 3,076줄, 페이지 9개, 훅 3개, 파서 3개 |

### 1.2 구현 완료 기능 (git log 기준)
| 커밋 | 기능 |
|---|---|
| `f27b33d` | 초기 구현: Day01~14 학습 문서 뷰어, 단답형 100선 플래시카드/퀴즈, 코드트레이싱 드릴 |
| `d841b3a` | 모바일 UX: 하단 탭바, 스와이프, 반응형 |
| `3ecdc18` | 오답노트 + 학습 대시보드 |
| `efebbf4` | 암기 119선 보강 플래시카드 덱 |
| `a3f79f7` | 버그 수정 5건 + 전문 검색 + 데이터 관리(내보내기/초기화) |
| `d8ad5c0` | 학습노트 인라인 정답 확인 |
| `656440e` | D-Day 카운터, 학습 시간 추적, 오답 유형 분석, 간격 반복(1/3/7일), 404 |
| `a514961` | 코드 스플리팅, MD 캐싱, 셔플 모드, 에러 바운더리 |
| `dd8933f` | 검색 더보기, 타이머 보정, 스토리지 용량 표시 |
| `99c1dd6`/`283e544` | react-hooks lint 위반 13건 제거 (2026-08-31) |

### 1.3 도메인 모델 (현재 암묵적 구조)
```
[Content 컨텍스트]           [Progress 컨텍스트]
 DayDocument (md)             WrongNote {source,id,reviewCount,lastReviewed,mastered}
 QuizItem   {id,question,     QuizResult {id → correct|incorrect}
             answer,category} StudyTimeLog {date → minutes}
 CodeDrill  {id,title,code,   DayChecks {day → bool}
             lang,answer,     ExamDate (ISO string)
             pitfall}         FlashcardKnown {deck → Set<id>}
 BogangCard {id,question,
             answer,category}
```
- 두 컨텍스트가 `source + id` 문자열로만 느슨하게 연결됨. 도메인 객체가 파일별 파서에 흩어져 있고 공통 타입 정의가 없다.
- 채점은 **자기 채점** 방식(정답 확인 후 사용자가 맞음/틀림 선택). 자동 채점 없음.

### 1.4 갭 목록
| # | 갭 | 영향 |
|---|---|---|
| ~~G1~~ | ~~README가 Vite 템플릿 원본 → 진행 상태 파악 불가~~ | ✅ Phase 0 해소 |
| ~~G2~~ | ~~테스트 0건 (파서·스토리지 포함)~~ | ✅ Phase 0 해소 (81 tests) |
| ~~G3~~ | ~~CI 없음~~ | ✅ Phase 0 해소 (`.github/workflows/ci.yml`) |
| G4 | 서버 없음 → API 키를 둘 곳이 없음 | **AI 도입의 선결 과제** |
| G5 | 도메인 타입 미정의 (JS, 파서마다 다른 shape) | AI 도구(tool) 스키마 정의 시 정합성 문제 |
| G6 | 인증/사용량 제한 없음 (공개 URL) | AI 엔드포인트 노출 시 비용 남용 위험 |

---

## 2. 목표 (To-Be)

**"학습자의 오답·학습 시간·D-Day를 읽고, 오늘 무엇을 얼마나 공부할지 스스로 판단해 계획하고 설명해 주는 AI 튜터"**

에이전트 적용 기준(단순 API 호출 vs 에이전트)은 Anthropic 가이드의 4개 기준으로 판정한다:

| 기능 | 복잡성 | 가치 | 실현성 | 오류 비용 | 판정 |
|---|---|---|---|---|---|
| 오답 해설 | 낮음 | 높음 | 높음 | 낮음 | **단일 호출** (스트리밍) |
| 코드트레이싱 채점 | 낮음 | 높음 | 높음 | 중간 | **단일 호출 + 구조화 출력** |
| 단답형 유사 정답 판정 | 낮음 | 중간 | 높음 | 중간 | **단일 호출 + 구조화 출력** |
| 학습 플래너 | 높음 | 높음 | 높음 | 낮음(재생성 가능) | **에이전트** (tool use) |
| 변형 문제 생성 | 중간 | 중간 | 높음 | 낮음 | **Batch API** (비실시간, 50% 비용) |
| 자유 질문 챗 | 중간 | 중간 | 높음 | 낮음 | 단일 호출 + 검색 기반 컨텍스트 |

---

## 3. 목표 아키텍처

### 3.1 구성도
```
Browser (React SPA)                     Vercel Serverless (Node)              Anthropic API
┌──────────────────────┐   fetch/SSE   ┌──────────────────────────┐   SDK   ┌──────────────┐
│ pages/*              │ ────────────► │ api/ai/tutor.js   (stream)│ ──────► │ claude-opus-5│
│ services/aiClient.js │               │ api/ai/grade.js   (parse) │         │  + caching   │
│ hooks/useAiStream.js │               │ api/ai/plan.js    (agent) │         │  + tool use  │
│ domain/*  (types)    │               │ api/ai/generate.js(batch) │         └──────────────┘
│ storage.js (LS)      │ ─ snapshot ─► │ lib/ai/tools/*.js         │
└──────────────────────┘               │ lib/ai/content.js (md 로드)│
                                       │ lib/ai/guard.js (코드·한도)│
                                       └──────────────────────────┘
```

### 3.2 핵심 설계 결정
| 결정 | 선택 | 이유 / 트레이드오프 |
|---|---|---|
| 백엔드 형태 | **Vercel Functions (`api/`)** | 기존 배포 파이프라인 그대로. 별도 서버 운영 없음. 단점: 실행 시간 제한(기본 10s·Pro 60s) → 플래너는 스트리밍 필수 |
| SDK | `@anthropic-ai/sdk` (TypeScript/JS) | 공식 SDK, Tool Runner·streaming·parse 헬퍼 사용 |
| 모델 | `claude-opus-5`, `thinking: {type:"adaptive"}` | 비용은 `output_config.effort`로 조절(해설 `low`, 채점 `medium`, 플래너 `high`) |
| 사용자 데이터 전달 | **요청 시 스냅샷 동봉** (오답노트·결과·학습시간·D-Day, 수 KB) | 서버 DB 없이 localStorage 유지. 도구는 콘텐츠 검색 전용으로 서버에서 실행 |
| 콘텐츠 컨텍스트 | 관련 섹션만 추출 + `cache_control` (1h TTL) | 전체 md(~300KB)를 매번 넣지 않음. 시스템 프롬프트 + 콘텐츠 프리픽스 고정 → 캐시 적중 |
| 접근 제어 (MVP) | 환경변수 `AI_ACCESS_CODE` + 요청 헤더 검사, IP당 분당 호출 제한 | 공개 URL이므로 최소 방어. 정식 인증은 범위 밖 |
| 출력 포맷 | 채점·플랜은 `output_config.format` (structured outputs) | 정규식 파싱 대신 스키마 검증. prefill은 5 계열에서 400 |
| 폴백 | `fallbacks: "default"` (`server-side-fallback-2026-07-01`) | 정책 거절 시 자동 대체 모델 |

### 3.3 바운디드 컨텍스트 (DDD 정리)
```
Content        : DayDocument, QuizItem, CodeDrill, BogangCard  — 읽기 전용, md에서 파생
Progress       : WrongNote(애그리게이트), QuizResult, StudyTimeLog, DayChecks, ExamDate
Tutor (신규)    : TutorSession(값객체: question, userAnswer, explanation)
                 GradeResult(값객체: verdict, score, feedback)
                 StudyPlan(애그리게이트: date, items[], rationale) — localStorage `study_plan_<date>`
```
- `src/domain/` 에 JSDoc 타입(또는 `.d.ts`)으로 공통 shape를 정의하고 파서·API 스키마가 같은 정의를 참조한다.

---

## 4. API 명세 (Spec-First)

모든 엔드포인트: `POST`, `Content-Type: application/json`, 헤더 `x-access-code`.
오류 응답: `{ error: { code: "UNAUTHORIZED"|"RATE_LIMITED"|"BAD_REQUEST"|"UPSTREAM", message } }`

### 4.1 `POST /api/ai/tutor` — 오답 해설 (SSE 스트리밍)
```jsonc
// 요청
{ "source": "quiz100", "id": "042", "userAnswer": "정규화", "history": [] }
// 응답: text/event-stream, data: {"delta":"..."} ... data: {"done":true,"usage":{...}}
```
서버 동작: `source+id`로 문항·정답·해설 로드 → 관련 Day 섹션 검색 → 시스템 프롬프트(캐시) + 문항 컨텍스트 → 스트리밍.

### 4.2 `POST /api/ai/grade` — 자동 채점 (구조화 출력)
```jsonc
// 요청
{ "kind": "code"|"short", "source": "codedrill", "id": "C-07", "userAnswer": "1 2 3" }
// 응답
{ "verdict": "correct"|"partial"|"incorrect", "score": 0..100,
  "feedback": "…", "missedPoints": ["…"], "confidence": 0..1 }
```
`confidence < 0.6` 이면 UI는 자기 채점으로 폴백한다.

### 4.3 `POST /api/ai/plan` — 학습 플래너 (에이전트, SSE)
```jsonc
// 요청 (스냅샷 동봉)
{ "snapshot": { "examDate": "2026-10-18", "wrongNotes": [...], "quizResults": {...},
                "studyTime": {...}, "dayChecks": {...}, "availableMinutes": 90 } }
// 최종 응답 (structured output)
{ "date": "2026-09-02", "items": [
    { "type": "review_wrong", "source": "quiz100", "ids": ["042","077"], "minutes": 20, "why": "…" },
    { "type": "study_day",   "day": 6, "section": "결합도/응집도", "minutes": 30, "why": "…" },
    { "type": "drill",       "source": "codedrill", "ids": ["J-03"], "minutes": 25, "why": "…" } ],
  "rationale": "…", "riskFlags": ["SQL 카테고리 정답률 40% 이하"] }
```
에이전트 도구(서버 실행, 스냅샷·md 파일 위에서 동작):
| tool | 입력 | 출력 |
|---|---|---|
| `search_content` | `query, limit` | 관련 섹션 목록 `{file, heading, excerpt}` |
| `get_section` | `file, heading` | 섹션 본문 |
| `list_problems` | `source, category?, ids?` | 문항 메타 (정답 제외) |
| `get_weak_categories` | — | 스냅샷 기반 카테고리별 정답률 |
| `get_due_reviews` | — | 간격 반복 대기 목록 (`getSpacedRepetitionDue` 서버판) |

`strict: true`, `additionalProperties:false`. 도구 호출 상한 12회, `max_tokens` 16000, 스트리밍 필수.

### 4.4 `POST /api/ai/generate` — 변형 문제 생성 (Batch, 비동기)
관리자용. `{ source, ids[], variantsPerItem }` → Batch 생성 → 결과를 `public/data/generated/*.json` 으로 커밋 (런타임 생성 아님). Phase 4 상세 설계.

---

## 5. 단계별 로드맵

각 Phase는 **명세 → 구현 → 검증(테스트+CI) → 문서 갱신** 순서로 닫는다. 완료 시 이 문서의 상태 표를 갱신한다.

| Phase | 목표 | 산출물 | 완료 조건 | 상태 |
|---|---|---|---|---|
| **0. 기반 정비** | 문서·테스트·CI | `README.md` 현행화, 이 문서, Vitest 4 + jsdom(`tests/` 4파일 81 tests, 실제 콘텐츠 발췌 픽스처), `.github/workflows/ci.yml`(Node 22, lint→test→build) | lint 0 errors · test 81/81 · build 성공 (로컬 확인) | ✅ |
| **1. AI 인프라 + 오답 해설** | 서버 경계 확립 | `api/ai/tutor.js`, `lib/ai/{client,guard,content}.js`, `services/aiClient.js`, `useAiStream`, 오답노트·퀴즈 페이지에 "AI 해설" 버튼 | 스트리밍 해설 동작, 접근 코드·레이트리밋 동작, `cache_read_input_tokens > 0` 확인 | ⏳ |
| **2. 자동 채점** | 자기 채점 → AI 보조 채점 | `api/ai/grade.js`, 구조화 출력 스키마, ExamPage/QuizPage 연동, confidence 폴백 | 채점 평가셋 30문항에서 사람 판정 일치율 측정·기록 | ⏳ |
| **3. 학습 플래너 에이전트** | 핵심 에이전트 | `api/ai/plan.js` + Tool Runner, 도구 5종, `StudyPlan` 저장, 대시보드 "오늘의 계획" 카드 | 플랜 생성 < 60s, 도구 호출 로그, 재생성 가능 | ⏳ |
| **4. 콘텐츠 생성** | 변형 문제·약점 카드 | Batch 스크립트(`scripts/generate-variants.mjs`), 생성물 검수 워크플로 | 생성 문항이 기존 파서·UI에서 그대로 동작 | ⏳ |
| **5. 평가·운영** | 품질/비용 관측 | 평가셋(`tests/eval/`), usage 로깅, 비용 리포트, 프롬프트 회귀 테스트 | Phase별 비용·정확도 수치 문서화 | ⏳ |

### Phase 0 에서 드러난 파서 결함 (테스트로 기록됨)

테스트를 씌우면서 확인된 항목. 앞의 2건은 실제 콘텐츠 파싱 결과가 바뀌지 않음을 확인하고 고쳤고, 나머지는 **현행 동작을 테스트로 고정만 해두었다**(수정 시 사용자에게 보이는 내용이 바뀌므로 별도 결정 필요).

| # | 결함 | 현재 영향 | 처리 |
|---|---|---|---|
| P1 | `<details>`/코드펜스가 없는 문항이 다음 문항의 정답·코드를 가져감 | 잠재 (현 콘텐츠에서는 미발생) | ✅ 수정 (`9a85fcc`) |
| P2 | `split('\n')` 이라 CRLF 문서에서 본문에 `\r` 잔류 | 잠재 (autocrlf=true 인 Windows 클론) | ✅ 수정 (`9a85fcc`) |
| P3 | SQL 드릴 10문제의 `code` 가 실제 쿼리가 아니라 앞의 예제 테이블 — 첫 코드펜스만 읽는다 | **실발생**, `/quiz` 에서 SQL 문제의 쿼리가 안 보임 | 미수정 |
| P4 | 함정 라벨 7종 하드코딩 → `**최다출제 함정**` 누락 (40문제 중 J-01) | 실발생, 함정이 answer 본문으로 흘러감 | 미수정 |
| P5 | `출력` 낱말 경계가 없어 `출력 형식은…` 같은 문장 뒤를 `expectedOutput` 으로 오인 | 잠재 | 미수정 |
| P6 | `loadProgress` 에 try/catch 가 없어 손상된 JSON 이 예외로 터짐 | 잠재 (ErrorBoundary 가 받음) | 미수정 |
| P7 | `saveProgress` 가 `QuotaExceededError` 를 처리하지 않음 | 잠재 (5MB 근접 시) | 미수정 |
| P8 | 학습시간 날짜 키는 UTC, 요일 라벨은 로컬 시각 기준 → 자정 근처 불일치 | 잠재 | 미수정 |

---

### Phase 1 상세 작업 순서 (병렬 가능 항목 표기)
1. `npm i @anthropic-ai/sdk` · `.env.example`(`ANTHROPIC_API_KEY`, `AI_ACCESS_CODE`) · `.gitignore`에 `.env*` 확인
2. **병렬**: (a) `lib/ai/client.js`(SDK 초기화, fallbacks) (b) `lib/ai/guard.js`(코드 검사·레이트리밋) (c) `lib/ai/content.js`(md 로드·섹션 검색 — 기존 `parse*.js` 재사용)
3. `api/ai/tutor.js` — 시스템 프롬프트 고정 텍스트 + `cache_control` → `client.messages.stream` → SSE 변환
4. **병렬**: (a) `src/services/aiClient.js` + `src/hooks/useAiStream.js` (b) `AiExplainPanel` 컴포넌트(VIVARA 토큰)
5. WrongNotePage·QuizPage 연동 → 로컬 `vercel dev`로 검증 → 테스트(guard, content 검색) → CI → 문서 갱신

---

## 6. 비용·리스크

### 6.1 비용 추정 (Opus 5 정가 기준, **실측 전 추정치**)
| 기능 | 입력(캐시 후) | 출력 | 회당 추정 |
|---|---|---|---|
| 오답 해설 | ~3K (대부분 캐시 읽기) | ~500 | 약 $0.01 |
| 채점 | ~2K | ~300 | 약 $0.01 |
| 플래너(도구 6회 가정) | ~25K 누적 (캐시 적중 시 대폭 감소) | ~2K | 약 $0.05–0.10 |
Phase 1 완료 시 `response.usage`를 로깅해 이 표를 실측치로 교체한다. 첫 조절 레버는 캐시 → effort → (필요 시) 모델.

### 6.2 리스크
| 리스크 | 대응 |
|---|---|
| 공개 URL에서 API 키 남용 | 접근 코드 + IP 레이트리밋 + Anthropic 콘솔 월 한도 설정 |
| Vercel 함수 타임아웃 | 모든 AI 엔드포인트 스트리밍, 플래너 도구 호출 상한 |
| 채점 오판 | `confidence` 폴백, 사용자 이의 제기 버튼으로 자기 채점 복귀 |
| 해설 환각(교재와 다른 설명) | 컨텍스트에 교재 섹션 동봉 + "교재 근거 없으면 모른다고 답하라" 지시, `citations` 검토 |
| localStorage 유실 | 기존 데이터 관리(내보내기) 유지, 플랜도 같은 방식 |

---

## 7. 열린 결정 사항 (사용자 확인 필요)
1. **모델/비용**: 기본 `claude-opus-5`로 갈지, 해설처럼 단순한 경로는 저비용 모델로 나눌지 (캐시 네임스페이스가 모델별로 분리되는 점 유의)
2. **접근 제어 수준**: 접근 코드로 충분한지, 본인만 쓰는 앱이면 코드 없이 Vercel 배포 보호(Password Protection)로 대체할지
3. **TypeScript 전환**: Phase 0에서 도메인 타입만 `.d.ts`로 둘지, 전체 TS 전환까지 갈지
4. **Phase 순서**: 플래너(3)를 채점(2)보다 앞당길지 — 플래너가 이 앱의 차별점이라면 2↔3 교체 가능
5. **파서 결함 P3~P8 처리 시점**: §5 표의 미수정 항목을 Phase 1 앞에 별도로 닫을지, 해당 화면을 손대는 Phase 에 묶을지 (특히 P3 은 실사용자에게 보이는 결함)

---

## 8. 문서 현행화 규칙
- 커밋마다 이 문서의 "상태" 열 또는 §1.2 표를 갱신한다(커밋 메시지에 `docs:` 포함).
- `README.md`는 "현재 기능 · 실행 방법 · 이 문서 링크"만 유지하고 상세는 여기에 둔다.
