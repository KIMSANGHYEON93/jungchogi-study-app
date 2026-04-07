# Day 2 - Java 클래스, 상속, 오버라이딩

> **날짜**: 2026.04.05 (일) 14:00~19:00
> **목표**: Java 객체지향 핵심 + 기출 코드 트레이싱
> **학습 후 체크**: [ ] 이론 이해  [ ] 기출 8문제+  [ ] 오답 정리

---

## PART 1: 클래스와 객체 핵심

### 1-1. 클래스 기본 구조

```java
class Student {
    String name;
    int score;

    Student(String name, int score) {
        this.name = name;
        this.score = score;
    }

    void display() {
        System.out.println(name + " : " + score);
    }
}

Student s = new Student("Kim", 90);
s.display();   // Kim : 90
```

### 1-2. 접근 제어자

| 제어자 | 같은 클래스 | 같은 패키지 | 자식 클래스 | 전체 |
|--------|:-----------:|:-----------:|:-----------:|:----:|
| `public` | O | O | O | O |
| `protected` | O | O | O | X |
| `(default)` | O | O | X | X |
| `private` | O | X | X | X |

> **시험 포인트**: `private` 멤버는 자식 클래스에서도 직접 접근 불가!

### 1-3. static 키워드

```java
class Counter {
    static int count = 0;    // 클래스 변수 (모든 객체 공유)
    int id;                  // 인스턴스 변수 (객체마다 별도)

    static int getCount() {
        return count;
        // return id;  ← 에러! static에서 인스턴스 변수 접근 불가
    }
}
```

> **시험 함정**: `static` 메서드에서 인스턴스 변수/메서드 접근 → **컴파일 에러!**

---

## PART 2: 상속 핵심

### 2-1. 상속 기본

```java
class Parent {
    int x = 10;
    void show() { System.out.println("Parent: " + x); }
}

class Child extends Parent {
    int y = 20;
    void display() { System.out.println("Child: " + x + ", " + y); }
}
```

### 2-2. super 키워드

```java
super(값)       // 부모 생성자 호출 (반드시 생성자 첫 줄!)
super.메서드()   // 부모 메서드 호출
super.변수      // 부모 변수 접근
```

### 2-3. 생성자 호출 순서 (최빈출!)

```
new Child()
  → Child() → this(5000)
    → Child(5000) → 암묵적 super()
      → Parent() → this(500)
        → Parent(500) → Parent.x = 500
    → Child.x = 5000

결론: 부모와 자식의 같은 이름 변수는 별개!
getX()가 Parent 소속이면 → Parent.x 반환
```

### 2-4. this vs super 비교

| 키워드 | 의미 | 사용 |
|--------|------|------|
| `this` | 현재 객체 | `this.변수`, `this()` |
| `super` | 부모 객체 | `super.변수`, `super()` |

---

## PART 3: 오버라이딩 vs 오버로딩

### 3-1. 비교 정리

| 구분 | 오버라이딩 (Overriding) | 오버로딩 (Overloading) |
|------|------------------------|----------------------|
| 의미 | 부모 메서드 **재정의** | 같은 이름, **다른 매개변수** |
| 관계 | 상속 관계 필요 | 같은 클래스 내 |
| 메서드명 | 동일 | 동일 |
| 매개변수 | **동일** | **다름** |
| 리턴타입 | 동일 | 무관 |

### 3-2. 다형성 핵심 규칙

```java
Parent obj = new Child();  // 부모 타입, 자식 객체
```

| 호출 대상 | 결과 |
|-----------|------|
| 오버라이딩된 메서드 | **자식** 메서드 실행 |
| 오버라이딩 안 된 메서드 | 부모 메서드 실행 |
| 자식에만 있는 메서드 | **컴파일 에러** |
| 같은 이름 변수 | **부모** 변수 사용 |

---

## PART 4: 추상 클래스와 인터페이스

### 4-1. 추상 클래스

```java
abstract class Shape {
    abstract double area();    // 구현부 없음 → 자식이 반드시 구현
    void show() { }            // 일반 메서드도 가능
}
```

### 4-2. 인터페이스

```java
interface Printable {
    void print();              // public abstract 생략
}
class Doc implements Printable {
    public void print() { System.out.println("출력"); }
}
```

