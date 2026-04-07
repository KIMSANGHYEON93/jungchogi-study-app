# Day 12 - 최종 정리 (전 범위 핵심 요약 1장)

> **날짜**: 2026.04.16 (목) 19:00~22:00
> **목표**: 시험 전 범위를 1장으로 압축 → 반복 읽기용 최종본
> **학습 후 체크**: [ ] 전체 3회 읽기  [ ] 빈칸 채우기 연습  [ ] 암기 완료

---

## A. 코드 트레이싱 핵심 규칙

### C언어

```
포인터: *p+2 = (*p)+2 (값+2), *(p+2) = 주소 이동 후 역참조
증감:   a++ = 사용 후 증가, ++a = 증가 후 사용
배열:   int a[5]={1}; → a[0]=1, 나머지=0
구조체: s.멤버 (직접), p->멤버 (포인터)
스코프: 내부 블록 변수 = 외부와 별개
swap:   값 전달 = 안 바뀜, 주소 전달(*) = 바뀜
재귀:   종료 조건 확인 → 역추적 계산
```

### Java

```
다형성:   Parent obj = new Child();
          → 메서드 = 자식(오버라이딩), 변수 = 부모
생성자:   this() / super() 중 하나만, 반드시 첫 줄
          super() 없으면 암묵적 삽입
static:   모든 객체 공유, static에서 인스턴스 접근 불가
싱글톤:   private 생성자 + static getInstance()
String:   == 참조 비교, equals() 값 비교
          substring(s,e) → e 미포함
추상:     abstract class = extends / interface = implements
```

### Python

```
슬라이싱: a[s:e] → e 미포함, a[::n] = n칸씩
Set:      중복X 순서X, add/remove/update, & | -
비트:     >>n = /2^n, <<n = *2^n
lambda:   lambda x: x+1 = 한줄 함수
map:      list(map(함수, 리스트)) = 각 요소에 적용
filter:   조건 만족 요소만 추출
elif:     else if → 첫 조건 만족하면 나머지 스킵
print:    sep=구분자, end=끝문자(기본 줄바꿈)
클래스:   class B(A): → A 상속, super().__init__()
```

### SQL

```
실행순서: FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY
WHERE:    그룹 전 필터 (집계함수 X)
HAVING:   그룹 후 필터 (집계함수 O)
COUNT(*): NULL 포함 / COUNT(컬럼): NULL 제외
JOIN:     INNER = 양쪽 일치만
          LEFT = 왼쪽 전체 + 오른쪽 매칭(없으면 NULL)
IS NULL:  = NULL (X) → IS NULL (O)
```

---

## B. SQL 문법 총정리

```sql
-- DDL
CREATE TABLE t (id INT PRIMARY KEY, name VARCHAR(20) NOT NULL);
ALTER TABLE t ADD col TYPE;
ALTER TABLE t MODIFY col TYPE;
ALTER TABLE t DROP COLUMN col;
DROP TABLE t [CASCADE|RESTRICT];
TRUNCATE TABLE t;   -- 구조유지+전체삭제+롤백불가

-- DML
INSERT INTO t(col1,col2) VALUES(v1,v2);
UPDATE t SET col=val WHERE 조건;
DELETE FROM t WHERE 조건;

-- DCL
GRANT 권한 ON 테이블 TO 사용자 [WITH GRANT OPTION];
REVOKE 권한 ON 테이블 FROM 사용자 [CASCADE];

-- TCL
COMMIT; ROLLBACK; SAVEPOINT sp1; ROLLBACK TO sp1;
```

**DELETE vs TRUNCATE vs DROP:**
| | DELETE | TRUNCATE | DROP |
|--|--------|----------|------|
| 분류 | DML | DDL | DDL |
| 구조 | 유지 | 유지 | 삭제 |
| 롤백 | O | X | X |
| WHERE | O | X | X |

---

## C. 이론 암기법 전체 모음

