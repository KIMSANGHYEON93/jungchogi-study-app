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
  },
})
