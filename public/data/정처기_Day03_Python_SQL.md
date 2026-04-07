# Day 3 - Python 기초 + SQL 핵심

> **날짜**: 2026.04.07 (화) 19:00~22:00
> **목표**: Python 기출 패턴 마스터 + SQL SELECT/JOIN 완벽 정리
> **학습 후 체크**: [ ] 이론 이해  [ ] 기출 10문제+  [ ] 오답 정리

---

## PART 1: Python 자료형 핵심

### 1-1. 리스트 (List) — 가장 빈출!

```python
a = [1, 2, 3, 4, 5]
a.append(6)       # [1,2,3,4,5,6]  끝에 추가
a.insert(0, 0)    # [0,1,2,3,4,5,6]  위치에 삽입
a.pop()           # 6 반환, [0,1,2,3,4,5]
a.pop(0)          # 0 반환, [1,2,3,4,5]
a.remove(3)       # [1,2,4,5]  값으로 삭제 (첫번째만)
a.sort()          # 오름차순 정렬
a.reverse()       # 역순
```

### 1-2. 슬라이싱 — 반드시 암기!

```python
a = [0, 1, 2, 3, 4, 5]
#    0  1  2  3  4  5   ← 인덱스
#   -6 -5 -4 -3 -2 -1   ← 음수 인덱스

a[1:4]     # [1, 2, 3]        → end 미포함!
a[:3]      # [0, 1, 2]        → 처음~2
a[3:]      # [3, 4, 5]        → 3~끝
a[::2]     # [0, 2, 4]        → 2칸씩
a[::-1]    # [5, 4, 3, 2, 1, 0]  → 역순
```

> **시험 포인트**: `a[start:end]`에서 **end는 미포함**! `a[2:6]`은 인덱스 2,3,4,5

### 1-3. 문자열 슬라이싱 (기출 단골)

```python
s = "REMEMBER NOVEMBER"
#    0123456789...

s[:3]       # "REM"
s[12:16]    # "EMBE"
s[:3] + s[12:16]  # "REMEMBE"
```

### 1-4. 딕셔너리 (Dictionary)

```python
d = {"name": "Kim", "age": 25}
d["name"]           # "Kim"
d["score"] = 90     # 추가
d.keys()            # dict_keys(["name", "age", "score"])
d.values()          # dict_values(["Kim", 25, 90])
d.items()           # dict_items([("name","Kim"), ...])
```

### 1-5. 세트 (Set) — 기출 출제!

```python
a = {1, 2, 3}
a.add(4)          # {1, 2, 3, 4}
a.add(2)          # {1, 2, 3, 4}  ← 중복 무시!
a.remove(1)       # {2, 3, 4}
a.update({5, 6})  # {2, 3, 4, 5, 6}
a.discard(10)     # 없어도 에러 안남 (remove는 에러)
```

> **시험 포인트**: Set은 **중복 제거 + 순서 없음**. `print(set)` 순서는 시험에서 주어짐

### 1-6. 튜플 (Tuple)

```python
t = (1, 2, 3)
# t[0] = 10  ← TypeError! 수정 불가 (immutable)
a, b = 100, 200    # 튜플 언패킹
print(a == b)       # False
```

---

## PART 2: Python 핵심 문법

### 2-1. print() 서식

```python
print("a", "b", "c", sep="-")     # a-b-c
print("hello", end="")            # 줄바꿈 없음
print("a=", 20, "b=", 2)          # a= 20 b= 2

# 포맷팅
name = "STR"
print("R AND %s" % name)          # R AND STR
print(f"결과: {10+20}")            # 결과: 30
```

### 2-2. 비트 연산 (시험 필수!)

```python
a = 100
a >> 1    # 50   (100 ÷ 2)
a >> 2    # 25   (100 ÷ 4)
a << 1    # 200  (100 × 2)

# 기출 패턴
a = 100
result = 0
for i in range(1, 3):    # i = 1, 2
    result = a >> i       # i=1: 50, i=2: 25
    result = result + 1   # i=1: 51, i=2: 26
print(result)  # 26 ← 마지막 result만 출력!
```

