"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export function useApi<T>(
  fn: () => Promise<T>,
  deps: unknown[] = [],
  opts: { poll?: number } = {},
) {
  const [data,    setData]    = useState<T|null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string|null>(null);
  const alive = useRef(true);

  const run = useCallback(async () => {
    setLoading(true); setError(null);
    try   { const r = await fn(); if(alive.current) setData(r); }
    catch (e) { if(alive.current) setError((e as Error).message); }
    finally   { if(alive.current) setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    alive.current = true;
    run();
    let t: ReturnType<typeof setInterval>|undefined;
    if (opts.poll) t = setInterval(run, opts.poll);
    return () => { alive.current=false; clearInterval(t); };
  }, [run, opts.poll]);

  return { data, loading, error, refresh: run };
}
