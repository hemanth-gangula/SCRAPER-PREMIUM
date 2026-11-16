"use client";
import { useEffect, useRef, useState } from "react";

export interface SSEPayload {
  job_id:string; status?:string; records_saved?:number; dupes_skipped?:number;
  progress_pct?:number; current_index?:number; current_business?:string|null;
  last_error?:string|null; heartbeat?:boolean; error?:string;
}

export function useSSE(jobId:string|null) {
  const [evt, setEvt] = useState<SSEPayload|null>(null);
  const [live, setLive] = useState(false);
  const ref = useRef<EventSource|null>(null);

  useEffect(()=>{
    if (!jobId) return;
    const BASE = process.env.NEXT_PUBLIC_API_BASE_URL??"http://localhost:5000";
    const es = new EventSource(`${BASE}/api/events/${jobId}`);
    ref.current = es;
    es.onopen = ()=>setLive(true);
    es.onerror = ()=>setLive(false);
    es.onmessage = (e)=>{
      try {
        const d:SSEPayload = JSON.parse(e.data);
        if (!d.heartbeat) setEvt(d);
        if (d.status && ["completed","failed","cancelled"].includes(d.status)) { es.close(); setLive(false); }
      } catch {}
    };
    return ()=>{ es.close(); setLive(false); };
  },[jobId]);

  return { evt, live };
}
