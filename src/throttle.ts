/** Minimal async semaphore limiting how many tasks run at once. */
export class Throttle {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private limit: number) {}

  setLimit(limit: number): void {
    this.limit = Math.max(1, limit);
    this.drain();
  }

  run<T>(task: () => PromiseLike<T> | T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.active++;
        Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(() => {
            this.active--;
            this.drain();
          });
      };
      this.queue.push(start);
      this.drain();
    });
  }

  private drain(): void {
    while (this.active < this.limit && this.queue.length) {
      this.queue.shift()!();
    }
  }
}
