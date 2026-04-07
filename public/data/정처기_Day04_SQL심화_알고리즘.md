# Day 4 - SQL 심화 + 알고리즘 기초

> **날짜**: 2026.04.08 (수) 19:00~22:00
> **목표**: DDL/DCL 완벽 암기 + 절차형 SQL 구문 + 정렬/탐색 알고리즘 트레이싱
> **학습 후 체크**: [ ] 이론 이해  [ ] 기출 10문제+  [ ] 오답 정리

---

## PART 1: DDL (Data Definition Language) 심화

### 1-1. CREATE TABLE

```sql
CREATE TABLE 학생 (
    학번 VARCHAR(10) PRIMARY KEY,
    이름 VARCHAR(20) NOT NULL,
    학과 VARCHAR(20),
    성별 CHAR(1) CHECK (성별 IN ('M', 'F')),
    나이 INT DEFAULT 20,
    FOREIGN KEY (학과) REFERENCES 학과테이블(학과코드)
        ON DELETE CASCADE
        ON UPDATE SET NULL
);
```

**제약 조건 정리:**

| 제약 조건 | 설명 |
|-----------|------|
| `PRIMARY KEY` | 기본키, NOT NULL + UNIQUE |
| `FOREIGN KEY` | 외래키, 다른 테이블 참조 |
| `UNIQUE` | 중복 불가 (NULL은 허용) |
| `NOT NULL` | NULL 불가 |
| `CHECK` | 조건 검사 |
| `DEFAULT` | 기본값 설정 |

> **시험 포인트**: `PRIMARY KEY` = `NOT NULL` + `UNIQUE` 자동 포함!

### 1-2. ALTER TABLE

```sql
-- 컬럼 추가
ALTER TABLE 학생 ADD 전화번호 VARCHAR(15);

-- 컬럼 수정
ALTER TABLE 학생 MODIFY 이름 VARCHAR(30);

-- 컬럼 삭제
ALTER TABLE 학생 DROP COLUMN 전화번호;

-- 제약 조건 추가
ALTER TABLE 학생 ADD CONSTRAINT pk_학번 PRIMARY KEY(학번);
```

> **암기**: ADD(추가), MODIFY(수정), DROP(삭제)

### 1-3. DROP vs TRUNCATE vs DELETE

| 명령어 | 분류 | 구조 | 데이터 | 롤백 | WHERE |
|--------|------|------|--------|------|-------|
| `DROP TABLE` | DDL | 삭제 | 삭제 | 불가 | X |
| `TRUNCATE TABLE` | DDL | 유지 | 전체삭제 | 불가 | X |
| `DELETE FROM` | DML | 유지 | 조건삭제 | 가능 | O |

> **시험 단골**: "테이블 구조는 유지하면서 모든 데이터를 삭제" → `TRUNCATE`

### 1-4. CASCADE vs RESTRICT

```sql
DROP TABLE 학생 CASCADE;   -- 참조하는 다른 테이블도 연쇄 삭제
DROP TABLE 학생 RESTRICT;  -- 참조되고 있으면 삭제 거부
```

**외래키 옵션:**

| 옵션 | ON DELETE 시 동작 |
|------|-------------------|
| `CASCADE` | 참조 행도 함께 삭제 |
| `SET NULL` | 참조 컬럼을 NULL로 설정 |
| `SET DEFAULT` | 기본값으로 설정 |
| `RESTRICT` | 삭제 거부 (자식 있으면 불가) |
| `NO ACTION` | 아무 조치 안함 (RESTRICT와 유사) |

---

## PART 2: DCL (Data Control Language) + TCL

### 2-1. GRANT / REVOKE

```sql
-- 권한 부여
GRANT SELECT, INSERT ON 학생 TO user1;
GRANT ALL ON 학생 TO user1 WITH GRANT OPTION;

-- 권한 회수
REVOKE SELECT ON 학생 FROM user1;
REVOKE ALL ON 학생 FROM user1 CASCADE;
```

