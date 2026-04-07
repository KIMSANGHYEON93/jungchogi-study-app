# Day 7 - 코드 종합 복습 (C + Java + Python 혼합 트레이싱)

> **날짜**: 2026.04.11 (토) 20:00~22:00 *(재일이 청모 후 저녁)*
> **목표**: C/Java/Python 혼합 기출급 15문제 트레이싱 → 약점 파악
> **학습 후 체크**: [ ] 15문제 풀기  [ ] 오답 5개 이내  [ ] 약점 기록

---

## 출제 비중 요약 (시험 20문항 중)

| 언어 | 예상 문항 | 핵심 유형 |
|------|-----------|-----------|
| **C** | 2~3문항 | 포인터, 배열, 구조체, 재귀, 스코프 |
| **Java** | 2~3문항 | 상속, 오버라이딩, 생성자체이닝, static |
| **Python** | 1~2문항 | 슬라이싱, 리스트, set, lambda, 클래스 |
| **SQL** | 2~3문항 | JOIN, GROUP BY, DDL, 서브쿼리 |

> **코드 문제 = 전체의 약 50%! → 여기서 틀리면 합격 불가능**

---

## 실전 모의 트레이싱 15문제

### ⏱ 제한시간: 문제당 3~5분, 전체 60분 이내

---

### 문제 1 (C - 변수 스코프) ★★★★

```c
#include <stdio.h>
int main() {
    int a = 7, b = 2, c = 3;
    {
        int a = 6, c = 5;
        b = a;
        {
            int b;
            b = b + c;
        }
        printf("%d %d %d\n", a, b, c);
    }
    return 0;
}
```

**트레이싱:**
```
바깥: a=7, b=2, c=3
블록1: a=6(새로), c=5(새로), b=a → b=___
  블록2: b=새 지역변수(초기화X), b=b+c → 쓰레기값 (출력 안됨)
블록1에서 printf → a=___, b=___, c=___

출력: ___
```

---

### 문제 2 (C - 포인터 + 배열) ★★★★★

```c
#include <stdio.h>
int main() {
    int a[] = {1, 2, 3, 4, 5};
    int *p = a;
    printf("%d ", *p);
    printf("%d ", *(p+2));
    printf("%d ", *p+2);
    p += 3;
    printf("%d ", *p);
    printf("%d\n", p - a);
    return 0;
}
```

**트레이싱:**
```
a = [1, 2, 3, 4, 5], p = &a[0]

*p        = a[0] = ___
*(p+2)    = a[2] = ___
*p + 2    = a[0] + 2 = ___  ← 주의! *(p) + 2
p += 3    → p = &a[3]
*p        = a[3] = ___
p - a     = 3 - 0 = ___

출력: ___
```

---

### 문제 3 (C - 재귀함수) ★★★★★

```c
#include <stdio.h>
int func(int n) {
    if (n <= 1) return 1;
    return n * func(n - 2);
}
int main() {
    printf("%d\n", func(7));
    return 0;
}
```

**트레이싱:**
```
func(7) = 7 * func(5)
func(5) = 5 * func(3)
func(3) = 3 * func(1)
func(1) = ___

거꾸로: func(3) = 3 * ___ = ___
        func(5) = 5 * ___ = ___
        func(7) = 7 * ___ = ___

출력: ___
```

---

### 문제 4 (C - 구조체 포인터) ★★★★

```c
#include <stdio.h>
struct Student {
    char name[20];
    int score;
};
int main() {
    struct Student s = {"Kim", 85};
    struct Student *p = &s;
    p->score += 10;
    printf("%s %d\n", p->name, s.score);
    return 0;
}
```

**나의 답:** _______________________

---

### 문제 5 (C - 2차원 배열 + 포인터) ★★★★★

```c
#include <stdio.h>
int main() {
    int a[3][3] = {{1,2,3},{4,5,6},{7,8,9}};
    int *p = &a[1][0];
    printf("%d ", *p);
    printf("%d ", *(p+3));
    printf("%d\n", *(p-1));
    return 0;
}
```

**트레이싱:**
```
메모리 배치: [1][2][3][4][5][6][7][8][9]
             a[0]     a[1]     a[2]

p = &a[1][0] = 4의 주소
*p      = ___
*(p+3)  = 4에서 3칸 뒤 = ___
*(p-1)  = 4에서 1칸 앞 = ___

출력: ___
```

---

