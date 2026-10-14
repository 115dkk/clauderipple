import { useEffect, useRef, useState } from 'react';

/** Only growing live text is paced. History/remounts and corrections paint immediately. */
export function useTextReveal(text: string, streaming: boolean): string {
  const [shown, setShown] = useState(text);
  const previous = useRef(text);
  const target = useRef(text);
  const count = useRef(text.length);
  useEffect(() => {
    const growing = text.startsWith(previous.current);
    previous.current = text;
    target.current = text;
    if (!streaming || !growing) { count.current = text.length; setShown(text); return; }
    let frame = 0, last = performance.now();
    const start = last, from = count.current;
    const tick = (now: number) => {
      const elapsed = now - last;
      if (elapsed >= 1000 / 60) {
        last = now;
        count.current = Math.floor(from + (target.current.length - from) * Math.min(1, (now - start) / 150));
        // Do not paint half a surrogate pair. Preserve the monotonic progress counter.
        let end = count.current;
        const char = target.current.charCodeAt(end - 1);
        if (end < target.current.length && char >= 0xd800 && char <= 0xdbff) end--;
        setShown(target.current.slice(0, end));
      }
      if (count.current < target.current.length) frame = requestAnimationFrame(tick);
    };
    if (count.current < text.length) frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, streaming]);
  return streaming && text.startsWith(shown) ? shown : text;
}
