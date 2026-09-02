/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