> **핵심**: `>> n`은 `÷ 2^n`, `<< n`은 `× 2^n` (정수 나눗셈)

### 2-3. lambda, map, filter

```python
# lambda: 한 줄 함수
f = lambda x, y: x + y
print(f(10, 20))  # 30

# map: 각 요소에 함수 적용
lst = [1, 2, 3, 4, 5]
result = list(map(lambda x: x + 100, lst))
print(result)  # [101, 102, 103, 104, 105]

# filter: 조건 만족하는 것만
result = list(filter(lambda x: x % 2 == 0, lst))
print(result)  # [2, 4]
```

### 2-4. 리스트 컴프리헨션

```python
# 기본
[x * 2 for x in range(5)]        # [0, 2, 4, 6, 8]

# 조건부
[x for x in range(10) if x % 2 == 0]  # [0, 2, 4, 6, 8]
```

### 2-5. 클래스와 상속

```python
class Parent:
    def __init__(self, name):
        self.name = name
    def show(self):
        print(f"Parent: {self.name}")

class Child(Parent):
    def __init__(self, name, age):
        super().__init__(name)    # 부모 생성자 호출
        self.age = age
    def show(self):               # 오버라이딩
        print(f"Child: {self.name}, {self.age}")

c = Child("Kim", 20)
c.show()  # Child: Kim, 20
```

### 2-6. 함수 기본값 매개변수

```python
def exam(num1, num2=2):
    print('a=', num1, 'b=', num2)

exam(20)       # a= 20 b= 2
exam(20, 30)   # a= 20 b= 30
```

---

## PART 3: SQL 핵심 정리

### 3-1. SELECT 기본 구조

```sql
SELECT 컬럼1, 컬럼2
FROM 테이블명
WHERE 조건
GROUP BY 그룹컬럼
HAVING 그룹조건
ORDER BY 정렬컬럼 [ASC|DESC];
```

> **실행 순서**: FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY

### 3-2. WHERE 조건절

```sql
WHERE age >= 20
WHERE name = 'Kim'
WHERE age BETWEEN 20 AND 30        -- 20 이상 30 이하
WHERE name IN ('Kim', 'Lee')       -- 목록 중 하나
WHERE name LIKE '김%'              -- 김으로 시작
WHERE score IS NULL                -- NULL 체크 (= 쓰면 안됨!)
WHERE NOT (age > 30)
```

> **시험 함정**: `NULL`은 `= NULL`이 아니라 반드시 **`IS NULL`** 사용!

### 3-3. 집계 함수

| 함수 | 의미 | NULL 처리 |
|------|------|-----------|
| `COUNT(*)` | 전체 행 수 | NULL 포함 |
| `COUNT(컬럼)` | 해당 컬럼 값 있는 행 수 | NULL 제외 |
| `SUM(컬럼)` | 합계 | NULL 제외 |
| `AVG(컬럼)` | 평균 | NULL 제외 |
| `MAX(컬럼)` | 최대값 | NULL 제외 |
| `MIN(컬럼)` | 최소값 | NULL 제외 |

> **시험 포인트**: `COUNT(*)`는 NULL 포함, `COUNT(컬럼)`은 NULL 제외!

### 3-4. GROUP BY + HAVING

```sql
-- 부서별 평균 급여가 300만 이상인 부서
SELECT dept, AVG(salary) AS avg_sal
FROM employee
GROUP BY dept
HAVING AVG(salary) >= 3000000;
```

> **WHERE vs HAVING**: WHERE는 그룹 전 필터, HAVING은 그룹 후 필터!

### 3-5. JOIN (최빈출!)

**테이블 예시:**

| 학생 (student) | | | 성적 (grade) | | |
|---|---|---|---|---|---|
| id | name | dept | id | subject | score |
| 1 | Kim | CS | 1 | DB | 90 |
| 2 | Lee | EE | 1 | OS | 85 |
| 3 | Park | CS | 2 | DB | 70 |

