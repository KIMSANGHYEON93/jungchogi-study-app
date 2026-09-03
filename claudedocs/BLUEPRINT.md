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
| 품질 | ESLint 9 + react-hooks 7 → **0 errors**. Vitest 4 + jsdom → **93 tests**(파서 3종·storage). GitHub Actions CI(lint→test→build) |
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
             answer,category} StudyTimeLog {date(로컬) → minutes}
 CodeDrill  {id,title,        DayChecks {day → bool}
             context,code,    ExamDate (ISO string)
             lang,answer,     FlashcardKnown {deck → Set<id>}
             expectedOutput,
             pitfall}
 BogangCard {id,question,
             answer,category}
```
- 두 컨텍스트가 `source + id` 문자열로만 느슨하게 연결됨. 도메인 객체가 파일별 파서에 흩어져 있고 공통 타입 정의가 없다.
- 채점은 **자기 채점** 방식(정답 확인 후 사용자가 맞음/틀림 선택). 자동 채점 없음.

### 1.4 갭 목록
| # | 갭 | 영향 |
|---|---|---|
| ~~G1~~ | ~~README가 Vite 템플릿 원본 → 진행 상태 파악 불가~~ | ✅ Phase 0 해소 |
| ~~G2~~ | ~~테스트 0건 (파서·스토리지 포함)~~ | ✅ Phase 0 해소 (93 tests) |
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

### 4.4 변형 문제 생성 — **스크립트로 구현. 엔드포인트 아님** (정정 2026-09-03)

> 초안은 이 항목을 `POST /api/ai/generate` 로 적었다. **엔드포인트를 만들지 않는다.**
> 산출물은 `scripts/generate-variants.mjs` 다. 근거 셋:
> 1. **Vercel 서버리스는 파일시스템이 읽기 전용**이라 `public/data/generated/` 에 쓸 수 없다.
> 2. 결과물은 런타임 생성이 아니라 **리포에 커밋되는 파일**이고, 커밋은 함수가 할 일이 아니다.
> 3. **Batch 는 완료까지 최대 24시간** 걸린다. 함수 실행 시간(10s·Pro 60s) 안에 끝나지 않는다.
>
> 같은 이유로 접근 코드·레이트리밋(`lib/ai/guard.js`)도 여기에는 해당이 없다.
> 이 스크립트는 리포를 가진 사람이 자기 키로 로컬에서 돌린다.

```bash
node scripts/generate-variants.mjs --source quiz100 --ids 001,002,042 --variants 2
node scripts/generate-variants.mjs --source codedrill --category sql --variants 3
node scripts/generate-variants.mjs --resume msgbatch_01ABC...   # 결과만 다시 수거
node scripts/validate-generated.mjs                             # 계약 검증 (키 불필요)
```

**생성물 계약** — 프론트엔드와 공유하는 고정 shape. `public/data/generated/<source>.json`:

```jsonc
{
  "version": 1,
  "source": "quiz100",              // 원본 교재 source
  "generatedAt": "2026-09-03T12:00:00.000Z",
  "model": "claude-opus-5",
  "reviewed": false,                // 사람 검수 통과 여부. false 면 앱이 쓰지 않는다
  "items": [ /* 파서 출력 shape + variantOf + generated: true */ ]
}
```

| source | `items[]` 필드 |
|---|---|
| `quiz100` · `bogang` | `{id, question, answer, category, variantOf, generated}` |
| `codedrill` | `{id, title, context, code, lang, answer, expectedOutput, pitfall, variantOf, generated}` |

`id` 는 `<원본 id>-v<n>` (예: `042-v1`) 이라 원본과 충돌하지 않는다. `variantOf` 는 원본 id.
검수 절차는 `claudedocs/GENERATED_REVIEW.md`.

---

## 5. 단계별 로드맵

각 Phase는 **명세 → 구현 → 검증(테스트+CI) → 문서 갱신** 순서로 닫는다. 완료 시 이 문서의 상태 표를 갱신한다.

| Phase | 목표 | 산출물 | 완료 조건 | 상태 |
|---|---|---|---|---|
| **0. 기반 정비** | 문서·테스트·CI·드러난 결함 해소 | `README.md` 현행화, 이 문서, Vitest 4 + jsdom(`tests/` 4파일 93 tests, 실제 콘텐츠 발췌 픽스처), `.github/workflows/ci.yml`(Node 22, lint→test→build), 파서·스토리지 결함 P1~P8 수정 | lint 0 errors · test 93/93 · build 성공 (로컬 확인) | ✅ |
| **1. AI 인프라 + 오답 해설** | 서버 경계 확립 | `api/ai/tutor.js`, `lib/ai/{client,guard,content}.js`, `services/aiClient.js`, `useAiStream`, `AiExplainPanel`, `domain/aiSource.js`, 오답노트·코드퀴즈에 "AI 해설" 버튼 | 스트리밍 해설 동작, 접근 코드·레이트리밋 동작, `cache_read_input_tokens > 0` 확인 | 🔷 **코드 완료 · 라이브 검증 대기** (구현·테스트 267/267·lint·build 통과. 실제 API 호출은 키가 있는 환경에서 `.env.example` 하단 6단계 절차를 밟아야 닫힌다) |
| **2. 학습 플래너 에이전트** | 핵심 에이전트 (§7-4 로 채점보다 앞당김) | `api/ai/plan.js` + Tool Runner(`betaTool`, zod 불필요), 도구 5종(`lib/ai/tools/`), `lib/ai/spacedRepetition.js`, `domain/studyPlan.js`, `usePlanStream`, `TodayPlanCard`, `study_plan_<date>` 저장(최근 7개), `/study?day=` · `/search?q=` 딥링크 | 플랜 생성 < 60s, 도구 호출 로그, 재생성 가능 | 🔷 **코드 완료 · 라이브 검증 대기** (테스트 482/482 · lint · build 통과. < 60s 완주와 구조화 출력+도구 조합은 키가 있는 환경에서 `.env.example` 7~10 항으로 확인) |
| **3. 자동 채점** | 자기 채점 → AI 보조 채점 | `api/ai/grade.js`(구조화 출력), `domain/grading.js`, `useAiGrade`, `AiGradePanel`, `services/aiTransport.js`(공용 전송 계층), QuizPage·ExamPage 연동, 평가셋 `tests/eval/grading.json` 30건 + `scripts/eval-grading.mjs` | 채점 평가셋 30문항에서 사람 판정 일치율 측정·기록 | 🔷 **코드 완료 · 평가셋 측정 미완** (테스트 640/640 · lint · build 통과. 일치율 측정은 실제 호출 30건이 필요해 `.env.example` 11~16항으로 닫는다) |
| **4. 콘텐츠 생성** | 변형 문제·약점 카드 | `scripts/generate-variants.mjs`(Batch), `scripts/validate-generated.mjs`, `lib/ai/{variants,generated,batchRunner}.js`, 생성물 계약(§4.4)·검수 워크플로(`claudedocs/GENERATED_REVIEW.md`), 앱 소비 쪽 `utils/generatedDeck.js`·`domain/generatedItems.js`·`useVariantPreference`·`GeneratedBadge`·`VariantToggle` + 5개 학습 화면 연동 | 생성 문항이 기존 파서·UI에서 그대로 동작 | 🔷 **코드 완료 · 실제 생성 대기** (테스트 866/866 · lint · build 통과. 파서 shape 일치와 `reviewed:false` 차단은 테스트로 고정. 실제 Batch 실행은 키가 있는 환경에서 `.env.example` 17~20항으로 닫는다) |
| **5. 평가·운영** | 품질/비용 관측 | 평가셋(`tests/eval/`), usage 로깅, 비용 리포트, 프롬프트 회귀 테스트 | Phase별 비용·정확도 수치 문서화 | ⏳ |

### Phase 2 구현 노트 (2026-09-03)

- **Tool Runner에 `zod`가 필요 없다.** `betaZodTool` 대신 `betaTool`(`@anthropic-ai/sdk/helpers/beta/json-schema`)에
  raw JSON Schema를 주면 된다. plain JS(ESM)에서 import·실행 확인. 의존성 추가 0건.
  `betaTool`은 `strict`를 인자로 받지 않아 `{...betaTool({...}), strict: true}`로 얹는다.
- **구조화 출력과 도구 사용은 함께 쓸 수 있다.** 문서상 구조화 출력의 비호환은 citations·prefill 뿐이다.
  400이 날 경우의 폴백(스키마를 시스템 프롬프트로 내리기)은 `extractPlan`이 이미 잡는다.
- **도구 호출 상한 12회는 도구 래퍼가 직접 센다.** 한 턴에 여러 도구를 병렬로 부를 수 있어
  Tool Runner의 `max_iterations`(=16, 안전망)와 같은 수가 아니다.
- **`get_due_reviews`는 화면과 같은 판정이어야 한다.** `tests/plan-spaced-repetition.test.js`가
  jsdom에서 `src/utils/storage.js`의 실제 `getSpacedRepetitionDue`를 import해 두 구현 결과를 직접 비교한다.
- **스냅샷은 본문을 싣지 않는다.** 식별자·메타데이터만 보내고 상세는 서버가 교재에서 다시 찾는다.
  화이트리스트 필드가 클라이언트·서버 양쪽에서 정확히 일치해야 한다 — 이 불일치로 결함 2건이 실제로 났다
  (`addedAt` 누락 시 모든 미숙달 오답이 "즉시 복습 대기"로 잡힘, `dayChecks` 값이 `1`이면 요청 전체가 400).
- **문항 단위 딥링크는 못 걸었다.** QuizPage·FlashcardPage·WrongNotePage가 문항 인덱스를 내부
  `useState`로만 갖고 URL을 읽지 않는다. 화면 단위(`/study?day=N`, `/search?q=`)까지만 연결했다.
  문항 딥링크를 걸려면 세 페이지의 상태 소유권을 URL로 옮겨야 하는데 기존 동작을 바꾸는 변경이라 미룬다.
- ~~`get_weak_categories`의 정답률 정의가 잠정적이다~~ → **Phase 3에서 조였다**(아래 Phase 3 노트).

### Phase 3 구현 노트 (2026-09-03)

- **구조화 출력에 `strict` 플래그는 없다.** SDK 타입 `BetaJSONOutputFormat`은 `{type, schema}` 두 필드뿐이고,
  `strict: true`는 도구(`Tool`) 쪽 필드다(Phase 2의 도구 5종이 쓰는 그 자리). 구조화 출력은 스키마 준수가
  기능 자체의 보장이라 플래그가 없다. 호출은 `client.beta.messages.parse(params)`(폴백을 쓰므로 beta 네임스페이스),
  `output_config: { effort, format: { type: 'json_schema', schema } }`. **zod 불필요.**
- **구조화 출력은 `minimum`/`maximum`/`multipleOf`를 지원하지 않는다.** `score` 0~100, `confidence` 0~1을
  스키마로 못 박지 못해 `description`으로 알리고 서버 `normalizeGrade`가 응답을 받은 뒤 조인다.
- **`quiz_results` 값이 세 개가 됐다** — `'correct'`/`'incorrect'`(채점 결과) + `'answered'`(정답 확인만 하고
  채점 안 한 상태. 기존 데이터도 이 값). **마이그레이션은 불가능하다**(레거시에 정오 정보가 없음).
  대신 읽는 쪽 4곳이 세 값을 모두 다룬다: 대시보드 진도·정답률, QuizPage 진행바, 플래너 스냅샷,
  서버 `get_weak_categories`. **진도는 세 값을 다 세고, 정답률은 채점분만으로 계산한다** —
  레거시를 정답으로도 오답으로도 세면 통계가 조용히 틀어진다.
- `get_weak_categories`의 규칙: **아는 것이 추정을 이긴다.** `'correct'`/`'incorrect'`는 확정으로 세고,
  `'answered'`와 계약 밖 값은 오답노트 기반 추정으로 폴백. 미숙달 노트라도 최근 `'correct'`면 오답이 아니고,
  숙달 노트라도 최근 `'incorrect'`면 오답이다.
- **정답 조기 노출 차단**: `feedback`·`missedPoints`가 정답을 설명하므로 화면이 정답을 이미 공개한
  시점(코드 퀴즈 `submitted`, 모의고사 `phase === 'result'`)에만 패널을 렌더한다. 시험 중에는 노드 자체가 없다.
- `confidence < 0.6`이면 **저장하지 않고** 자기 채점으로 넘긴다. 읽을 수 없는 confidence는 0으로 본다
  (모르면 자기 채점으로 떨어지는 쪽이 안전).

### Phase 4 구현 노트 (2026-09-03)

- **엔드포인트가 아니라 스크립트다.** §4.4 정정 참조 (읽기 전용 FS · 커밋되는 산출물 · 24시간 배치).
- **Batch 호출 형태** (SDK 타입 `resources/messages/batches.d.ts` 로 확인):
  `client.messages.batches.create({requests: [{custom_id, params}]})` — `params` 는
  `MessageCreateParamsNonStreaming` 이라 `output_config.format` 구조화 출력이 그대로 된다.
  `retrieve(id).processing_status` 를 폴링하고(`in_progress`·`canceling` 은 아직, `ended` 만 끝),
  `await results(id)` 가 주는 JSONL 디코더를 `for await` 로 소비한다.
- **서버측 폴백(`fallbacks`)은 Batch API 에서 거부된다.** Phase 1~3 요청과 여기가 다른 유일한 점이라
  `lib/ai/client.js` 의 `build*Request` 를 재사용하지 않고 `lib/ai/variants.js` 가 따로 만든다.
  (`thinking` 생략 · `effort` 는 `output_config` 안 · 구조화 출력에 `strict` 없음은 그대로.)
- **결과는 순서를 보장하지 않는다.** `custom_id`(`<source>__<id>__v<n>`)로만 되맞춘다. 위치로
  매칭하면 조용히 어긋나므로, 읽을 수 없는 `custom_id` 는 폴백하지 않고 실패로 남긴다.
- **모델에게는 바꿀 것만 맡긴다.** `category`(단답형·보강)와 `lang`(드릴)은 원본에서 가져와
  코드가 채운다 — 모델이 지어내면 화면의 분류·구문 강조가 조용히 어긋난다.
  `id`·`variantOf`·`generated` 도 코드가 채운다. 스키마에는 `question`/`answer`(또는 드릴 6필드)만 둔다.
- **재개 가능해야 한다.** 배치를 만든 **직후** `claudedocs/generated-batches/<batch_id>.json` 에
  기록을 남긴다. 그 뒤 프로세스가 죽어도 `--resume <batch_id>` 로 결과만 다시 수거한다.
  폴링은 5초에서 시작해 ×1.6, 60초 상한. 대기 상한을 넘기면 batch id 를 담아 던진다.
- **비용은 실행 전에 알린다.** 요청 건수·추정 토큰·추정 비용(Batch 50% 할인 반영)을 찍고
  `--yes` 가 없으면 확인을 받는다. 토큰은 글자 수 근사(한글 1.3자/토큰, 그 외 3.6자/토큰)라
  ±50% 는 어긋난다 — 실제값은 끝난 뒤 결과의 `usage` 로 찍는다. `--all` 은 의도적으로 명시해야 한다.
- **`reviewed: false` 는 계약이다.** 생성기는 언제나 false 로 쓰고, 사람이 검수 후 손으로 올린다.
  앱은 `reviewed === true` 인 파일만 읽는다. 검증기는 형식만 보고 **정답의 정오는 못 본다** —
  그래서 검수 절차를 `claudedocs/GENERATED_REVIEW.md` 에 문서로 남겼다.
- **예시 생성물은 `tests/fixtures/generated/` 에 둔다.** `public/data/generated/` 에 두면
  실제 생성물이 아닌 것을 앱이 집어간다.

### Phase 4 에서 남긴 것

- **실제 Batch 실행 미완.** 키가 필요하다. `--variants 2` 기준 추정: 단답형 100선 전체 200건 약 $4,
  드릴 40문항 전체 80건 약 $2.9, 보강 119선 전체 238건 약 $5. 먼저 `--ids` 로 3~5문항만
  돌려 프롬프트를 확인한 뒤 넓히는 것이 싸다.
- **"약점 카드"는 만들지 않았다.** Phase 4 목표 열의 두 번째 항목인데, 약점 판정이
  스냅샷(클라이언트 상태)에 달려 있어 오프라인 배치 스크립트로는 대상을 정할 수 없다.
  플래너(`get_weak_categories`)가 이미 실시간으로 그 일을 한다 — 별도 배치가 필요한지부터 재검토.
- **생성 문항은 오답노트·간격반복에 섞이면 id 규칙을 타야 한다.** `042-v1` 은 원본과 다른 키라
  `wrong_notes` 에 그대로 들어간다. 원본을 틀린 사람에게 그 변형을 우선 보여주려면
  `variantOf` 를 읽는 로직이 따로 필요하다 (이번 범위 밖).

### Phase 3 에서 남긴 것 (다음 회차 후보)

- **평가셋 30건 측정 미완.** `node scripts/eval-grading.mjs` — 실제 호출 30건, 회당 약 $0.01 추정 → 1회 약 $0.3.
- **모의고사 결과는 `quiz_results`에 쓰지 않는다.** 이 맵은 id만 키로 쓰는 평평한 구조이고 코드 퀴즈
  40문항 진도(`quizDone/40`)가 여기 걸려 있어, 모의고사 단답형 id가 섞이면 진도가 40을 넘는다.
  모의고사 채점을 약점 분석에 반영하려면 별도 키(`exam_results`)와 스냅샷 필드가 필요하다(서버 계약 변경).
- **`partial`은 `'incorrect'`로 접어 저장한다.** 저장 계약에 중간값이 없다.
- 클라이언트가 `userAnswer`를 서버 상한(2,000자)에 맞춰 미리 자르지 않는다. 초과하면 400 →
  "직접 채점해 주세요" 안내로 떨어져 학습은 이어지지만, 미리 자르는 편이 낫다.

### Phase 4 앱 소비 쪽 노트 (2026-09-03)

- **`reviewed: false`인 생성물은 앱이 절대 쓰지 않는다.** AI가 만든 정답이 틀릴 수 있고 학습 앱에서는
  그게 직접적인 해악이다. 사람 검수(`claudedocs/GENERATED_REVIEW.md`)를 통과해 `reviewed: true`로
  올라간 파일만 덱에 들어간다. 테스트로 고정.
- **변형 문항 id(`042-v1`)는 교재에 없다.** 이게 Phase 4에서 가장 많은 것을 깨뜨릴 뻔한 지점이다:
  - AI 해설(`/api/ai/tutor`)·자동 채점(`/api/ai/grade`)은 `source+id`로 교재를 다시 찾는다.
    서버 guard의 `ID_PATTERN`이 변형 id를 거절해 400이다 → `toAiSource`가 변형 문항에 `null`을 주고
    **버튼이 아예 안 뜬다.** 눌러 봐야 오류 문구만 나오는 버튼은 없느니만 못하다.
  - 플래너 스냅샷의 `quizResults`에서 변형 id를 제외한다(서버가 못 찾는 id로 200건 상한을 낭비하지 않게).
  - 변형 채점 결과는 `variant_results` **별도 키**에 쌓는다. `quiz_results`는 id만 키로 쓰는 평평한 맵이고
    코드 퀴즈 진도(`quizDone/40`)가 거기 걸려 있어, 변형이 섞이면 진도가 40을 넘는다.
- SearchPage의 필터 키(`codeDrill`)와 교재 출처 이름(`codedrill`)이 달라 `SOURCE_CONFIG` 한 곳에서 맞춘다.
- **생성물 파일이 없는 것이 정상 상태다.** 로더는 404를 오류가 아니라 "생성물 없음"으로 다룬다.

### Phase 0 에서 드러난 파서·스토리지 결함 — **전건 해소 (2026-09-02)**

테스트를 씌우면서 확인된 8건. P1·P2 는 Phase 0 안에서 고쳤고, 화면에 보이는 내용이 바뀌는 P3~P8 은 현행 동작을 테스트로 고정만 해두었다가 별도 작업으로 닫았다. 각 건마다 실패하는 테스트를 먼저 쓰고(고정해 둔 특성 테스트의 기대값을 새 동작으로 갱신) 수정했으며, `public/data` 실제 콘텐츠를 파싱한 JSON 을 수정 전후로 덤프해 **의도한 차이만 있는지 확인**했다.

| # | 결함 | 처리 | 커밋 |
|---|---|---|---|
| P1 | `<details>`/코드펜스가 없는 문항이 다음 문항의 정답·코드를 가져감 | ✅ 수정 | `9a85fcc` |
| P2 | `split('\n')` 이라 CRLF 문서에서 본문에 `\r` 잔류 | ✅ 수정 | `9a85fcc` |
| P3 | 첫 코드펜스만 읽어 SQL 드릴의 실제 쿼리가 화면에 안 보임 | ✅ 수정 — 규칙 교체 + `context` 필드 신설 | `f130c9b` |
| P4 | 함정 라벨 7종 하드코딩 → `**최다출제 함정**` 누락 | ✅ 수정 — 라벨 목록 폐기, `**라벨**: 본문` 패턴 판정 | `aaa78ed` |
| P5 | `출력` 낱말 경계가 없어 문장 속 "출력" 뒤를 `expectedOutput` 으로 오인 | ✅ 수정 — 줄머리 `출력:` 만 인식 | `69c79f2` |
| P6 | `loadProgress` 에 try/catch 가 없어 손상된 JSON 이 예외로 터짐 | ✅ 수정 — 기본값 폴백 + 콘솔 경고, 원본은 보존 | `176b45b` |
| P7 | `saveProgress` 가 `QuotaExceededError` 를 처리하지 않음 | ✅ 수정 — `false` 반환 + 콘솔 경고, 그 외 예외는 전파 | `176b45b` |
| P8 | 학습시간 날짜 키는 UTC, 요일 라벨은 로컬 → 자정 근처 불일치 | ✅ 수정 — 로컬 기준 통일 (마이그레이션 없음, 아래 근거) | `8f6e96c` |

#### P3 규칙 결정 근거 (40문제 전수 확인)

문항의 코드펜스를 `<details>`(정답) 기준으로 앞뒤로 나눠 보면 세 형태뿐이다.

| 형태 | 문항 | 지문 영역 코드펜스 |
|---|---|---|
| A | C-01~10, J-01~10, P-01~10 (30개) | 1개 — 언어 태그 있음(` ```c `/` ```java `/` ```python `) |
| B | S-01, 02, 03, 04, 06, 07, 09, 10 (8개) | 2개 — [예제 테이블(태그 없음), 쿼리(` ```sql `)] |
| C | S-05, S-08 (2개) | 1개 — 태그 없음(조건 지문/빈칸). `sql` 펜스는 정답 안에 있다 |

형태 B 의 예제 테이블은 장식이 아니다. S-01 은 표의 행이 있어야 `AVG(급여)` 를 계산할 수 있고, S-04 는 `NULL` 이 몇 개인지 표를 봐야 `COUNT` 를 답할 수 있다. **예제 테이블과 쿼리를 둘 다 보여줘야 하므로 펜스 하나를 고르는 것으로는 부족하고 필드를 늘려야 한다.**

채택한 규칙: **지문(`<details>` 이전) 코드펜스를 모두 모아, 언어 태그가 붙은 마지막 펜스를 `code`, 나머지를 `context` 로 분리한다.** 태그가 하나도 없으면 마지막 펜스가 `code` 다. A 는 `code` 그대로·`context` 빈 값, B 는 쿼리가 `code`·표가 `context`, C 는 지문이 `code`·`context` 빈 값 — 세 형태를 한 규칙으로 덮는다. `<details>` 를 경계로 둔 덕에 C 형태에서 정답의 `sql` 펜스를 문제 코드로 오인하지 않는다.

표는 SQL 코드가 아니므로 구문 강조 대상이 아니다. `code` 는 기존대로 `SyntaxHighlighter`(`lang`)로, `context` 는 강조 없는 `ProblemContext` 블록으로 쿼리 위에 띄운다. `code` 는 문자열 그대로 두어(배열로 바꾸지 않아) 이미 저장된 오답노트가 깨지지 않는다.

#### P8 마이그레이션 판단

**하지 않는다.** 로그는 `{ "YYYY-MM-DD": 분 }` 합계 한 칸이라, 같은 키에 "전날 저녁 학습(키가 이미 정확)"과 "당일 새벽 학습(키가 하루 이름)"의 분이 섞여 들어가 있고 이를 되가를 정보가 남아 있지 않다. 한국(UTC+9)에서 UTC 키가 어긋나는 건 로컬 00:00~08:59 학습뿐이고 나머지 15시간은 이미 맞으므로, 키를 일괄 +1일 이동하면 맞던 다수를 망가뜨린다. 과거 기록은 그대로 두고 앞으로 쌓이는 값만 정확해진다.

#### 남긴 것

- `DashboardPage` 백업 파일명(`jungchogi_backup_<날짜>.json`)은 아직 `toISOString()`(UTC)을 쓴다. 저장 데이터가 아니라 다운로드 파일 이름이라 이번 범위에 넣지 않았다.
- `expectedOutput` 은 현재 어느 화면에서도 쓰지 않는다. P5 수정으로 값이 정확해졌지만 눈에 보이는 변화는 없고, Phase 2(자동 채점)의 비교 기준값으로 쓸 때 효과가 난다.

#### 검증

`npm run lint` 0 errors · `npm test` 93 tests(81 → 93) · `npm run build` 성공. 실제 콘텐츠 파싱 결과 변경 필드 53개 = `context` 신규 40(값이 있는 건 SQL 8문제) + `code` 8 + J-01 `pitfall`/`answer` + S-08 `pitfall`/`answer` + J-02 `expectedOutput` 1. 단답형 100선·보강 119선 파싱 결과는 변화 없음.

테스트 시간대는 `vite.config.js` 에서 테스트 실행 시에만 `Asia/Seoul` 로 고정한다. 실행 환경이 UTC 면(CI 가 그렇다) 로컬 날짜와 UTC 날짜가 언제나 같아 P8 회귀를 걸러내지 못하기 때문이다. 워커가 뜨기 전에 지정해야 하며, 테스트 안에서 `process.env.TZ` 를 바꾸거나 `vi.stubEnv` 를 써도 듣지 않는다.

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

## 7. 결정 사항 (2026-09-02 확정)
1. ~~모델/비용~~ → **단일 `claude-opus-5` 유지.** 저비용 모델로 나누지 않고 `output_config.effort`로 조절한다
   (해설 `low`, 채점 `medium`, 플래너 `high`). 이유: 캐시 네임스페이스가 모델별로 분리돼 모델을 쪼개면
   콘텐츠 프리픽스 캐시 재사용을 잃는다. 최신 모델의 낮은 effort가 구세대의 높은 effort보다 나은 경우가 많다.
2. ~~접근 제어 수준~~ → **Vercel 배포 보호(Password Protection)를 1차 게이트로 삼는다.**
   다만 `api/ai/*`는 공개 URL에 노출되는 서버리스 함수이고 남용되면 곧바로 API 비용이 나가므로,
   `lib/ai/guard.js`는 **레이트리밋을 항상** 적용하고 **`AI_ACCESS_CODE` 환경변수가 설정돼 있을 때만**
   `x-access-code` 헤더를 요구한다(미설정이면 코드 검사를 건너뛴다). 배포 보호가 없는 플랜에서도,
   보호를 켠 상태에서도 둘 다 성립한다.
3. ~~TypeScript 전환~~ → **하지 않는다. JS 유지.** 공통 shape는 `src/domain/`에 JSDoc `@typedef`로 둔다.
   이유: 3,000줄 규모에서 전환 비용 대비 이득이 작고, Phase 1~3의 실제 위험은 타입이 아니라
   AI 응답 스키마 검증(structured outputs가 담당)이다.
4. ~~Phase 순서~~ → **플래너를 앞당긴다. Phase 2 = 학습 플래너(구 3), Phase 3 = 자동 채점(구 2).**
   이유: 플래너가 이 앱의 차별점이고, 채점은 플래너가 만든 계획을 소비하는 쪽에 가깝다.
5. ~~**파서 결함 P3~P8 처리 시점**~~ → **결정됨(2026-09-02)**: Phase 1 앞에 별도로 닫았다. §5 "Phase 0 에서 드러난 파서·스토리지 결함" 참조

---

## 8. 문서 현행화 규칙
- 커밋마다 이 문서의 "상태" 열 또는 §1.2 표를 갱신한다(커밋 메시지에 `docs:` 포함).
- `README.md`는 "현재 기능 · 실행 방법 · 이 문서 링크"만 유지하고 상세는 여기에 둔다.
