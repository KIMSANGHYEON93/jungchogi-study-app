# 코드 트레이싱 & SQL 집중 드릴 (40문제)

> **목적**: 시험에서 가장 배점 높고 실수 잦은 코드/SQL 문제 집중 훈련
> **방법**: 문제 → 손으로 변수 추적표 작성 → 정답 확인 → 함정 포인트 체크
> **목표 시간**: 코드 1문제 3~5분, SQL 1문제 2~3분

---

## Part 1. C언어 (10문제)

### C-01. 포인터 기본

```c
#include <stdio.h>
int main() {
    int a = 10, b = 20;
    int *p = &a;
    *p = *p + b;
    p = &b;
    *p = *p + a;
    printf("%d %d", a, b);
    return 0;
}
```

<details>
<summary>정답 및 풀이</summary>

```
추적표:
a=10, b=20, p=&a
*p = *p + b → *p = 10+20 = 30 → a=30
p = &b → p가 b를 가리킴
*p = *p + a → *p = 20+30 = 50 → b=50

출력: 30 50
```
**함정**: `*p + b`에서 a가 30으로 바뀐 뒤, 이후 `*p + a`의 a는 이미 30임
</details>

---

## Part 2. Java (10문제)

### J-01. 상속 + 오버라이딩

```java
class A {
    int x = 10;
    String f() { return "A"; }
}
class B extends A {
    int x = 20;
    String f() { return "B"; }
}
public class Main {
    public static void main(String[] args) {
        A obj = new B();
        System.out.println(obj.x + " " + obj.f());
    }
}
```

<details>
<summary>정답 및 풀이</summary>

```
A obj = new B();  ← 부모 타입, 자식 객체

obj.x   → 변수는 부모 기준 = 10
obj.f() → 메서드는 자식 오버라이딩 = "B"

출력: 10 B
```
**최다출제 함정**: 변수=선언타입(부모), 메서드=실제객체(자식). 반드시 구분!
</details>

---

## Part 4. SQL (10문제)

### S-01. GROUP BY + HAVING

```
테이블: 사원(이름, 부서, 급여)
| 이름 | 부서 | 급여 |
|------|------|------|
| 김 | 개발 | 400 |
| 이 | 개발 | 300 |
| 박 | 인사 | 350 |
| 정 | 개발 | 500 |
| 최 | 인사 | 250 |
```

```sql
SELECT 부서, COUNT(*) AS 인원, AVG(급여) AS 평균
FROM 사원
GROUP BY 부서
HAVING COUNT(*) >= 3;
```

<details>
<summary>정답 및 풀이</summary>

```
① GROUP BY 부서:
   개발: 김(400), 이(300), 정(500) → 3명
   인사: 박(350), 최(250) → 2명

② HAVING COUNT(*) >= 3:
   개발: 3 >= 3 → O
   인사: 2 >= 3 → X (제외)

결과:
| 부서 | 인원 | 평균 |
|------|------|------|
| 개발 | 3 | 400 |
```
**함정**: AVG(급여) = (400+300+500)/3 = 400. HAVING은 그룹 후 필터
</details>

---