### 4-3. 비교

| 구분 | 추상 클래스 | 인터페이스 |
|------|------------|-----------|
| 키워드 | `extends` | `implements` |
| 상속 | 단일 상속 | 다중 구현 가능 |
| 변수 | 모든 변수 가능 | 상수(final)만 |
| 메서드 | 추상+일반 | 추상 중심 |

---

## PART 5: 기출 코드 트레이싱 (직접 풀어보기!)

---

### 문제 1 (오버라이딩 + 재귀) ★★★★★

```java
class Parent {
    int compute(int num) {
        if (num <= 1) return num;
        return compute(num-1) + compute(num-2);
    }
}
class Child extends Parent {
    int compute(int num) {
        if (num <= 1) return num;
        return compute(num-1) + compute(num-3);
    }
}
public class Main {
    public static void main(String[] args) {
        Parent obj = new Child();
        System.out.print(obj.compute(4));
    }
}
```

**트레이싱:**
```
compute(4) = compute(3) + compute(1)
compute(3) = compute(2) + compute(0)
compute(2) = compute(1) + compute(-1)

compute(1)=___, compute(0)=___, compute(-1)=___
compute(2)=___, compute(3)=___, compute(4)=___

출력: ___
```

---

### 문제 2 (super + 상속) ★★★

```java
class A {
    private int a;
    public A(int a) { this.a = a; }
    public void display() { System.out.println("a=" + a); }
}
class B extends A {
    public B(int a) {
        super(a);
        super.display();
    }
}
public class Main {
    public static void main(String[] args) {
        B obj = new B(10);
    }
}
```

**나의 답:** ___________

---

### 문제 3 (추상클래스 + 오버로딩) ★★★★

```java
abstract class Vehicle {
    String name;
    abstract public String getName(String val);
    public String getName() {
        return "Vehicle name: " + name;
    }
}
class Car extends Vehicle {
    public Car(String val) { name = val; }
    public String getName(String val) {
        return "Car name: " + val;
    }
}
public class Main {
    public static void main(String[] args) {
        Vehicle obj = new Car("Spark");
        System.out.println(obj.getName());
    }
}
```

**포인트: 매개변수 없는 `getName()`은 어디에?**

나의 답: ___________________________

---

### 문제 4 (생성자 체이닝) ★★★★★

```java
class Parent {
    int x = 100;
    Parent() { this(500); }
    Parent(int x) { this.x = x; }
    int getX() { return x; }
}
class Child extends Parent {
    int x = 4000;
    Child() { this(5000); }
    Child(int x) { this.x = x; }
}
public class Main {
    public static void main(String[] args) {
        Child obj = new Child();
        System.out.println(obj.getX());
    }
}
```

**트레이싱:**
```
Child() → this(5000) → Child(5000)
  → 암묵적 super() → Parent() → this(500) → Parent(500)
    → Parent.x = ___
  → Child.x = ___

getX()는 Parent 소속 → return Parent.x = ___

출력: ___
```

---

### 문제 5 (싱글톤 패턴) ★★★★

```java
class Connection {
    private static Connection _inst = null;
    private int count = 0;
    static public Connection get() {
        if (_inst == null) { _inst = new Connection(); }
        return _inst;
    }
    public void count() { count++; }
    public int getCount() { return count; }
}
public class Main {
    public static void main(String[] args) {
        Connection c1 = Connection.get();
        c1.count();
        Connection c2 = Connection.get();
        c2.count();
        Connection c3 = Connection.get();
        c3.count();
        System.out.print(c1.getCount());
    }
}
```

**c1, c2, c3는 같은 객체? ___ → 출력: ___**

---

### 문제 6 (상속 + super.메서드) ★★★★

```java
class ovr1 {
    int san(int x, int y) { return x + y; }
}
class ovr2 extends ovr1 {
    int san(int x, int y) {
        return x - y + super.san(x, y);
    }
}
public class Main {
    public static void main(String[] args) {
        ovr1 a1 = new ovr1();
        ovr1 a2 = new ovr2();
        System.out.println(a1.san(3,2) + a2.san(3,2));
    }
}
```

**트레이싱:**
```
a1.san(3,2) = ___
a2.san(3,2) = 3 - 2 + super.san(3,2) = 1 + ___ = ___
합계: ___ + ___ = ___

출력: ___
```

