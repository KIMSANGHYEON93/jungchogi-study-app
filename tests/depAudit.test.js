// 의존성 취약점 회귀 가드.
//
// `npm audit` 자체는 CI 스텝으로 두지 않는다 — 레지스트리에 네트워크로 물어보는
// 명령이라 advisory DB 가 갱신되거나 registry 가 503 을 내면(실제로 겪었다) 우리
// 코드와 무관하게 CI 가 빨개진다. 대신 **한 번 확인한 권고 수정 버전**을 여기에
// 못 박아, 락파일이나 package.json 이 취약 버전으로 되돌아가는 것을 막는다.
//
// 새 권고가 나오면 손으로 `npm audit` 을 돌려 이 표를 갱신한다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const readJson = (relative) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8'));

const lock = readJson('../package-lock.json');
const pkg = readJson('../package.json');

/**
 * 2026-09-04 `npm audit` 기준 권고와 그 수정 버전.
 * `minimum` 은 "이 버전 이상이면 해당 권고에서 벗어난다"는 값이다.
 */
const ADVISORIES = [
  { name: 'react-router', minimum: '7.18.2', why: 'GHSA-qwww-vcr4-c8h2 외 8건 (open redirect·CSRF·SSR RCE)' },
  { name: 'react-router-dom', minimum: '7.18.2', why: 'react-router 를 그대로 재수출한다' },
  { name: 'vite', minimum: '8.0.16', why: 'GHSA-fx2h-pf6j-xcff (dev server server.fs.deny 우회)' },
  { name: 'postcss', minimum: '8.5.23', why: 'GHSA-6g55-p6wh-862q 외 (sourceMappingURL 임의 파일 읽기)' },
  { name: 'nanoid', minimum: '3.3.18', why: 'GHSA — 음수/0 size 무한 루프' },
  { name: 'js-yaml', minimum: '4.3.1', why: 'GHSA-52cp-r559-cp3m 외 (merge key 2차 복잡도 DoS)' },
  { name: 'browserslist', minimum: '4.28.7', why: 'GHSA-c83g-rgw3-j3cx 외 (캐시 무한 증가·프로토타입 쓰기)' },
  { name: 'brace-expansion', minimum: '1.1.18', why: 'GHSA-rgw5-rvv9-x895 외 (확장 길이 무제한 DoS)' },
  { name: '@babel/core', minimum: '7.29.1', why: 'GHSA-4x5r-pxfx-6jf8 (sourceMappingURL 임의 파일 읽기)' },
  { name: '@humanfs/node', minimum: '0.16.8', why: 'GHSA-p498-v437-472g (심볼릭 링크 따라 복사)' },
];

/** `a` 가 `b` 이상이면 true. 프리릴리스는 이 표에 없으므로 릴리스 세 자리만 본다. */
function atLeast(a, b) {
  const parse = (v) => v.split('-')[0].split('.').map(Number);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i += 1) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return true;
}

/** 락파일에서 이 이름으로 설치되는 모든 버전 (중첩 설치 포함). */
function installedVersions(name) {
  return Object.entries(lock.packages)
    .filter(([path]) => path.endsWith(`node_modules/${name}`))
    .map(([, info]) => info.version)
    .filter(Boolean);
}

/** `^7.14.0` · `>=8.0.4` 같은 범위가 허용하는 가장 낮은 버전. */
function lowestAllowed(range) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(range);
  if (!match) throw new Error(`버전 범위를 읽지 못했습니다: ${range}`);
  return match.slice(1, 4).join('.');
}

describe('의존성 취약점 — 락파일이 권고 수정 버전 아래로 내려가지 않는다', () => {
  it.each(ADVISORIES)('$name 은 $minimum 이상이다 ($why)', ({ name, minimum }) => {
    const versions = installedVersions(name);
    expect(versions.length).toBeGreaterThan(0);
    for (const version of versions) {
      expect(atLeast(version, minimum), `${name}@${version} < ${minimum}`).toBe(true);
    }
  });
});

describe('의존성 취약점 — package.json 범위가 취약 버전을 허용하지 않는다', () => {
  // 락파일만 고치면 락파일 없는 설치(`npm install`)가 다시 취약 버전을 집을 수 있다.
  // 직접 의존성은 선언 범위의 하한 자체를 올려 둔다.
  const DIRECT = ADVISORIES.filter(({ name }) => pkg.dependencies?.[name] || pkg.devDependencies?.[name]);

  it('검사 대상 직접 의존성이 있다', () => {
    expect(DIRECT.map(({ name }) => name)).toEqual(['react-router-dom', 'vite']);
  });

  it.each(DIRECT)('$name 의 선언 범위 하한이 $minimum 이상이다', ({ name, minimum }) => {
    const range = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
    expect(atLeast(lowestAllowed(range), minimum), `${name} 범위 ${range}`).toBe(true);
  });
});
