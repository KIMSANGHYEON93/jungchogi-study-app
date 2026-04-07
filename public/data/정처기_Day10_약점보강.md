# Day 10 - 약점 집중 보강 (함정 패턴 + 추가 연습 20제)

> **날짜**: 2026.04.14 (화) 19:00~22:00
> **목표**: Day 9 모의고사에서 틀린 유형 집중 보강 + 시험 함정 총정리
> **학습 후 체크**: [ ] 함정 정리 읽기  [ ] 추가 20문제 풀기  [ ] 오답 5개 이내

---

## PART 1: 코드 함정 TOP 10 (가장 많이 틀리는 포인트)

### 함정 1. `*p+2` vs `*(p+2)` (C)

```c
int a[] = {10, 20, 30};
int *p = a;
printf("%d", *p + 2);   // 10 + 2 = 12  (값에 2 더함)
printf("%d", *(p + 2));  // a[2] = 30    (주소 이동 후 역참조)
```

> **규칙**: `*`가 `+`보다 우선순위 높음! `*p+2` = `(*p)+2`

### 함정 2. 후위 증감 vs 전위 증감 (C)

```c
int a = 5;
int b = a++;  // b=5 (먼저 대입), a=6 (나중에 증가)
int c = ++a;  // a=7 (먼저 증가), c=7 (증가된 값 대입)
```

> `a++` = 현재 값 사용 **후** 증가, `++a` = 증가 **후** 사용

### 함정 3. 메서드 vs 변수 (Java 다형성)

```java
Parent obj = new Child();
obj.method();  // -> Child의 메서드 (오버라이딩 O)
obj.variable;  // -> Parent의 변수   (오버라이딩 X!)
```

> **메서드 = 자식**, **변수 = 부모** (변수는 오버라이딩 안됨!)

### 함정 4. 생성자 호출 순서 (Java)

```
new Child()
-> Child()에서 super() 없으면? -> 암묵적 super() 자동 삽입!
-> 하지만 this()가 있으면? -> this()가 먼저, super()는 최종 도착 생성자에서만!
```

> **규칙**: 생성자 첫 줄에 `this()` 또는 `super()` 중 하나만 가능

### 함정 5. elif는 else if! (Python)

```python
x = 6
if x % 2 == 0:    # True -> 여기서 끝!
    print("짝수")
elif x % 3 == 0:   # 실행 안됨! (이미 if에서 잡힘)
    print("3배수")
```

> 6은 짝수이면서 3의 배수이지만, **elif이므로 첫 조건만 실행**

### 함정 6. 슬라이싱 end 미포함 (Python)

```python
a = "ABCDEF"
a[1:4]   # "BCD"  (인덱스 1,2,3 -> 4는 미포함!)
a[:3]    # "ABC"  (0,1,2)
a[3:]    # "DEF"  (3,4,5)
```

### 함정 7. `>>` 비트 시프트 = 나누기 (Python/C/Java)

```python
100 >> 1  # 50   (100 / 2^1)
100 >> 2  # 25   (100 / 2^2)
100 << 1  # 200  (100 * 2^1)
```

> `>>n` = `/ 2^n`, `<<n` = `* 2^n` (정수 나눗셈)

### 함정 8. Set 순서 없음 + 중복 무시

```python
s = {3, 1, 2, 1, 3}
print(s)  # {1, 2, 3} (중복 제거, 순서는 시험에서 제시)
s.add(2)  # 변화 없음 (이미 있음)
```

### 함정 9. COUNT(*) vs COUNT(컬럼) (SQL)

```sql
-- NULL이 포함된 데이터에서
COUNT(*)     -- NULL 포함 (전체 행 수)
COUNT(score) -- NULL 제외
AVG(score)   -- NULL 제외하고 평균 (분모에서도 제외!)
```

### 함정 10. WHERE vs HAVING (SQL)

```sql
WHERE   -- GROUP BY 전에 필터 (집계함수 사용 불가!)
HAVING  -- GROUP BY 후에 필터 (집계함수 사용 가능)
```

