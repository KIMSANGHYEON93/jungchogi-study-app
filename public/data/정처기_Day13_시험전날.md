# Day 13 - 시험 전날 마무리 (최빈출 + 직전 암기카드)

> **날짜**: 2026.04.17 (금) 19:00~22:00
> **목표**: 최빈출 유형 집중 풀이 + 시험장 가져갈 암기카드 완성
> **학습 후 체크**: [ ] 최빈출 15문제 풀기  [ ] 암기카드 3회 읽기  [ ] 내일 준비물 확인

---

## Part 1. 최빈출 유형 TOP 15 (실전 감각 최종 점검)

> 시험에 가장 자주 나오는 유형만 엄선. **반드시 만점** 받아야 할 문제들.

---

### 문제 1. [C 포인터 연산] ★★★

```c
#include <stdio.h>
int main() {
    int a[] = {10, 20, 30, 40, 50};
    int *p = a;
    printf("%d ", *(p + 2));
    printf("%d ", *p + 2);
    printf("%d\n", *(a + 4));
    return 0;
}
```

**내 답**: _______________

<details>
<summary>정답 확인</summary>

```
30 12 50
```

- `*(p+2)` = a[2] = 30
- `*p+2` = (*p)+2 = 10+2 = 12
- `*(a+4)` = a[4] = 50

**핵심**: `*p+n` ≠ `*(p+n)` — 연산자 우선순위!

</details>

---

### 문제 2. [C 증감연산자] ★★★

```c
#include <stdio.h>
int main() {
    int a = 5, b = 5;
    int x = a++ + ++b;
    printf("%d %d %d\n", a, b, x);
    return 0;
}
```

**내 답**: _______________

<details>
<summary>정답 확인</summary>

```
6 6 11
```

- `a++`: 사용(5) 후 증가 → a=6
- `++b`: 증가(6) 후 사용
- x = 5 + 6 = 11

</details>

---

### 문제 3. [C 재귀함수] ★★★

```c
#include <stdio.h>
int f(int n) {
    if (n <= 1) return 1;
    return n * f(n - 1);
}
int main() {
    printf("%d\n", f(5));
    return 0;
}
```

**내 답**: _______________

<details>
<summary>정답 확인</summary>

```
120
```

- f(5) = 5 × f(4) = 5 × 4 × f(3) = 5 × 4 × 3 × f(2) = 5 × 4 × 3 × 2 × f(1) = 120
- 팩토리얼 함수

</details>

---

### 문제 4. [Java 다형성] ★★★

```java
class Parent {
    int x = 100;
    void show() { System.out.println("Parent " + x); }
}
class Child extends Parent {
    int x = 200;
    void show() { System.out.println("Child " + x); }
}
public class Main {
    public static void main(String[] args) {
        Parent obj = new Child();
        System.out.println(obj.x);
        obj.show();
    }
}
```

**내 답**: _______________

<details>
<summary>정답 확인</summary>

```
100
Child 200
```

- `obj.x` → 변수는 **부모** 타입 기준 = 100
- `obj.show()` → 메서드는 **자식** 오버라이딩 = "Child 200"
- **핵심 공식**: `Parent obj = new Child()` → 변수=부모, 메서드=자식

</details>

---

### 문제 5. [Java 생성자 체이닝] ★★★

```java
class A {
    A() { System.out.print("A "); }
    A(int x) { System.out.print("A" + x + " "); }
}
class B extends A {
    B() { this(10); System.out.print("B "); }
    B(int x) { super(x); System.out.print("B" + x + " "); }
}
public class Main {
    public static void main(String[] args) {
        B b = new B();
    }
}
```

**내 답**: _______________

<details>
<summary>정답 확인</summary>

```
A10 B10 B
```

- `new B()` → `B()` → `this(10)` → `B(10)` → `super(10)` → `A(10)` 출력 "A10 "
- `B(10)` 나머지 실행 → 출력 "B10 "
- `B()` 나머지 실행 → 출력 "B "
- **핵심**: this()/super()는 반드시 첫 줄, 둘 중 하나만 가능

</details>

---

### 문제 6. [Java String] ★★★

