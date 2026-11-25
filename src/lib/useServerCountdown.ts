import { useEffect, useRef, useState } from 'react';

export function useServerCountdown(
  deadlineTimestamp: number | null | undefined,
  serverTime: number | null | undefined,
  isPaused: boolean,
  pausedRemainingMs?: number | null,
): number {
  const offsetRef = useRef<number>(0);
  const [remainingMs, setRemainingMs] = useState<number>(0);

  useEffect(() => {
    if (typeof serverTime === 'number' && serverTime > 0) {
      offsetRef.current = serverTime - Date.now();
    }
  }, [serverTime]);

  useEffect(() => {
    if (isPaused) {
      setRemainingMs(Math.max(0, pausedRemainingMs ?? 0));
      return;
    }
    if (!deadlineTimestamp) {
      setRemainingMs(0);
      return;
    }

    const compute = () => {
      const estimatedServerNow = Date.now() + offsetRef.current;
      return Math.max(0, deadlineTimestamp - estimatedServerNow);
    };

    setRemainingMs(compute());
    const interval = setInterval(() => {
      setRemainingMs(compute());
    }, 100);

    return () => clearInterval(interval);
  }, [deadlineTimestamp, isPaused, pausedRemainingMs]);

  return remainingMs;
}