```sql
-- INNER JOIN: 양쪽 다 있는 것만
SELECT s.name, g.subject, g.score
FROM student s
INNER JOIN grade g ON s.id = g.id;
-- Kim-DB-90, Kim-OS-85, Lee-DB-70 (Park 제외)

-- LEFT JOIN: 왼쪽 전부 + 오른쪽 매칭
SELECT s.name, g.subject
FROM student s
LEFT JOIN grade g ON s.id = g.id;
-- Kim-DB, Kim-OS, Lee-DB, Park-NULL
```

| JOIN 종류 | 설명 |
|-----------|------|
| `INNER JOIN` | 양쪽 모두 일치하는 행만 |
| `LEFT JOIN` | 왼쪽 테이블 전체 + 오른쪽 매칭 |
| `RIGHT JOIN` | 오른쪽 테이블 전체 + 왼쪽 매칭 |
| `FULL OUTER JOIN` | 양쪽 전체 (일치 없으면 NULL) |
| `CROSS JOIN` | 모든 조합 (카티션 곱) |

### 3-6. 서브쿼리

```sql
-- 평균 급여보다 많은 사원
SELECT name, salary
FROM employee
WHERE salary > (SELECT AVG(salary) FROM employee);

-- IN 서브쿼리
SELECT name FROM student
WHERE dept IN (SELECT dept FROM student WHERE name = 'Kim');
```

### 3-7. DDL / DML / DCL 구분

| 분류 | 명령어 | 설명 |
|------|--------|------|
| **DDL** | CREATE, ALTER, DROP, TRUNCATE | 구조 정의 |
| **DML** | SELECT, INSERT, UPDATE, DELETE | 데이터 조작 |
| **DCL** | GRANT, REVOKE | 권한 부여/회수 |
| **TCL** | COMMIT, ROLLBACK, SAVEPOINT | 트랜잭션 제어 |

### 3-8. DML 기본 문법

```sql
-- INSERT
INSERT INTO student(id, name, dept) VALUES(4, 'Choi', 'ME');

-- UPDATE
UPDATE student SET dept = 'CS' WHERE name = 'Choi';

-- DELETE
DELETE FROM student WHERE id = 4;
```

> **시험 함정**: `DELETE` vs `TRUNCATE` vs `DROP`
> - `DELETE`: 행 삭제 (롤백 가능, WHERE 가능)
> - `TRUNCATE`: 전체 삭제 (롤백 불가, 구조 유지)
> - `DROP`: 테이블 자체 삭제

---

## PART 4: SQL 심화 — 기출 빈출 패턴

### 4-1. DISTINCT

```sql
SELECT DISTINCT dept FROM student;  -- 중복 제거
```

### 4-2. ORDER BY

```sql
SELECT * FROM student ORDER BY score DESC;           -- 내림차순
SELECT * FROM student ORDER BY dept ASC, score DESC;  -- 복합 정렬
```

### 4-3. 별칭 (Alias)

```sql
SELECT name AS 이름, score AS 점수 FROM student;
SELECT s.name FROM student s;  -- 테이블 별칭
```

### 4-4. LIKE 패턴

| 패턴 | 의미 |
|------|------|
| `LIKE '김%'` | 김으로 시작 |
| `LIKE '%김'` | 김으로 끝남 |
| `LIKE '%김%'` | 김 포함 |
| `LIKE '김_'` | 김 + 한 글자 |
| `LIKE '__김'` | 두 글자 + 김 |

> `%` = 0개 이상 문자, `_` = 정확히 1개 문자

### 4-5. WINDOW 함수 (최신 기출)

```sql
SELECT name, dept, salary,
       RANK() OVER (PARTITION BY dept ORDER BY salary DESC) AS rank
FROM employee;
```

| 함수 | 설명 |
|------|------|
| `RANK()` | 순위 (동순위 시 건너뜀: 1,2,2,4) |
| `DENSE_RANK()` | 순위 (동순위 시 안건너뜀: 1,2,2,3) |
| `ROW_NUMBER()` | 행 번호 (동순위 없음: 1,2,3,4) |

