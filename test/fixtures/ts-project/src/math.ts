export function add(a: number, b: number): number {
  return a + b;
}

export function double(n: number): number {
  return add(n, n);
}

export function unusedHelper(): void {}

export class Calculator {
  compute(x: number): number {
    return double(x);
  }
}