### 문제 6 (Java - 상속 + 오버라이딩) ★★★★★

```java
class A {
    int x = 10;
    void show() { System.out.print(x + " "); }
}
class B extends A {
    int x = 20;
    void show() { System.out.print(x + " "); }
}
class C extends B {
    int x = 30;
    void show() { System.out.print(x + " "); }
}
public class Main {
    public static void main(String[] args) {
        A obj = new C();
        obj.show();
        System.out.println(obj.x);
    }
}
```

**트레이싱:**
```
A obj = new C()  → 부모 타입, 자식 객체

obj.show() → 오버라이딩된 메서드 → ___ 의 show() 실행 → 출력: ___
obj.x      → 변수는 오버라이딩 안됨 → ___ 의 x → ___

출력: ___
```

---

### 문제 7 (Java - 생성자 + super) ★★★★★

```java
class Parent {
    int x;
    Parent() { this(10); System.out.print("A "); }
    Parent(int x) { this.x = x; System.out.print("B "); }
}
class Child extends Parent {
    Child() { System.out.print("C "); }
    Child(int x) { super(x); System.out.print("D "); }
}
public class Main {
    public static void main(String[] args) {
        Child c = new Child(20);
    }
}
```

**트레이싱:**
```
new Child(20)
→ Child(int x)에서 super(20) 호출
  → Parent(20) → this.x=20, "B " 출력
→ "D " 출력

주의: Child(20)은 super(20) 명시 → Parent() 안 거침!

출력: ___
```

---

### 문제 8 (Java - static + 인스턴스) ★★★★

```java
class Calc {
    static int total = 0;
    int num;
    Calc(int n) { num = n; total += n; }
    static int getTotal() { return total; }
}
public class Main {
    public static void main(String[] args) {
        Calc a = new Calc(10);
        Calc b = new Calc(20);
        Calc c = new Calc(30);
        System.out.println(Calc.getTotal());
        System.out.println(a.num + " " + b.num);
    }
}
```

**트레이싱:**
```
static total은 모든 객체가 공유!

new Calc(10): num=10, total=0+10=___
new Calc(20): num=20, total=___+20=___
new Calc(30): num=30, total=___+30=___

Calc.getTotal() = ___
a.num=___, b.num=___

출력:
___
___
```

---

### 문제 9 (Java - 추상클래스 + 다형성) ★★★★

```java
abstract class Shape {
    abstract double area();
    void display() {
        System.out.printf("%.1f\n", area());
    }
}
class Circle extends Shape {
    double r;
    Circle(double r) { this.r = r; }
    double area() { return 3.14 * r * r; }
}
class Rect extends Shape {
    double w, h;
    Rect(double w, double h) { this.w = w; this.h = h; }
    double area() { return w * h; }
}
public class Main {
    public static void main(String[] args) {
        Shape s1 = new Circle(5);
        Shape s2 = new Rect(4, 3);
        s1.display();
        s2.display();
    }
}
```

**트레이싱:**
```
s1.display() → area() 오버라이딩 → Circle.area() = 3.14 * 5 * 5 = ___
s2.display() → area() 오버라이딩 → Rect.area() = 4 * 3 = ___

출력:
___
___
```

---

### 문제 10 (Python - 리스트 + 조건) ★★★★

```python
a = [1, 2, 3, 4, 5, 6, 7, 8, 9]
result = []
for i in a:
    if i % 2 == 0:
        result.append(i * 2)
    elif i % 3 == 0:
        result.append(i * 3)
print(result)
```

**트레이싱:**
```
i=1: 2로 안나눔, 3으로 안나눔 → 스킵
i=2: 짝수 → append(___)
i=3: 홀수, 3의 배수 → append(___)
i=4: 짝수 → append(___)
i=5: 스킵
i=6: 짝수 → append(___) ← 주의! elif이므로 3의 배수 체크 안함
i=7: 스킵
i=8: 짝수 → append(___)
i=9: 홀수, 3의 배수 → append(___)

출력: ___
```

---

### 문제 11 (Python - 딕셔너리 + 반복문) ★★★★

```python
students = {"Kim": 85, "Lee": 92, "Park": 78, "Choi": 95}
max_name = ""
max_score = 0
for name, score in students.items():
    if score > max_score:
        max_score = score
        max_name = name
print(max_name, max_score)
```

**나의 답:** _______________________

---

### 문제 12 (Python - 클래스 상속) ★★★★★