---

## PART 5: 기출 코드 트레이싱 (직접 풀어보기!)

---

### 문제 1 (Python - Set 연산) ★★★ [2020년 2회]

```python
a = {'한국', '중국', '일본'}
a.add('베트남')
a.add('중국')
a.remove('일본')
a.update({'홍콩', '한국', '태국'})
print(a)
```

**트레이싱:**
```
초기: {'한국', '중국', '일본'}
add('베트남') → {___}
add('중국')  → {___}  ← 중복이므로?
remove('일본') → {___}
update({'홍콩','한국','태국'}) → {___}

출력: ___
```

---

### 문제 2 (Python - 2차원 리스트) ★★★★ [2020년 4회]

```python
lol = [[1,2,3],[4,5],[6,7,8,9]]
print(lol[0])
print(lol[2][1])
for sub in lol:
    for item in sub:
        print(item, end='')
    print()
```

**트레이싱:**
```
lol[0] = ___
lol[2][1] = lol[2]는 ___, [1]은 ___

중첩 for:
sub=[1,2,3] → 출력: ___
sub=[4,5]   → 출력: ___
sub=[6,7,8,9] → 출력: ___

전체 출력:
___
```

---

### 문제 3 (Python - 클래스 + 문자열) ★★★★ [2021년 1회]

```python
class good:
    li = ["Seoul", "Kyeonggi", "Inchon", "Daejeon", "Daegu", "Pusan"]

g = good()
str01 = ''
for i in g.li:
    str01 = str01 + i[0]
print(str01)
```

**트레이싱:**
```
i="Seoul"    → i[0]=___, str01="___"
i="Kyeonggi" → i[0]=___, str01="___"
i="Inchon"   → i[0]=___, str01="___"
i="Daejeon"  → i[0]=___, str01="___"
i="Daegu"    → i[0]=___, str01="___"
i="Pusan"    → i[0]=___, str01="___"

출력: ___
```

---

### 문제 4 (Python - 비트 시프트) ★★★★ [2021년 2회]

```python
a = 100
result = 0
for i in range(1, 3):
    result = a >> i
    result = result + 1
print(result)
```

**트레이싱:**
```
range(1,3) → i = ___, ___

i=1: result = 100 >> 1 = ___
     result = ___ + 1 = ___

i=2: result = 100 >> 2 = ___
     result = ___ + 1 = ___

출력: ___ (주의: a는 변하지 않음!)
```

---

### 문제 5 (Python - lambda + map) ★★★★ [2022년 3회]

```python
TestList = [1, 2, 3, 4, 5]
TestList = list(map(lambda num: num + 100, TestList))
print(TestList)
```

**나의 답:** ___________________________

---

### 문제 6 (Python - 문자열 슬라이싱) ★★★★ [2022년 2회]

```python
a = "REMEMBER NOVEMBER"
b = a[:3] + a[12:16]
c = "R AND %s" % "STR"
print(b + c)
```

**트레이싱:**
```
인덱스: R(0) E(1) M(2) E(3) M(4) B(5) E(6) R(7) (8) N(9) O(10) V(11) E(12) M(13) B(14) E(15) R(16)

a[:3]    = ___
a[12:16] = ___  (12,13,14,15번 인덱스)
b = ___

c = "R AND %s" % "STR" = ___

b + c = ___

출력: ___
```

---

### 문제 7 (Python - 함수 기본값) ★★★ [2022년 1회]

```python
def exam(num1, num2=2):
    print('a=', num1, 'b=', num2)
exam(20)
```

**나의 답:** ___________________________

---

### 문제 8 (SQL - GROUP BY + HAVING) ★★★★★

**테이블: 성적 (grade)**

| name | subject | score |
|------|---------|-------|
| Kim  | DB      | 90    |
| Kim  | OS      | 80    |
| Lee  | DB      | 70    |
| Lee  | OS      | 90    |
| Park | DB      | 60    |
| Park | OS      | 50    |

