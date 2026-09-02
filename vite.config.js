/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 테스트 시간대를 한국으로 고정한다.
// 학습 시간 날짜 키는 로컬 기준인데, 실행 환경이 UTC 면(CI 가 그렇다)
// 로컬 날짜와 UTC 날짜가 언제나 같아서 UTC 회귀를 걸러내지 못한다.
// 워커가 뜨기 전(설정 로드 시점)에 지정해야 V8 이 시간대를 반영한다 —
// 테스트 안에서 process.env.TZ 를 바꾸거나 vi.stubEnv 를 써도 듣지 않는다.
if (process.env.VITEST) process.env.TZ = 'Asia/Seoul'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // 기본은 node 환경(파서는 순수 함수). localStorage 가 필요한 파일은
    // 파일 상단 `// @vitest-environment jsdom` 주석으로 개별 지정한다.
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // forks(기본값)는 Windows 에서 jsdom 워커 프로세스 기동이
    // 하드코딩된 60초 START_TIMEOUT 을 넘겨 간헐적으로 실패한다.
    // 네이티브 모듈이 없으므로 threads 로 충분하고 더 빠르다.
    pool: 'threads',
  },
})
