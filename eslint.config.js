import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    // 빌드·테스트 설정 파일은 브라우저가 아니라 Node 에서 실행된다
    files: ['vite.config.js', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    // 서버리스 함수·서버 라이브러리·테스트는 Node 에서 실행된다.
    // globals.node 에 fetch 계열 웹 표준 전역(Request/Response/Headers/
    // ReadableStream/TextEncoder)도 들어 있어 웹 핸들러를 그대로 쓸 수 있다.
    files: ['api/**/*.js', 'lib/**/*.js', 'tests/**/*.js'],
    languageOptions: { globals: globals.node },
    rules: {
      // React 컴포넌트 파일이 아니므로 Fast Refresh 규칙은 해당 없다
      'react-refresh/only-export-components': 'off',
    },
  },
])