```java
public class Main {
    public static void main(String[] args) {
        String a = "Hello";
        String b = "Hello";
        String c = new String("Hello");
        System.out.println(a == b);
        System.out.println(a == c);
        System.out.println(a.equals(c));
    }
}
```

**내 답**: _______________

<details>
<summary>정답 확인</summary>

```
true
false
true
```

- a == b → 같은 String Pool 참조 → true
- a == c → new로 생성한 별도 객체 → 참조 다름 → false
- a.equals(c) → 값 비교 → true

</details>

---

### 문제 7. [Python 슬라이싱 + 메서드] ★★★

```python
a = "Information"
print(a[0:5])
print(a[::-1])
print(a.upper())
print(len(a))
```

**내 답**: _______________

<details>
<summary>정답 확인</summary>

```
Infor
noitamrofnI
INFORMATION
11
```

- `a[0:5]` = index 0~4 = "Infor" (5 미포함)
- `a[::-1]` = 역순
- `.upper()` = 전부 대문자
- `len("Information")` = 11글자

</details>

---

### 문제 8. [Python Set 연산] ★★★

```python
a = {1, 2, 3, 4, 5}
b = {3, 4, 5, 6, 7}
print(a & b)
print(a | b)
print(a - b)
print(len(a ^ b))
```

**내 답**: _______________

<details>
<summary>정답 확인</summary>

```
{3, 4, 5}
{1, 2, 3, 4, 5, 6, 7}
{1, 2}
4
```

- `a & b` = 교집합 = {3,4,5}
- `a | b` = 합집합 = {1,2,3,4,5,6,7}
- `a - b` = 차집합 = {1,2}
- `a ^ b` = 대칭차집합 = {1,2,6,7} → len = 4

</details>

---

### 문제 9. [Python lambda/map] ★★★

```python
f = lambda x: x ** 2 + 1
result = list(map(f, [1, 2, 3, 4]))
print(result)
print(list(filter(lambda x: x > 5, result)))
```

**내 답**: _______________

<details>
<summary>정답 확인</summary>

```
[2, 5, 10, 17]
[10, 17]
```

- f(1)=2, f(2)=5, f(3)=10, f(4)=17
- filter: 5보다 큰 것 = [10, 17]

</details>

---

### 문제 10. [SQL GROUP BY + HAVING] ★★★

```
[employee 테이블]
| name | dept   | salary |
|------|--------|--------|
| Kim  | Sales  | 3000   |
| Lee  | Sales  | 4000   |
| Park | Dev    | 5000   |
| Choi | Dev    | 6000   |
| Jung | HR     | 3500   |
```

```sql
SELECT dept, AVG(salary) AS avg_sal
FROM employee
GROUP BY dept
HAVING AVG(salary) >= 4000
ORDER BY avg_sal DESC;
```

**내 답**: _______________

<details>
<summary>정답 확인</summary>

```
| dept  | avg_sal |
|-------|---------|
| Dev   | 5500    |
```

- Sales AVG = (3000+4000)/2 = 3500 → 4000 미만 → 제외
- Dev AVG = (5000+6000)/2 = 5500 → 4000 이상 → 포함
- HR AVG = 3500 → 4000 미만 → 제외
- ORDER BY DESC → Dev(5500) 1개만 출력

</details>

---

### 문제 11. [SQL JOIN] ★★★

```
[orders]                    [customers]
| oid | cid | amount |      | cid | name  |
|-----|-----|--------|      |-----|-------|
| 1   | 10  | 500    |      | 10  | Kim   |
| 2   | 20  | 300    |      | 20  | Lee   |
| 3   | 30  | 700    |      | 40  | Park  |
```

```sql
SELECT c.name, o.amount
FROM customers c LEFT JOIN orders o ON c.cid = o.cid;
```

**내 답**: _______________

<details>
<summary>정답 확인</summary>

```
| name | amount |
|------|--------|
| Kim  | 500    |
| Lee  | 300    |
| Park | NULL   |
```

- LEFT JOIN = **왼쪽(customers) 전체** + 오른쪽 매칭
- Park(cid=40)은 orders에 없음 → amount = NULL
- orders의 cid=30은 customers에 없으므로 LEFT JOIN에서 안 나옴