---

### 문제 7 (String 메서드) ★★★

```java
public class Main {
    public static void main(String[] args) {
        String str = "Programming";
        System.out.println(str.length());
        System.out.println(str.charAt(3));
        System.out.println(str.substring(2, 6));
        System.out.println(str.indexOf("gram"));
        System.out.println(str.toUpperCase());
    }
}
```

**인덱스: P(0) r(1) o(2) g(3) r(4) a(5) m(6) m(7) i(8) n(9) g(10)**

나의 답:
```
___
___
___
___
___
```

---

### 문제 8 (비트/논리 연산) ★★★★

```java
public class Main {
    public static void main(String[] args) {
        int a=3, b=4, c=3, d=5;
        if ((a==2 | a==c) & !(c>d) & (1==b ^ c!=d)) {
            a = b + c;
            if (7==b ^ c!=a) {
                System.out.println(a);
            } else {
                System.out.println(b);
            }
        } else {
            a = c + d;
            if (7==c ^ c!=a) {
                System.out.println(a);
            } else {
                System.out.println(d);
            }
        }
    }
}
```

**트레이싱:**
```
| → OR (둘 다 평가)
& → AND (둘 다 평가)
^ → XOR (다르면 true)

(a==2 | a==c) = (F | T) = ___
!(c>d) = !(F) = ___
(1==b ^ c!=d) = (F ^ T) = ___
전체 = ___ & ___ & ___ = ___

→ ___ 블록 진입
a = ___, 내부 조건 = ___

출력: ___
```

---

## PART 6: 정답 & 해설

<details>

### 문제 1 정답: `1`
Child.compute(4) = compute(3) + compute(1) = 0 + 1 = 1
- compute(2) = compute(1) + compute(-1) = 1 + (-1) = 0
- compute(3) = compute(2) + compute(0) = 0 + 0 = 0

### 문제 2 정답: `a=10`
B(10) → super(10) → A.a=10 → super.display() → "a=10"

### 문제 3 정답: `Vehicle name: Spark`
매개변수 없는 getName()은 Car에 없음 → 부모의 getName() 실행

### 문제 4 정답: `500`
Parent.x=500, Child.x=5000. getX()는 Parent 소속 → 500 반환

### 문제 5 정답: `3`
싱글톤: 모두 같은 객체. count 3번 증가 → 3

### 문제 6 정답: `11`
a1.san(3,2)=5, a2.san(3,2)=1+5=6, 합계=11

### 문제 7 정답:
```
11
g
ogra
3
PROGRAMMING
```
substring(2,6): 인덱스 2~5 (6 미포함) → "ogra"

### 문제 8 정답: `7`
조건 true → a=b+c=7, (7==b ^ c!=a)=(F^T)=T → println(a) → 7

</details>

---

## Day 2 학습 완료 체크리스트

- [ ] PART 1~4 이론 읽기 완료
- [ ] PART 5 문제 8개 종이에 직접 풀기
- [ ] 틀린 문제 해설 확인 + 오답 원인 메모
- [ ] 핵심 암기: 오버라이딩 vs 오버로딩
- [ ] 핵심 암기: `Parent obj = new Child()` 다형성 규칙
- [ ] 핵심 암기: 생성자 호출 순서 (this → super)
- [ ] 핵심 암기: `static` 제약사항

---

> **내일 Day 3 예고**: Python 기초 + SQL 기본 (SELECT, JOIN)
>
> **참고 링크**:
> - [김테드 Java 기출 모음](https://idkim97.github.io/2024-03-28-%EC%A0%95%EB%B3%B4%EC%B2%98%EB%A6%AC%EA%B8%B0%EC%82%AC%20%EC%8B%A4%EA%B8%B0%20Java%20%EB%AC%B8%EC%A0%9C%20%EB%AA%A8%EC%9D%8C/)
> - [Velog Java 기출 (2020~2023)](https://velog.io/@mjieun/정보처리기사-프로그래밍-언어-기출-문제-모음2020년-1회-2023년-1회-자바)
> - [시나공 기출](https://www.sinagong.co.kr/pds/001001002/past-exams)
> - [뉴비티 CBT](https://newbt.kr/시험/정보처리기사%20실기)