| 옵션 | 설명 |
|------|------|
| `WITH GRANT OPTION` | 받은 권한을 다른 사용자에게 부여 가능 (GRANT) |
| `CASCADE` | 연쇄 회수 — 해당 사용자가 부여한 권한도 함께 회수 (REVOKE) |

> **시험 포인트**: `WITH GRANT OPTION` → 권한의 위임 가능!

### 2-2. TCL (Transaction Control Language)

```sql
BEGIN TRANSACTION;
  UPDATE 계좌 SET 잔액 = 잔액 - 10000 WHERE 이름 = 'Kim';
  UPDATE 계좌 SET 잔액 = 잔액 + 10000 WHERE 이름 = 'Lee';
  SAVEPOINT sp1;
  DELETE FROM 로그 WHERE 일자 < '2025-01-01';
  ROLLBACK TO sp1;    -- DELETE만 취소
COMMIT;               -- UPDATE 2건 확정
```

### 2-3. ACID 특성 (매회 1문제 수준!)

| 특성 | 영어 | 설명 | 암기법 |
|------|------|------|--------|
| **원자성** | Atomicity | All or Nothing (전부 성공 or 전부 실패) | 원자 = 쪼갤 수 없음 |
| **일관성** | Consistency | 트랜잭션 전후 DB 상태 일관 | 일관되게 유지 |
| **격리성** | Isolation | 동시 실행 시 서로 간섭 없음 | 격리 = 분리 |
| **영속성** | Durability | 완료된 결과는 영구 보존 | 영구히 저장 |

---

## PART 3: 절차형 SQL (프로시저, 트리거, 함수)

### 3-1. 프로시저 (Procedure)

```sql
CREATE OR REPLACE PROCEDURE update_salary
(p_id IN INT, p_raise IN INT)
IS
    v_salary INT;
BEGIN
    SELECT salary INTO v_salary FROM employee WHERE id = p_id;
    UPDATE employee SET salary = v_salary + p_raise WHERE id = p_id;
    COMMIT;
END;

-- 호출
EXECUTE update_salary(1, 500);
```

**매개변수 모드:**

| 모드 | 방향 | 설명 |
|------|------|------|
| `IN` | 입력 | 값을 전달받음 (기본값) |
| `OUT` | 출력 | 결과를 반환 |
| `INOUT` | 양방향 | 입력 + 출력 |

### 3-2. 사용자 정의 함수 (Function)

```sql
CREATE OR REPLACE FUNCTION get_bonus(p_salary IN INT)
RETURN INT
IS
    v_bonus INT;
BEGIN
    v_bonus := p_salary * 0.1;
    RETURN v_bonus;
END;
```

> **프로시저 vs 함수 차이**: 함수는 `RETURN`이 **필수!**

| 구분 | 프로시저 | 함수 |
|------|----------|------|
| 반환 | OUT 파라미터 (선택) | RETURN **필수** |
| 호출 | `EXECUTE` | SQL문 내에서 호출 가능 |
| 용도 | DML 수행 (INSERT/UPDATE/DELETE) | 값 계산/반환 |

### 3-3. 트리거 (Trigger)

```sql
CREATE OR REPLACE TRIGGER log_salary_change
AFTER UPDATE ON employee
FOR EACH ROW
BEGIN
    INSERT INTO salary_log(emp_id, old_sal, new_sal, change_date)
    VALUES(:OLD.id, :OLD.salary, :NEW.salary, SYSDATE);
END;
```

**핵심 키워드:**

| 키워드 | 설명 |
|--------|------|
| `BEFORE / AFTER` | 이벤트 전/후 실행 |
| `INSERT / UPDATE / DELETE` | 트리거 발동 이벤트 |
| `FOR EACH ROW` | 행 단위 실행 (생략 시 문장 단위) |
| `:OLD` | 변경 전 값 |
| `:NEW` | 변경 후 값 |