```python
class A:
    def __init__(self):
        self.x = 1
    def f(self):
        self.x += 1

class B(A):
    def __init__(self):
        super().__init__()
        self.x += 10
    def f(self):
        super().f()
        self.x += 100

obj = B()
print(obj.x)
obj.f()
print(obj.x)
```

**트레이싱:**
```
B() → super().__init__() → A.__init__() → self.x = 1
    → self.x += 10 → self.x = ___

obj.f() → super().f() → A.f() → self.x += 1 → self.x = ___
        → self.x += 100 → self.x = ___

출력:
___
___
```

---

### 문제 13 (Python - 문자열 + 리스트 컴프리헨션) ★★★★

```python
words = ["hello", "world", "python", "java"]
result = [w.upper() for w in words if len(w) > 4]
print(result)
print(len(result))
```

**트레이싱:**
```
"hello" → len=5 > 4? ___ → ___
"world" → len=5 > 4? ___ → ___
"python" → len=6 > 4? ___ → ___
"java" → len=4 > 4? ___ → 스킵

result = ___
len(result) = ___

출력:
___
___
```

---

### 문제 14 (C - 증감연산자 종합) ★★★★★

```c
#include <stdio.h>
int main() {
    int a = 5, b = 3, c;
    c = a++ + ++b - --a;
    printf("%d %d %d\n", a, b, c);
    return 0;
}
```

**트레이싱 (왼→오 평가):**
```
a++ : 현재 a(5)를 사용 → 5, 그 후 a=6
++b : b를 먼저 증가 → b=4, 4를 사용
--a : a를 먼저 감소 → a=5(6에서 감소), 5를 사용

c = 5 + 4 - 5 = ___
최종: a=___, b=___, c=___

출력: ___
```

---

### 문제 15 (SQL - 종합) ★★★★★

**테이블: 제품 (product)**

| id | name  | category | price |
|----|-------|----------|-------|
| 1  | 사과  | 과일     | 1500  |
| 2  | 배    | 과일     | 2000  |
| 3  | 상추  | 채소     | 1000  |
| 4  | 당근  | 채소     | 800   |
| 5  | 포도  | 과일     | 3000  |

```sql
SELECT category, COUNT(*) AS cnt, MAX(price) AS max_p
FROM product
WHERE price >= 1000
GROUP BY category
HAVING COUNT(*) >= 2
ORDER BY max_p DESC;
```

**트레이싱:**
```
WHERE price >= 1000:
  사과(1500) ___, 배(2000) ___, 상추(1000) ___, 당근(800) ___, 포도(3000) ___

GROUP BY category:
  과일: cnt=___, max_p=___
  채소: cnt=___, max_p=___

HAVING COUNT(*) >= 2:
  과일(___) → ___
  채소(___) → ___

결과:
| category | cnt | max_p |
|----------|-----|-------|
| ___      | ___ | ___   |
| ___      | ___ | ___   |
```

---

## 정답 & 해설

<details>

### 문제 1 정답: `6 6 5`
- 블록1에서 a=6(새로), c=5(새로), b=a → b=6 (바깥 b가 6으로 변경)
- 블록2의 b는 새 지역변수 → 블록1의 b에 영향 없음
- printf: a=6, b=6, c=5

### 문제 2 정답: `1 3 3 4 3`
- `*p` = a[0] = 1
- `*(p+2)` = a[2] = 3
- `*p+2` = a[0]+2 = 1+2 = 3 (**`*p`가 먼저, +2는 정수 덧셈!**)
- p+=3 후 `*p` = a[3] = 4
- `p-a` = 3 (포인터 뺄셈 = 인덱스 차이)

### 문제 3 정답: `105`
- func(1) = 1
- func(3) = 3 * 1 = 3
- func(5) = 5 * 3 = 15
- func(7) = 7 * 15 = **105**

### 문제 4 정답: `Kim 95`
- p->score += 10 → s.score = 85 + 10 = 95
- p와 s는 같은 구조체 → s.score도 95

### 문제 5 정답: `4 7 3`
- 메모리: [1,2,3,4,5,6,7,8,9], p→4
- `*p` = 4
- `*(p+3)` = 4에서 3칸 뒤 = 7
- `*(p-1)` = 4에서 1칸 앞 = 3

### 문제 6 정답: `30 10`
- `obj.show()` → 오버라이딩 → C의 show() → x=30 출력
- `obj.x` → **변수는 참조 타입(A) 기준** → A.x = 10