> `WHERE COUNT(*) > 2` -> **에러!** `HAVING COUNT(*) > 2`가 맞음

---

## PART 2: 이론 함정 TOP 10

### 함정 1. 하향식 = 스텁 / 상향식 = 드라이버

> 반대로 외우는 실수 잦음! **하스상드** (하향=스텁, 상향=드라이버)

### 함정 2. include = 필수 / extend = 선택

> 유스케이스에서 `<<include>>`는 반드시 실행, `<<extend>>`는 조건부

### 함정 3. 집합(Aggregation) vs 합성(Composition)

```
집합(빈 마름모 <>): 전체-부분이 독립적 (팀 해산해도 선수 존재)
합성(꽉 찬 마름모 <>): 전체-부분이 종속적 (건물 무너지면 방도 사라짐)
```

### 함정 4. DELETE vs TRUNCATE vs DROP

```
DELETE   -> DML, 롤백 O, WHERE O, 구조 유지
TRUNCATE -> DDL, 롤백 X, WHERE X, 구조 유지, 전체 삭제
DROP     -> DDL, 롤백 X, 테이블 자체 삭제
```

### 함정 5. 결합도/응집도 순서 혼동

```
결합도: 자스제외공내 (약->강, 좋은->나쁜)
응집도: 우논시절통순기 (약->강, 나쁜->좋은)
주의: 결합도는 낮을수록, 응집도는 높을수록 좋음!
```

### 함정 6. CMMI vs SPICE 단계 수

```
CMMI:  5단계 (초관정정최) - 1~5 레벨
SPICE: 6단계 (불수관확예최) - 0~5 레벨 (0부터 시작!)
```

### 함정 7. 대칭키 vs 비대칭키 알고리즘 혼동

```
대칭키: DES, 3DES, AES, SEED, ARIA, IDEA
비대칭키: RSA, ECC, DSA, ElGamal
해시: MD5, SHA
```

> AES = 대칭, RSA = 비대칭 (가장 중요한 2개)

### 함정 8. 럼바우 = 객동기 (객체/동적/기능)

```
객체 모델링 -> 객체 다이어그램
동적 모델링 -> 상태 다이어그램  (상태 전이도)
기능 모델링 -> DFD (자료흐름도)
```

> "동적 = DFD"로 잘못 외우는 경우 많음! 동적 = **상태**, 기능 = **DFD**

### 함정 9. 정규화 순서 혼동

```
1NF: 원자값 (도메인)
2NF: 부분 함수 종속 제거
3NF: 이행 함수 종속 제거
BCNF: 결정자가 후보키가 아닌 것 제거
```

> 2NF = "**부분**", 3NF = "**이행**" (2부3이)

### 함정 10. 전위/중위/후위 순회 혼동

```
전위(Pre)  = V L R (루트 먼저)
중위(In)   = L V R (루트 중간)
후위(Post) = L R V (루트 나중)
```

> "위" = 루트의 위치! 전(앞), 중(가운데), 후(뒤)

---

## PART 3: 추가 연습 문제 20제

---

### 문제 1 (C - 포인터 연산) ★★★★★

```c
#include <stdio.h>
int main() {
    char *p = "HELLO";
    printf("%c ", *p);
    printf("%c ", *(p+3));
    printf("%c ", *p+3);
    printf("%s\n", p+2);
    return 0;
}
```

답:

---

### 문제 2 (C - for + 조건) ★★★★

```c
#include <stdio.h>
int main() {
    int sum = 0;
    for (int i = 1; i <= 10; i++) {
        if (i % 3 == 0) continue;
        if (i % 7 == 0) break;
        sum += i;
    }
    printf("%d\n", sum);
    return 0;
}
```

답:

---

### 문제 3 (C - 배열 + 함수) ★★★★

```c
#include <stdio.h>
int func(int *arr, int n) {
    int max = arr[0];
    for (int i = 1; i < n; i++) {
        if (arr[i] > max) max = arr[i];
    }
    return max;
}
int main() {
    int a[] = {3, 7, 1, 9, 4};
    printf("%d\n", func(a, 5));
    return 0;
}
```