> **시험 포인트**: 트리거는 자동 실행! EXECUTE 불필요. COMMIT/ROLLBACK 불가!

### 3-4. 절차형 SQL 공통 구조

```
DECLARE  (선언부)  — 변수, 상수 선언
BEGIN    (실행부)  — SQL문, 제어문
EXCEPTION(예외부) — 오류 처리
END;
```

> **암기**: **디비엔** (DECLARE-BEGIN-END)

---

## PART 4: 정렬 알고리즘

### 4-1. 버블 정렬 (Bubble Sort)

**원리**: 인접한 두 요소를 비교하여 교환, 한 라운드마다 가장 큰 값이 끝으로 이동

```
초기: [5, 3, 8, 1, 2]

1라운드:
  (5,3) → 교환 → [3, 5, 8, 1, 2]
  (5,8) → 유지 → [3, 5, 8, 1, 2]
  (8,1) → 교환 → [3, 5, 1, 8, 2]
  (8,2) → 교환 → [3, 5, 1, 2, 8]  ← 8 확정

2라운드:
  (3,5) → 유지 → [3, 5, 1, 2, 8]
  (5,1) → 교환 → [3, 1, 5, 2, 8]
  (5,2) → 교환 → [3, 1, 2, 5, 8]  ← 5 확정

3라운드:
  (3,1) → 교환 → [1, 3, 2, 5, 8]
  (3,2) → 교환 → [1, 2, 3, 5, 8]  ← 3 확정

완료: [1, 2, 3, 5, 8]
```

```java
// Java 코드 (기출 패턴)
for (int i = 0; i < n-1; i++) {
    for (int j = 0; j < n-1-i; j++) {
        if (a[j] > a[j+1]) {
            int temp = a[j];
            a[j] = a[j+1];
            a[j+1] = temp;
        }
    }
}
```

### 4-2. 선택 정렬 (Selection Sort)

**원리**: 최소값을 찾아서 맨 앞과 교환

```
초기: [5, 3, 8, 1, 2]

1라운드: 최소=1(idx 3) → [1, 3, 8, 5, 2]
2라운드: 최소=2(idx 4) → [1, 2, 8, 5, 3]
3라운드: 최소=3(idx 4) → [1, 2, 3, 5, 8]
4라운드: 최소=5(idx 3) → [1, 2, 3, 5, 8]

완료: [1, 2, 3, 5, 8]
```

```java
for (int i = 0; i < n-1; i++) {
    int minIdx = i;
    for (int j = i+1; j < n; j++) {
        if (a[j] < a[minIdx]) minIdx = j;
    }
    int temp = a[i];
    a[i] = a[minIdx];
    a[minIdx] = temp;
}
```

### 4-3. 삽입 정렬 (Insertion Sort)

**원리**: 정렬된 부분에 새 요소를 올바른 위치에 삽입

```
초기: [5, 3, 8, 1, 2]

i=1: key=3, [5]에서 5>3 → 뒤로 밀기 → [3, 5, 8, 1, 2]
i=2: key=8, [3,5]에서 8>5 → 제자리 → [3, 5, 8, 1, 2]
i=3: key=1, [3,5,8]에서 모두 밀기 → [1, 3, 5, 8, 2]
i=4: key=2, [1,3,5,8]에서 3,5,8 밀기 → [1, 2, 3, 5, 8]

완료: [1, 2, 3, 5, 8]
```

```java
for (int i = 1; i < n; i++) {
    int key = a[i];
    int j = i - 1;
    while (j >= 0 && a[j] > key) {
        a[j+1] = a[j];
        j--;
    }
    a[j+1] = key;
}
```

### 4-4. 정렬 알고리즘 비교