### 문제 7 정답: `B D`
- Child(20) → super(20) → Parent(20) → "B " 출력 → "D " 출력
- super(20)을 명시했으므로 Parent()의 this(10)은 호출되지 않음

### 문제 8 정답:
```
60
10 20
```
- static total: 10→30→60
- a.num=10, b.num=20 (인스턴스 변수는 별도)

### 문제 9 정답:
```
78.5
12.0
```
- Circle: 3.14 * 25 = 78.5
- Rect: 4 * 3 = 12.0

### 문제 10 정답: `[4, 9, 8, 12, 16, 27]`
- 2→4, 3→9, 4→8, 6→12(elif 안탐), 8→16, 9→27
- **주의**: 6은 짝수 조건에 먼저 걸림 → elif의 3의 배수 조건 체크 안함!

### 문제 11 정답: `Choi 95`
- 딕셔너리 순회하며 최대값 찾기

### 문제 12 정답:
```
11
112
```
- B(): x=1 → x=11
- obj.f(): x=11 → x=12(A.f) → x=112(+100)

### 문제 13 정답:
```
['HELLO', 'WORLD', 'PYTHON']
3
```
- len > 4: hello(5), world(5), python(6) → 3개
- java(4) → 4 > 4 거짓 → 제외

### 문제 14 정답: `5 4 4`
- a++(후위): 5 사용, a→6
- ++b(전위): b→4, 4 사용
- --a(전위): a→5(6-1), 5 사용
- c = 5 + 4 - 5 = 4
- 최종: a=5, b=4, c=4

### 문제 15 정답:

| category | cnt | max_p |
|----------|-----|-------|
| 과일     | 3   | 3000  |

- WHERE >= 1000: 당근(800) 탈락 → 사과, 배, 상추, 포도
- 과일: cnt=3, max=3000 / 채소: cnt=1, max=1000
- HAVING >= 2: 과일만 통과 (채소 cnt=1 탈락)

</details>

---

## 약점 자가 진단표

풀고 나서 체크하세요:

| 번호 | 유형 | 맞음 | 틀림 | 약점 메모 |
|------|------|:----:|:----:|-----------|
| 1 | C 스코프 | | | |
| 2 | C 포인터 | | | |
| 3 | C 재귀 | | | |
| 4 | C 구조체 | | | |
| 5 | C 2차원배열 | | | |
| 6 | Java 다형성 | | | |
| 7 | Java 생성자 | | | |
| 8 | Java static | | | |
| 9 | Java 추상클래스 | | | |
| 10 | Python 조건 | | | |
| 11 | Python 딕셔너리 | | | |
| 12 | Python 클래스 | | | |
| 13 | Python 컴프리헨션 | | | |
| 14 | C 증감연산자 | | | |
| 15 | SQL 종합 | | | |

**결과:** ___/15 맞음

| 정답 수 | 판정 | 대응 |
|---------|------|------|
| 13~15 | 우수 | 이론 용어 집중! |
| 10~12 | 양호 | 틀린 유형 Day1~4 복습 |
| 7~9 | 보통 | 코드 유형 집중 반복 필요 |
| ~6 | 위험 | Day1~4 처음부터 재학습 |

---

## Day 7 학습 완료 체크리스트

- [ ] 15문제 타이머 맞춰서 풀기 (60분)
- [ ] 채점 후 약점 진단표 작성
- [ ] 틀린 문제 관련 Day 학습자료 재확인
- [ ] 가장 약한 유형 3개 메모 → 주말에 집중 복습

---

> **내일 Day 8 예고**: 이론 용어 총정리 (기출 빈출 약어 + 핵심 개념 150선)
>
> **참고 링크**:
> - [C언어 기출변형 문제](https://fullmoon-system.com/%EC%A0%95%EB%B3%B4%EC%B2%98%EB%A6%AC%EA%B8%B0%EC%82%AC-%EC%8B%A4%EA%B8%B0-c%EC%96%B8%EC%96%B4-%EC%BD%94%EB%94%A9-%EA%B8%B0%EC%B6%9C%EB%B3%80%ED%98%95-%EB%AC%B8%EC%A0%9C-1/)
> - [시나공 기출](https://www.sinagong.co.kr/pds/001001002/past-exams)
> - [뉴비티 CBT](https://newbt.kr/시험/정보처리기사%20실기)