</details>

---

### 문제 12. [디자인 패턴] ★★★

다음 설명에 해당하는 디자인 패턴을 쓰시오.

**(1)** 클래스의 인스턴스가 하나만 생성되도록 보장하고, 전역 접근점을 제공한다.

**(2)** 기존 객체의 인터페이스를 다른 인터페이스로 변환하여 호환되지 않는 클래스들이 함께 동작할 수 있게 한다.

**(3)** 객체의 상태가 변경될 때 의존하는 다른 객체들에게 자동으로 알려준다.

**내 답**: (1) __________ (2) __________ (3) __________

<details>
<summary>정답 확인</summary>

(1) **Singleton** (싱글톤) — 생성 패턴
(2) **Adapter** (어댑터) — 구조 패턴
(3) **Observer** (옵서버) — 행위 패턴

</details>

---

### 문제 13. [UML + 요구사항] ★★★

다음 빈칸을 채우시오.

(1) 유스케이스 다이어그램에서 기본 유스케이스 수행 시 **반드시** 실행되는 관계는 ( ________ )이고, **조건에 따라** 선택적으로 실행되는 관계는 ( ________ )이다.

(2) 요구사항 개발 프로세스: ( ________ ) → 분석 → 명세 → 확인

(3) 형상관리 절차: 식별 → ( ________ ) → 감사 → 기록

**내 답**: (1) __________, __________ (2) __________ (3) __________

<details>
<summary>정답 확인</summary>

(1) **include** (포함), **extend** (확장)
(2) **도출** (도분명확)
(3) **통제** (식통감기)

</details>

---

### 문제 14. [보안] ★★★

다음 설명에 해당하는 용어를 쓰시오.

(1) 웹 페이지에 악의적인 스크립트를 삽입하여, 해당 페이지를 열람하는 사용자의 브라우저에서 실행되게 하는 공격

(2) 여러 대의 분산된 컴퓨터를 이용하여 대량의 트래픽을 발생시켜 서비스를 마비시키는 공격

(3) 침입 시도를 탐지하고 자동으로 차단까지 수행하는 보안 시스템

**내 답**: (1) __________ (2) __________ (3) __________

<details>
<summary>정답 확인</summary>

(1) **XSS** (Cross Site Scripting / 크로스 사이트 스크립팅)
(2) **DDoS** (Distributed Denial of Service / 분산 서비스 거부)
(3) **IPS** (Intrusion Prevention System / 침입 방지 시스템)
- 참고: IDS = 탐지만, IPS = 탐지 + **차단**

</details>

---

### 문제 15. [정규화 + 키] ★★★

다음 빈칸을 채우시오.

(1) 제1정규형(1NF): 모든 속성의 값이 ( ________ )값이어야 한다.

(2) 제2정규형(2NF): ( ________ ) 함수 종속을 제거한다.

(3) 제3정규형(3NF): ( ________ ) 함수 종속을 제거한다.

(4) 릴레이션에서 튜플을 유일하게 식별하는 최소한의 속성 집합을 ( ________ )키라 한다.

**내 답**: (1) __________ (2) __________ (3) __________ (4) __________

<details>
<summary>정답 확인</summary>

(1) **원자** (atomic, 더 이상 분해 불가)
(2) **부분** (부분 함수 종속 제거)
(3) **이행** (이행 함수 종속 제거 — A→B→C에서 A→C 제거)
(4) **후보** (후보키 = 유일성 + 최소성)
- 암기: 도부이결다조 (도메인/부분/이행/결정자/다치/조인)

</details>

---

## Part 2. 시험장 직전 암기카드 (A4 1장 분량)

> 시험장에서 입실 전 마지막으로 보는 카드. **프린트해서 가져가기!**

---

### CARD 1: 코드 5대 규칙

```
① *p+2 ≠ *(p+2)          → 값+2 vs 주소이동
② a++ = 후증가, ++a = 선증가
③ Parent obj = new Child() → 변수=부모, 메서드=자식
④ == 참조비교, equals() 값비교
⑤ a[s:e] → e 미포함 (Python/Java substring 공통)
```