답:

---

### 문제 4 (Java - 인터페이스) ★★★★

```java
interface Calc {
    int add(int a, int b);
}
class MyCalc implements Calc {
    public int add(int a, int b) { return a + b; }
    public int mul(int a, int b) { return a * b; }
}
public class Main {
    public static void main(String[] args) {
        Calc c = new MyCalc();
        System.out.println(c.add(3, 5));
        // System.out.println(c.mul(3, 5)); // 이 줄은?
    }
}
```

(1) 출력 결과:
(2) 주석 처리된 줄의 주석을 해제하면?

답:

---

### 문제 5 (Java - String) ★★★★

```java
public class Main {
    public static void main(String[] args) {
        String s = "HelloWorld";
        System.out.println(s.length());
        System.out.println(s.substring(3, 7));
        System.out.println(s.charAt(0));
        System.out.println(s.indexOf("World"));
        System.out.println(s.toUpperCase());
    }
}
```

답:

---

### 문제 6 (Java - 배열 + static) ★★★★

```java
class Counter {
    static int count = 0;
    Counter() { count++; }
}
public class Main {
    public static void main(String[] args) {
        Counter c1 = new Counter();
        Counter c2 = new Counter();
        Counter c3 = new Counter();
        System.out.println(Counter.count);
        System.out.println(c1.count == c3.count);
    }
}
```

답:

---

### 문제 7 (Python - 딕셔너리 + 반복) ★★★★

```python
data = {"a": 1, "b": 2, "c": 3}
result = {}
for k, v in data.items():
    result[v] = k
print(result)
print(result[2])
```

답:

---

### 문제 8 (Python - lambda + sorted) ★★★★

```python
students = [("Kim", 85), ("Lee", 92), ("Park", 78)]
students.sort(key=lambda x: x[1])
for name, score in students:
    print(name, score)
```

답:

---

### 문제 9 (Python - 재귀) ★★★★★

```python
def func(n):
    if n == 0:
        return 0
    return n + func(n - 1)

print(func(5))
```

답:

---

### 문제 10 (Python - 문자열 메서드) ★★★★

```python
s = "Hello, World!"
print(s.split(", "))
print(s.replace("World", "Python"))
print(s.find("World"))
print(s.count("l"))
```

답:

---

### 문제 11 (SQL - 서브쿼리) ★★★★★

**테이블: product**

| id | name  | price |
|----|-------|-------|
| 1  | A     | 1000  |
| 2  | B     | 2000  |
| 3  | C     | 1500  |
| 4  | D     | 3000  |
| 5  | E     | 2500  |

```sql
SELECT name, price
FROM product
WHERE price > (SELECT AVG(price) FROM product)
ORDER BY price ASC;
```

답:

---

### 문제 12 (SQL - LEFT JOIN + NULL) ★★★★★

**테이블: dept**

| did | dname |
|-----|-------|
| 1   | Dev   |
| 2   | Sales |
| 3   | HR    |

**테이블: emp**

| eid | name | did |
|-----|------|-----|
| 1   | Kim  | 1   |
| 2   | Lee  | 1   |
| 3   | Park | 2   |

```sql
SELECT d.dname, e.name
FROM dept d
LEFT JOIN emp e ON d.did = e.did
ORDER BY d.dname;
```

답:

---

### 문제 13 (C - 문자열 + 포인터) ★★★★★

```c
#include <stdio.h>
int main() {
    char str[] = "ABCDEF";
    char *p = str + 2;
    *p = 'X';
    printf("%s\n", str);
    printf("%c\n", *(p+1));
    return 0;
}
```

답:

---

### 문제 14 (Java - 다형성 종합) ★★★★★

```java
class Shape {
    String type = "Shape";
    String getType() { return type; }
}
class Circle extends Shape {
    String type = "Circle";
    String getType() { return type; }
}
public class Main {
    public static void main(String[] args) {
        Shape s = new Circle();
        System.out.println(s.type);
        System.out.println(s.getType());
    }
}
```