```
요구사항 개발:     도분명확 (도출→분석→명세→확인)
형상관리 절차:     식통감기 (식별→통제→감사→기록)
럼바우 모델링:     객동기 (객체→동적→기능)
  객체=객체다이어그램, 동적=상태다이어그램, 기능=DFD
테스트 단계:       단통시인 (단위→통합→시스템→인수)
통합 테스트:       하향식=스텁(Stub), 상향식=드라이버(Driver)
테스트 오라클:     참샘휴일 (참/샘플링/휴리스틱/일관성검사)
커버리지 (약→강):  구결조 조결변 다
정규화:            도부이결다조
  1NF=원자값, 2NF=부분종속제거, 3NF=이행종속제거, BCNF=결정자
결합도 (좋→나):    자스제외공내
응집도 (나→좋):    우논시절통순기
교착상태 조건:     상점비환 (상호배제/점유대기/비선점/환형대기)
OSI 7계층 (↓):    물데네전세표응
ISO 9126 품질:    기신사효유이
CMMI 5단계:       초관정정최
XP 5가치:         용단의피존
SOLID:            단일/개방폐쇄/리스코프/인터페이스분리/의존역전
보안 3요소:       CIA (기밀성/무결성/가용성)
```

---

## D. 디자인 패턴 요약

```
생성(5) 빌프팩앱싱:
  Singleton=유일인스턴스, Factory Method=하위에서생성결정
  Builder=단계별생성, Prototype=복제, Abstract Factory=객체군

구조(7) 어데퍼브플컴프:
  Adapter=변환, Decorator=동적기능추가, Facade=단순인터페이스
  Bridge=추상/구현분리, Proxy=대리접근, Composite=트리구조
  Flyweight=공유메모리절감

행위(11) 핵심만:
  Observer=상태변화알림, Strategy=알고리즘교체
  Template Method=골격정의, Command=요청객체화
  State=내부상태→행위변경, Iterator=순차접근
  Memento=상태저장복구(Undo)
```

---

## E. UML 요약

```
구조(정적) 6개: 클래스/객체/컴포넌트/배치/패키지/복합체
행위(동적) 6개: 유스케이스/시퀀스/커뮤니케이션/활동/상태/타이밍

관계 6가지:
  연관(─) 집합(◇) 합성(◆) 의존(-->) 일반화(▷) 실체화(-▷)
  집합=독립존재, 합성=종속

유스케이스: include=필수, extend=선택
클래스 접근제어: + public, - private, # protected, ~ package
```

---

## F. 보안/네트워크 요약

```
대칭키: AES, DES, 3DES, SEED, ARIA (같은 키로 암복호화)
비대칭키: RSA, ECC, DSA (공개키+개인키 쌍)
해시: MD5, SHA-1, SHA-256 (일방향, 복호화 불가)

공격: DDoS=분산공격, SQL Injection=SQL삽입, XSS=스크립트삽입
      스니핑=엿봄, 스푸핑=위조, 랜섬웨어=암호화+금전요구
      APT=지속적맞춤형, 제로데이=패치전취약점

솔루션: IDS=탐지, IPS=탐지+차단, WAF=웹방화벽, VPN=암호화터널
접근제어: DAC=임의, MAC=강제, RBAC=역할기반

OSI: 물리(허브)-데이터링크(스위치,MAC)-네트워크(라우터,IP)
     -전송(TCP/UDP)-세션-표현-응용(HTTP,FTP,DNS)
```

---

## G. 알고리즘 요약

```
정렬:
  버블=인접비교교환, 선택=최소값찾아교환, 삽입=정렬부분에삽입
  안정정렬=버삽병(버블/삽입/병합)
  O(n²)=버블/선택/삽입, O(nlogn)=퀵/병합/힙

탐색:
  이진탐색=정렬된 배열, mid=(low+high)/2
  해시=h(k)=k%n, 충돌→체이닝/선형탐사

트리순회:
  전위=VLR(루트먼저), 중위=LVR(루트중간), 후위=LRV(루트나중)
```

---

## Day 12 학습 완료 체크리스트

- [ ] A~G 전체 1회 정독
- [ ] 암기법 빈칸 채워보기 연습
- [ ] 2회 반복 읽기
- [ ] 자신 없는 부분 별도 표시
- [ ] 표시한 부분 해당 Day 자료 재확인

---

> **내일 Day 13 예고**: 시험 전날 마무리 (최빈출 문제 + 직전 암기)