```sql
SELECT name, AVG(score) AS avg_score
FROM grade
GROUP BY name
HAVING AVG(score) >= 75
ORDER BY avg_score DESC;
```

**트레이싱:**
```
GROUP BY name:
  Kim: (90+80)/2 = ___
  Lee: (70+90)/2 = ___
  Park: (60+50)/2 = ___

HAVING AVG(score) >= 75:
  ___, ___ 통과 / ___ 탈락

ORDER BY avg_score DESC:
  1. ___
  2. ___

결과:
| name | avg_score |
|------|-----------|
| ___  | ___       |
| ___  | ___       |
```

---

### 문제 9 (SQL - JOIN) ★★★★★

**테이블: 학생 (student)**

| id | name |
|----|------|
| 1  | Kim  |
| 2  | Lee  |
| 3  | Park |

**테이블: 수강 (enroll)**

| id | course |
|----|--------|
| 1  | DB     |
| 1  | OS     |
| 4  | NET    |

```sql
SELECT s.name, e.course
FROM student s
LEFT JOIN enroll e ON s.id = e.id;
```

**트레이싱:**
```
LEFT JOIN이므로 student(왼쪽) 전체 유지

id=1 매칭: s.name=___, e.course=___
id=1 매칭: s.name=___, e.course=___
id=2 매칭없음: s.name=___, e.course=___
id=3 매칭없음: s.name=___, e.course=___
(id=4는? student에 없으므로 ___)

결과:
| name | course |
|------|--------|
| ___  | ___    |
| ___  | ___    |
| ___  | ___    |
| ___  | ___    |
```

---

### 문제 10 (SQL - 서브쿼리 + COUNT) ★★★★★

**테이블: 사원 (employee)**

| id | name | dept  | salary |
|----|------|-------|--------|
| 1  | Kim  | Sales | 3000   |
| 2  | Lee  | Dev   | 4000   |
| 3  | Park | Sales | 3500   |
| 4  | Choi | Dev   | 5000   |
| 5  | Jung | HR    | 2500   |

```sql
SELECT dept, COUNT(*) AS cnt
FROM employee
WHERE salary > (SELECT AVG(salary) FROM employee)
GROUP BY dept
ORDER BY cnt DESC;
```

**트레이싱:**
```
서브쿼리: AVG(salary) = (3000+4000+3500+5000+2500)/5 = ___

WHERE salary > ___:
  Kim(3000): ___
  Lee(4000): ___
  Park(3500): ___
  Choi(5000): ___
  Jung(2500): ___

→ 통과하는 행: ___

GROUP BY dept + COUNT(*):
| dept  | cnt |
|-------|-----|
| ___   | ___ |
| ___   | ___ |

ORDER BY cnt DESC:

결과:
| dept  | cnt |
|-------|-----|
| ___   | ___ |
| ___   | ___ |
```

---

## PART 6: 정답 & 해설

<details>

### 문제 1 정답: `{'한국', '중국', '베트남', '홍콩', '태국'}`
- `add('중국')` → 이미 있으므로 무시
- `remove('일본')` → 삭제
- `update()` → 합집합 (중복 제거)
- Set은 순서 없음. 시험에서는 순서가 주어짐

### 문제 2 정답:
```
[1, 2, 3]
7
123
45
6789
```
- `lol[2][1]` = `[6,7,8,9][1]` = `7`
- `end=''`으로 같은 줄, `print()`로 줄바꿈

### 문제 3 정답: `SKIDDP`
- 각 문자열의 첫 글자(`[0]`)를 이어붙임
- S + K + I + D + D + P

### 문제 4 정답: `26`
- `100 >> 1` = 50, +1 = 51 (하지만 다음 루프에서 덮어씌워짐)
- `100 >> 2` = 25, +1 = **26**
- **주의**: `a`는 100 그대로! `result`만 바뀜

### 문제 5 정답: `[101, 102, 103, 104, 105]`
- `map(lambda)`: 각 요소에 +100 적용
- `list()`로 리스트 변환