| 정렬 | 시간복잡도 (평균/최악) | 공간 | 안정성 | 특징 |
|------|----------------------|------|--------|------|
| 버블 | O(n²) / O(n²) | O(1) | 안정 | 인접 요소 교환 |
| 선택 | O(n²) / O(n²) | O(1) | 불안정 | 최소값 선택 |
| 삽입 | O(n²) / O(n²) | O(1) | 안정 | 정렬된 곳에 삽입 |
| 퀵 | O(n log n) / O(n²) | O(log n) | 불안정 | 분할 정복, 피벗 기준 |
| 병합 | O(n log n) / O(n log n) | O(n) | 안정 | 분할 정복, 합치기 |
| 힙 | O(n log n) / O(n log n) | O(1) | 불안정 | 힙 자료구조 이용 |

> **시험 암기**: 안정 정렬 = **버삽병** (버블, 삽입, 병합)

---

## PART 5: 탐색 알고리즘 + 트리 순회

### 5-1. 이진 탐색 (Binary Search)

**조건**: 정렬된 배열에서만 사용 가능!

```
배열: [2, 5, 8, 12, 16, 23, 38, 56, 72]
찾기: 23

1단계: low=0, high=8, mid=4 → a[4]=16 < 23 → low=5
2단계: low=5, high=8, mid=6 → a[6]=38 > 23 → high=5
3단계: low=5, high=5, mid=5 → a[5]=23 = 23 → 찾음!
```

```java
int binarySearch(int[] a, int key) {
    int low = 0, high = a.length - 1;
    while (low <= high) {
        int mid = (low + high) / 2;
        if (a[mid] == key) return mid;
        else if (a[mid] < key) low = mid + 1;
        else high = mid - 1;
    }
    return -1;  // 못 찾음
}
```

### 5-2. 해시 (Hash)

```
해시 함수 h(k) = k % 7

key: 8, 1, 9, 6, 13
h(8)=1, h(1)=1 → 충돌!, h(9)=2, h(6)=6, h(13)=6 → 충돌!

해시 테이블:
[0]:
[1]: 8 → 1  (체이닝)
[2]: 9
[3]:
[4]:
[5]:
[6]: 6 → 13 (체이닝)
```

**충돌 해결:**

| 방법 | 설명 |
|------|------|
| 체이닝 (Chaining) | 같은 주소에 연결 리스트로 연결 |
| 선형 탐사 (Linear Probing) | 다음 빈 자리 찾기 (h+1, h+2, ...) |
| 이차 탐사 (Quadratic) | h+1², h+2², h+3², ... |
| 이중 해싱 | 다른 해시 함수 적용 |

### 5-3. 트리 순회 (최빈출!)

```
        A
       / \
      B   C
     / \   \
    D   E   F
```

| 순회 방식 | 순서 | 결과 | 암기법 |
|-----------|------|------|--------|
| **전위** (Preorder) | **루트** → 왼 → 오 | A B D E C F | **V**LR |
| **중위** (Inorder) | 왼 → **루트** → 오 | D B E A C F | L**V**R |
| **후위** (Postorder) | 왼 → 오 → **루트** | D E B F C A | LR**V** |

> **시험 핵심**: 순회 방식 이름에서 "위(루트 방문 시점)"만 기억!
> - 전위 = 루트 **먼저** → VLR
> - 중위 = 루트 **중간** → LVR
> - 후위 = 루트 **나중** → LRV

**트레이싱 꿀팁 — 괄호법:**
```
전위: A(B(D)(E))(C()(F)) → 괄호 열 때 읽기 → A B D E C F
중위: ((D)B(E))A(()C(F)) → 괄호 닫을 때 읽기 → D B E A C F
후위: ((D)(E)B)(()( F)C)A → 괄호 닫을 때 읽기 → D E B F C A
```

---

## PART 6: 기출 코드 트레이싱 (직접 풀어보기!)

---

### 문제 1 (SQL - CREATE + ALTER) ★★★

다음 SQL문의 실행 결과를 작성하시오.

```sql
CREATE TABLE product (
    id INT PRIMARY KEY,
    name VARCHAR(20),
    price INT DEFAULT 0
);

ALTER TABLE product ADD category VARCHAR(10);
ALTER TABLE product DROP COLUMN price;
```

