/**
 * 연속 클릭 방지: 요청이 끝나기 전에 다시 부르면 실행하지 않고 null을 돌려준다 (화면 상태 갱신 전에 들어온 두 번째 클릭 포함).
 * 서버도 같은 날짜·장비의 겹치는 슬롯은 409로 거부하지만, 불필요한 POST를 보내지 않기 위해 화면에서 먼저 막는다.
 */
export function createSubmitLock() {
  let running = false;
  return {
    get running() {
      return running;
    },
    async run<T>(task: () => Promise<T>): Promise<T | null> {
      if (running) return null;
      running = true;
      try {
        return await task();
      } finally {
        running = false;
      }
    },
  };
}