### CARD 2: SQL 실행순서 & 핵심

```
FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY
WHERE = 그룹 전 (집계X)  /  HAVING = 그룹 후 (집계O)
COUNT(*) = NULL포함  /  COUNT(col) = NULL제외
IS NULL (O)  /  = NULL (X)
LEFT JOIN = 왼쪽 전체 + 오른쪽 매칭(없으면 NULL)
```

### CARD 3: DDL 비교

```
DELETE = DML, 구조유지, 롤백O, WHERE O
TRUNCATE = DDL, 구조유지, 롤백X, WHERE X
DROP = DDL, 구조삭제, 롤백X, WHERE X
```

### CARD 4: 암기법 모음

```
요구사항:  도분명확
형상관리:  식통감기
럼바우:    객동기 (객체/동적=상태/기능=DFD)
테스트:    단통시인
통합:      하향=스텁, 상향=드라이버
오라클:    참샘휴일
커버리지:  구결조 조결변 다 (약→강)
정규화:    도부이결다조
결합도:    자스제외공내 (좋→나)
응집도:    우논시절통순기 (나→좋)
교착상태:  상점비환
OSI:       물데네전세표응
품질:      기신사효유이
CMMI:      초관정정최
XP:        용단의피존
```

### CARD 5: 디자인 패턴

```
생성(5) 빌프팩앱싱:
  Singleton=유일, Factory=하위결정, Builder=단계별
  Prototype=복제, Abstract Factory=객체군

구조(7) 어데퍼브플컴프:
  Adapter=변환, Decorator=동적추가, Facade=단순화
  Bridge=분리, Proxy=대리, Composite=트리, Flyweight=공유

행위: Observer=알림, Strategy=교체, Template=골격
      Command=요청객체화, State=상태→행위, Iterator=순차
      Memento=Undo
```

### CARD 6: 보안

```
대칭키: AES, DES, SEED, ARIA (같은 키)
비대칭: RSA, ECC, DSA (공개+개인)
해시:   SHA-256, MD5 (일방향)

XSS=스크립트삽입  SQL Injection=SQL삽입
DDoS=분산공격     스니핑=엿봄  스푸핑=위장
IDS=탐지  IPS=탐지+차단  WAF=웹방화벽
DAC=임의  MAC=강제  RBAC=역할
```

### CARD 7: UML

```
구조(6): 클객컴배패복
행위(6): 유시커활상타
관계(6): 연관─ 집합◇ 합성◆ 의존--> 일반화▷ 실체화-▷
include=필수  extend=선택
+public  -private  #protected  ~package
```

### CARD 8: 정렬 & 트리

```
O(n²): 버블/선택/삽입    O(nlogn): 퀵/병합/힙
안정정렬: 버삽병 (버블/삽입/병합)
전위=VLR  중위=LVR  후위=LRV (V=루트 위치)
```

---

## Part 3. 내일 시험 준비 체크리스트

```
□ 준비물
  □ 수험표 (또는 수험번호 캡처)
  □ 신분증 (주민등록증/운전면허증)
  □ 컴퓨터용 사인펜 (검정색)
  □ 수정테이프
  □ 아날로그 시계 (선택)
  □ 이 암기카드 프린트

□ 시험 정보
  □ 시험일: 2026.04.18 (토)
  □ 시험 시간: 실기 2시간 30분 (150분)
  □ 시험장 위치 & 교통편 확인
  □ 도착 목표: 시험 30분 전

□ 컨디션
  □ 23시 전 취침
  □ 알람 설정
  □ 가벼운 아침식사
```

---

## Day 13 학습 완료 체크리스트

- [ ] 최빈출 15문제 직접 풀기 (답 가리고)
- [ ] 틀린 문제 해당 Day 자료 재확인
- [ ] 암기카드 (CARD 1~8) 3회 반복 읽기
- [ ] 암기카드 프린트 or 캡처
- [ ] 내일 준비물 & 시험장 확인 완료

---

> **내일 Day 14**: 시험 당일 — 마지막 30분 루틴 + 시험 전략