**나의 답 — 최종 product 테이블 구조:**
```
컬럼: ___, ___, ___
```

---

### 문제 2 (SQL - GRANT) ★★★★

빈칸을 채우시오.

```sql
-- user1에게 student 테이블의 SELECT, INSERT 권한을 부여하고
-- user1이 다른 사용자에게도 권한을 줄 수 있게 하시오.

(  ①  ) SELECT, INSERT ON student TO user1 (  ②  );
```

**① = ___, ② = ___**

---

### 문제 3 (SQL - DELETE vs TRUNCATE) ★★★

다음 중 올바른 설명을 모두 고르시오.

```
ㄱ. DELETE FROM 학생; 은 롤백이 가능하다.
ㄴ. TRUNCATE TABLE 학생; 은 테이블 구조를 삭제한다.
ㄷ. DROP TABLE 학생; 은 테이블과 데이터를 모두 삭제한다.
ㄹ. TRUNCATE는 WHERE 조건을 사용할 수 있다.
```

**나의 답:** ___

---

### 문제 4 (버블 정렬 트레이싱) ★★★★★

```java
public class Main {
    public static void main(String[] args) {
        int[] a = {9, 6, 7, 3, 5};
        int n = a.length;
        for (int i = 0; i < n-1; i++) {
            for (int j = 0; j < n-1-i; j++) {
                if (a[j] > a[j+1]) {
                    int t = a[j];
                    a[j] = a[j+1];
                    a[j+1] = t;
                }
            }
        }
        for (int i = 0; i < n; i++)
            System.out.print(a[i] + " ");
    }
}
```

**트레이싱 (1라운드만 직접 해보기):**
```
초기: [9, 6, 7, 3, 5]

i=0 (1라운드):
  j=0: (9,6) → 교환 → [___, ___, ___, ___, ___]
  j=1: (___,___) → ___ → [___, ___, ___, ___, ___]
  j=2: (___,___) → ___ → [___, ___, ___, ___, ___]
  j=3: (___,___) → ___ → [___, ___, ___, ___, ___]

최종 출력: ___
```

---

### 문제 5 (선택 정렬 트레이싱) ★★★★★

```c
#include <stdio.h>
int main() {
    int a[] = {64, 25, 12, 22, 11};
    int n = 5;
    for (int i = 0; i < n-1; i++) {
        int min = i;
        for (int j = i+1; j < n; j++) {
            if (a[j] < a[min]) min = j;
        }
        int t = a[i]; a[i] = a[min]; a[min] = t;
    }
    for (int i = 0; i < n; i++)
        printf("%d ", a[i]);
    return 0;
}
```

**트레이싱:**
```
초기: [64, 25, 12, 22, 11]

i=0: min=___ (값=___) → 교환 → [___, ___, ___, ___, ___]
i=1: min=___ (값=___) → 교환 → [___, ___, ___, ___, ___]
i=2: min=___ (값=___) → 교환 → [___, ___, ___, ___, ___]
i=3: min=___ (값=___) → 교환 → [___, ___, ___, ___, ___]

출력: ___
```

---

### 문제 6 (트리 순회) ★★★★★

```
        1
       / \
      2   3
     / \   \
    4   5   6
   /
  7
```

```
전위(Preorder) 순회 결과: ___
중위(Inorder) 순회 결과: ___
후위(Postorder) 순회 결과: ___
```

---

### 문제 7 (이진 탐색 트레이싱) ★★★★

```python
def binary_search(arr, key):
    low = 0
    high = len(arr) - 1
    count = 0
    while low <= high:
        mid = (low + high) // 2
        count += 1
        if arr[mid] == key:
            return count
        elif arr[mid] < key:
            low = mid + 1
        else:
            high = mid - 1
    return -1

arr = [3, 7, 15, 24, 33, 45, 56, 68, 72]
print(binary_search(arr, 45))
```