답:

---

### 문제 15 (SQL - DDL) ★★★★

다음 SQL문 실행 후 테이블 구조를 쓰시오.

```sql
CREATE TABLE orders (
    id INT PRIMARY KEY,
    product VARCHAR(20) NOT NULL,
    qty INT DEFAULT 1,
    price INT
);
ALTER TABLE orders ADD customer VARCHAR(20);
ALTER TABLE orders DROP COLUMN qty;
```

최종 컬럼:

답:

---

### 문제 16 (이론 - 용어) ★★★★★

| 번호 | 설명 | 답 |
|------|------|----|
| (1) | 2~4주 단위의 짧은 개발 주기를 반복하는 스크럼의 핵심 단위 | |
| (2) | IP 주소를 MAC 주소로 변환하는 프로토콜 | |
| (3) | 기존 객체를 복제하여 새 객체를 생성하는 디자인 패턴 | |
| (4) | 소프트웨어의 기능은 유지하면서 내부 구조를 개선하는 기법 | |

답:

---

### 문제 17 (이론 - 약어) ★★★★

```
(1) IaaS = ____________________
(2) AJAX = ____________________
(3) SPICE = ___________________
(4) ETL = _____________________
```

답:

---

### 문제 18 (이론 - 테스트) ★★★★★

**(1)** 블랙박스 테스트 기법 중, 입력 범위를 유효한 클래스와 무효한 클래스로 나누어 테스트하는 기법은?

**(2)** 화이트박스 테스트 기법 중, 프로그램의 모든 문장을 최소 1번 이상 실행하는 커버리지는?

답:

---

### 문제 19 (이론 - UML) ★★★★

**(1)** UML 관계에서 "건물이 무너지면 방도 사라진다"와 같이 부분이 전체에 종속되는 관계는?

**(2)** UML 구조적 다이어그램 중 클래스의 속성, 메서드, 관계를 표현하는 다이어그램은?

답:

---

### 문제 20 (이론 - 종합) ★★★★★

**(1)** ISO/IEC 9126 품질 특성 6가지를 쓰시오.

**(2)** 요구사항 개발 단계를 순서대로 쓰시오.

답:

---

## PART 4: 정답

<details>

### 문제 1: `H L K LLO`
- `*p` = 'H', `*(p+3)` = 'L', `*p+3` = 'H'+3 = 'K' (ASCII 72+3=75), `p+2` = "LLO"
- **주의**: `*p+3`은 문자에 3을 더함 (ASCII 연산!)

### 문제 2: `12`
- i=1: sum=1, i=2: sum=3, i=3: 3의배수 continue(건너뜀)
- i=4: sum=7, i=5: sum=12, i=6: 3의배수 continue(건너뜀)
- i=7: 7의배수 break -> 종료
- sum = 1+2+4+5 = 12

### 문제 3: `9`
- 배열에서 최대값 찾기: max(3,7,1,9,4) = 9

### 문제 4:
(1) `8`
(2) **컴파일 에러** — Calc 인터페이스에 mul() 메서드가 없으므로, Calc 타입 참조로는 호출 불가

### 문제 5:
```
10
loWo
H
5
HELLOWORLD
```
- length=10, substring(3,7)="loWo", charAt(0)='H', indexOf("World")=5

### 문제 6:
```
3
true
```
- static count는 모든 객체 공유 -> 3
- c1.count == c3.count -> 같은 static 변수 -> true

### 문제 7:
```
{1: 'a', 2: 'b', 3: 'c'}
b
```
- key와 value를 뒤집은 딕셔너리 생성

### 문제 8:
```
Park 78
Kim 85
Lee 92
```
- score 기준 오름차순 정렬 (기본 sort = 오름차순)

### 문제 9: `15`
- 5+4+3+2+1+0 = 15 (1~n 합)