### 문제 6 정답: `REMEMBER AND STR`
- `a[:3]` = "REM"
- `a[12:16]` = "EMBE"
- `b` = "REMEMBE"
- `c` = "R AND STR"
- `b + c` = "REMEMBER AND STR"

### 문제 7 정답: `a= 20 b= 2`
- `num2=2`는 기본값. `exam(20)`은 num1=20, num2=2
- `print()`의 기본 sep은 공백

### 문제 8 정답:

| name | avg_score |
|------|-----------|
| Kim  | 85        |
| Lee  | 80        |

- Kim: 85, Lee: 80, Park: 55
- HAVING >= 75: Kim, Lee만 통과
- DESC 정렬: Kim(85) → Lee(80)

### 문제 9 정답:

| name | course |
|------|--------|
| Kim  | DB     |
| Kim  | OS     |
| Lee  | NULL   |
| Park | NULL   |

- LEFT JOIN: 왼쪽(student) 전체 유지
- id=4(NET)는 student에 없으므로 결과에 안나옴

### 문제 10 정답:

| dept | cnt |
|------|-----|
| Dev  | 2   |

- AVG(salary) = (3000+4000+3500+5000+2500)/5 = **3600**
- salary > 3600 통과: Lee(Dev, 4000), Choi(Dev, 5000) → 2명
- salary > 3600 탈락: Kim(3000), Park(3500), Jung(2500)
- GROUP BY dept: Dev → 2명
- 결과: Dev 부서 1개만 출력

</details>

---

## PART 7: Python vs Java vs C 비교 (시험 함정 방지)

| 개념 | Python | Java | C |
|------|--------|------|---|
| 배열 인덱스 | `a[0]` | `a[0]` | `a[0]` |
| 문자열 길이 | `len(s)` | `s.length()` | `strlen(s)` |
| 출력 | `print()` | `System.out.println()` | `printf()` |
| 줄바꿈 방지 | `end=''` | `print()` | 없음 |
| 클래스 상속 | `class C(P):` | `class C extends P` | 없음 |
| 정수 나눗셈 | `//` | `/` (int끼리) | `/` (int끼리) |
| 논리 연산 | `and, or, not` | `&&, \|\|, !` | `&&, \|\|, !` |

---

## Day 3 학습 완료 체크리스트

- [ ] PART 1~2 Python 이론 읽기 완료
- [ ] PART 3~4 SQL 이론 읽기 완료
- [ ] PART 5 문제 10개 종이에 직접 풀기
- [ ] 틀린 문제 해설 확인 + 오답 원인 메모
- [ ] 핵심 암기: 슬라이싱 `[start:end]` end 미포함
- [ ] 핵심 암기: `>> n` = `÷ 2^n`
- [ ] 핵심 암기: Set 중복 제거 + 순서 없음
- [ ] 핵심 암기: JOIN 종류 (INNER, LEFT, RIGHT, FULL)
- [ ] 핵심 암기: WHERE vs HAVING 차이
- [ ] 핵심 암기: COUNT(*) vs COUNT(컬럼) NULL 처리

---

> **내일 Day 4 예고**: SQL 심화 (DDL/DML/DCL, 프로시저/트리거) + 알고리즘 기초 (정렬, 탐색)
>
> **참고 링크**:
> - [Velog Python 문법 정리](https://velog.io/@kya754/%EC%A0%95%EB%B3%B4%EC%B2%98%EB%A6%AC%EA%B8%B0%EC%82%AC-%EC%8B%A4%EA%B8%B0-%EB%8C%80%EB%B9%84-%ED%8C%8C%EC%9D%B4%EC%8D%AC-%EB%AC%B8%EB%B2%95-%EC%A0%95%EB%A6%AC)
> - [시나공 기출](https://www.sinagong.co.kr/pds/001001002/past-exams)
> - [뉴비티 CBT](https://newbt.kr/시험/정보처리기사%20실기)
> - [에듀온 기출복원](https://eduon.com/info/information/info_previous_test/?oa=%EA%B8%B0%EC%82%AC&ob=%EC%8B%A4%EA%B8%B0)