**트레이싱:**
```
low=0, high=8, mid=___ → arr[___]=___ vs 45 → ___
low=___, high=___, mid=___ → arr[___]=___ vs 45 → ___
low=___, high=___, mid=___ → arr[___]=___ vs 45 → ___

count=___ → 출력: ___
```

---

### 문제 8 (프로시저 빈칸) ★★★★

다음 프로시저의 빈칸을 채우시오.

```sql
CREATE (  ①  ) PROCEDURE calc_bonus
(p_id (  ②  ) INT, p_result (  ③  ) INT)
IS
    v_sal INT;
BEGIN
    SELECT salary INTO v_sal FROM employee WHERE id = p_id;
    p_result := v_sal * 2;
END;
```

**① = ___, ② = ___, ③ = ___**

---

### 문제 9 (삽입 정렬 + Python) ★★★★

```python
a = [8, 5, 6, 2, 4]
for i in range(1, len(a)):
    key = a[i]
    j = i - 1
    while j >= 0 and a[j] > key:
        a[j+1] = a[j]
        j -= 1
    a[j+1] = key
print(a)
```

**트레이싱:**
```
초기: [8, 5, 6, 2, 4]

i=1: key=5, j=0, a[0]=8>5 → 밀기 → a[0]=5 → [___, ___, 6, 2, 4]
i=2: key=6, j=1, a[1]=___>6? → ___ → [___, ___, ___, 2, 4]
i=3: key=2, → 모두 밀기 → [___, ___, ___, ___, 4]
i=4: key=4, → ___ → [___, ___, ___, ___, ___]

출력: ___
```

---

### 문제 10 (SQL 종합 - JOIN + GROUP BY + HAVING) ★★★★★

**테이블: 부서 (dept)**

| dept_id | dept_name |
|---------|-----------|
| D1      | 영업      |
| D2      | 개발      |
| D3      | 인사      |

**테이블: 사원 (emp)**

| id | name | dept_id | salary |
|----|------|---------|--------|
| 1  | Kim  | D1      | 300    |
| 2  | Lee  | D2      | 400    |
| 3  | Park | D1      | 350    |
| 4  | Choi | D2      | 500    |
| 5  | Jung | D2      | 450    |

```sql
SELECT d.dept_name, COUNT(*) AS cnt, AVG(e.salary) AS avg_sal
FROM dept d
INNER JOIN emp e ON d.dept_id = e.dept_id
GROUP BY d.dept_name
HAVING COUNT(*) >= 2
ORDER BY avg_sal DESC;
```

**트레이싱:**
```
INNER JOIN 결과:
  dept_name=영업, Kim(300)
  dept_name=영업, Park(350)
  dept_name=개발, Lee(400)
  dept_name=개발, Choi(500)
  dept_name=개발, Jung(450)
  (인사는? emp에 없으므로 ___)

GROUP BY dept_name:
  영업: cnt=___, avg_sal=___
  개발: cnt=___, avg_sal=___

HAVING COUNT(*) >= 2:
  ___

ORDER BY avg_sal DESC:

결과:
| dept_name | cnt | avg_sal |
|-----------|-----|---------|
| ___       | ___ | ___     |
| ___       | ___ | ___     |
```

---

## PART 7: 정답 & 해설

<details>

### 문제 1 정답: `id(INT, PK), name(VARCHAR(20)), category(VARCHAR(10))`
- ADD category → 컬럼 추가
- DROP COLUMN price → price 컬럼 삭제
- 최종: id, name, category (3개 컬럼)

### 문제 2 정답: `① GRANT`, `② WITH GRANT OPTION`
- GRANT 권한 ON 테이블 TO 사용자 WITH GRANT OPTION

### 문제 3 정답: `ㄱ, ㄷ`
- ㄱ O: DELETE는 DML이므로 롤백 가능
- ㄴ X: TRUNCATE는 **구조 유지**, 데이터만 삭제
- ㄷ O: DROP은 테이블 구조 + 데이터 모두 삭제
- ㄹ X: TRUNCATE는 WHERE 조건 **사용 불가** (전체 삭제)