### 문제 10:
```
['Hello', ' World!']
Hello, Python!
7
3
```
- split(", ") -> 쉼표+공백 기준 분리
- find("World") -> 인덱스 7
- count("l") -> l이 3개 (He**ll**o, Wor**l**d)

### 문제 11:
| name | price |
|------|-------|
| B    | 2000  |
| E    | 2500  |
| D    | 3000  |

- AVG = (1000+2000+1500+3000+2500)/5 = 2000
- price > 2000: 2000은 미포함(>이므로), E(2500)과 D(3000)만 통과

| name | price |
|------|-------|
| E    | 2500  |
| D    | 3000  |

### 문제 12:
| dname | name |
|-------|------|
| Dev   | Kim  |
| Dev   | Lee  |
| HR    | NULL |
| Sales | Park |

- LEFT JOIN: dept 전체 유지, HR은 emp에 없으므로 NULL

### 문제 13:
```
ABXDEF
D
```
- p = str+2 -> 'C' 위치, *p='X' -> str="ABXDEF"
- *(p+1) = str[3] = 'D'

### 문제 14:
```
Shape
Circle
```
- s.type -> 변수는 참조 타입(Shape) -> "Shape"
- s.getType() -> 메서드는 오버라이딩 -> Circle의 getType() -> "Circle"

### 문제 15:
최종 컬럼: `id(INT, PK), product(VARCHAR(20), NOT NULL), price(INT), customer(VARCHAR(20))`
- qty 삭제, customer 추가

### 문제 16:
(1) **스프린트** (Sprint)
(2) **ARP** (Address Resolution Protocol)
(3) **Prototype** (프로토타입 패턴)
(4) **리팩토링** (Refactoring)

### 문제 17:
(1) Infrastructure as a Service
(2) Asynchronous JavaScript and XML
(3) Software Process Improvement and Capability dEtermination
(4) Extract-Transform-Load

### 문제 18:
(1) **동등 분할** (Equivalence Partitioning)
(2) **구문 커버리지** (Statement Coverage)

### 문제 19:
(1) **합성** (Composition) 관계
(2) **클래스** 다이어그램

### 문제 20:
(1) **기능성, 신뢰성, 사용성, 효율성, 유지보수성, 이식성** (기신사효유이)
(2) **도출 -> 분석 -> 명세 -> 확인** (도분명확)

</details>

---

## PART 5: 시험 직전 최종 체크카드

### 코드 필수 암기 5가지

```
1. *p+2 != *(p+2)     (값 덧셈 vs 주소 이동)
2. a++ = 후, ++a = 전  (후위/전위 증감)
3. 메서드=자식, 변수=부모 (Java 다형성)
4. a[2:6] -> 6 미포함   (Python 슬라이싱)
5. >> = 나누기, << = 곱하기 (비트 시프트)
```

### 이론 필수 암기 10가지

```
1.  식통감기 (형상관리)
2.  도분명확 (요구사항)
3.  객동기 (럼바우)
4.  단통시인 (테스트 단계)
5.  하스상드 (하향=스텁, 상향=드라이버)
6.  자스제외공내 (결합도)
7.  우논시절통순기 (응집도)
8.  도부이결다조 (정규화)
9.  상점비환 (교착상태)
10. 기신사효유이 (ISO 9126)
```

---

## Day 10 학습 완료 체크리스트

- [ ] PART 1 코드 함정 10개 읽기
- [ ] PART 2 이론 함정 10개 읽기
- [ ] PART 3 추가 20문제 풀기
- [ ] 채점 후 틀린 문제 해설 확인
- [ ] PART 5 체크카드 3번 읽기
- [ ] Day 9 모의고사 오답 관련 Day 자료 재확인

---

> **내일 Day 11 예고**: 실전 모의고사 2회 (새로운 20문항)
>
> **참고 링크**:
> - [시나공 기출](https://www.sinagong.co.kr/pds/001001002/past-exams)
> - [뉴비티 CBT](https://newbt.kr/시험/정보처리기사%20실기)
