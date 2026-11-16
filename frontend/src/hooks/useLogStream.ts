"use client";
import { useEffect, useRef, useState } from "react";
import type { ActivityLog } from "@/lib/api";

export type StreamState = "idle"|"connecting"|"streaming"|"done"|"error";

export function useLogStream(jobId:string|null) {
  const [logs,  setLogs]  = useState<ActivityLog[]>([]);
  const [state, setState] = useState<StreamState>("idle");
  const [err,   setErr]   = useState<string|null>(null);
  const ref   = useRef<EventSource|null>(null);
  const seen  = useRef<Set<string>>(new Set());

  useEffect(()=>{
    if (!jobId) { setState("idle"); return; }
    ref.current?.close();
    seen.current.clear();
    setLogs([]); setErr(null); setState("connecting");
    const BASE = process.env.NEXT_PUBLIC_API_BASE_URL??"http://localhost:5000";
    const es = new EventSource(`${BASE}/api/logs/${jobId}/stream`);
    ref.current = es;
    es.onopen  = ()=>setState("streaming");
    es.onerror = ()=>{ setState("error"); setErr("Stream disconnected"); es.close(); };
    es.onmessage = (e)=>{
      try {
        const d = JSON.parse(e.data);
        if (d._heartbeat) return;
        if (d._stream_done) { setState("done"); es.close(); return; }
        const key = d.id||(d.timestamp+d.message);
        if (!seen.current.has(key)) { seen.current.add(key); setLogs(p=>[...p,d]); }
      } catch {}
    };
    return ()=>es.close();
  },[jobId]);

  function clear() { ref.current?.close(); setLogs([]); setState("idle"); setErr(null); seen.current.clear(); }
  return { logs, state, err, clear };
}