### 문제 4 정답: `3 5 6 7 9`
```
1라운드: [9,6,7,3,5] → [6,7,3,5,9]  (9 확정)
2라운드: [6,7,3,5,9] → [6,3,5,7,9]  (7 확정)
3라운드: [6,3,5,7,9] → [3,5,6,7,9]  (6 확정)
4라운드: [3,5,6,7,9] → [3,5,6,7,9]  (변화없음)
```

### 문제 5 정답: `11 12 22 25 64`
```
i=0: min=4(값11) → [11, 25, 12, 22, 64]
i=1: min=2(값12) → [11, 12, 25, 22, 64]
i=2: min=3(값22) → [11, 12, 22, 25, 64]
i=3: min=3(값25) → [11, 12, 22, 25, 64]
```

### 문제 6 정답:
```
전위: 1 2 4 7 5 3 6
중위: 7 4 2 5 1 3 6
후위: 7 4 5 2 6 3 1
```
- 전위(VLR): 1→2→4→7→5→3→6
- 중위(LVR): 7→4→2→5→1→3→6
- 후위(LRV): 7→4→5→2→6→3→1

### 문제 7 정답: `3`
```
low=0, high=8, mid=4 → arr[4]=33 < 45 → low=5, count=1
low=5, high=8, mid=6 → arr[6]=56 > 45 → high=5, count=2
low=5, high=5, mid=5 → arr[5]=45 == 45 → return 3
```

### 문제 8 정답: `① OR REPLACE`, `② IN`, `③ OUT`
- p_id는 입력 → IN
- p_result는 결과 반환 → OUT

### 문제 9 정답: `[2, 4, 5, 6, 8]`
```
i=1: key=5 → [5, 8, 6, 2, 4]
i=2: key=6 → [5, 6, 8, 2, 4]
i=3: key=2 → [2, 5, 6, 8, 4]
i=4: key=4 → [2, 4, 5, 6, 8]
```

### 문제 10 정답:

| dept_name | cnt | avg_sal |
|-----------|-----|---------|
| 개발      | 3   | 450     |
| 영업      | 2   | 325     |

- INNER JOIN → 인사 부서 제외 (emp에 데이터 없음)
- 영업: cnt=2, avg=(300+350)/2=325
- 개발: cnt=3, avg=(400+500+450)/3=450
- HAVING >= 2: 둘 다 통과
- ORDER BY avg_sal DESC: 개발(450) → 영업(325)

</details>

---

## Day 4 학습 완료 체크리스트

- [ ] PART 1~2 DDL/DCL/TCL 이론 읽기
- [ ] PART 3 절차형 SQL (프로시저/함수/트리거) 구문 암기
- [ ] PART 4~5 정렬/탐색/트리순회 이론 읽기
- [ ] PART 6 문제 10개 종이에 직접 풀기
- [ ] 틀린 문제 오답 원인 메모
- [ ] 핵심 암기: DROP vs TRUNCATE vs DELETE
- [ ] 핵심 암기: GRANT ... WITH GRANT OPTION
- [ ] 핵심 암기: ACID (원일격영)
- [ ] 핵심 암기: 프로시저 vs 함수 (RETURN 필수 여부)
- [ ] 핵심 암기: 트리 순회 VLR / LVR / LRV
- [ ] 핵심 암기: 안정 정렬 = 버삽병

---

> **내일 Day 5 예고**: 디자인 패턴 (GoF 23개) + UML 다이어그램/관계
>
> **참고 링크**:
> - [SQL 응용 정리](https://2unbini.github.io/%F0%9F%93%82%20all/kunbon/%EC%A0%95%EB%B3%B4%EC%B2%98%EB%A6%AC%EA%B8%B0%EC%82%AC/chapter-seven/)
> - [시나공 기출](https://www.sinagong.co.kr/pds/001001002/past-exams)
> - [뉴비티 CBT](https://newbt.kr/시험/정보처리기사%20실기)
