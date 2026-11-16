"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/lib/api";
import { Zap, Lock, Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(""); setLoading(true);
    try { await login(pw); router.push("/"); router.refresh(); }
    catch (err) { setError((err as Error).message || "Invalid password"); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "#070d1a", position: "relative", overflow: "hidden" }}>
      {/* Background */}
      <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,.04) 1px, transparent 0)", backgroundSize: "28px 28px", pointerEvents: "none" }} />
      <div style={{ position: "absolute", top: "30%", left: "50%", transform: "translateX(-50%)", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle,rgba(59,130,246,.12),transparent 70%)", pointerEvents: "none" }} />

      <div style={{ position: "relative", width: "100%", maxWidth: 360, animation: "up .4s cubic-bezier(.16,1,.3,1)" }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: "linear-gradient(135deg,#3b82f6,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", boxShadow: "0 0 40px rgba(59,130,246,.4)" }}>
            <Zap size={26} color="#fff" strokeWidth={2.5} />
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#f1f5f9", margin: "0 0 6px", letterSpacing: "-.04em" }}>Scraper Premium</h1>
          <p style={{ fontSize: 12, color: "#4a6070", margin: 0 }}>Sign in to your dashboard</p>
        </div>

        {/* Card */}
        <div style={{ background: "rgba(13,21,36,.9)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 16, padding: 24, backdropFilter: "blur(20px)", boxShadow: "0 24px 48px rgba(0,0,0,.5)" }}>
          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={{ display: "block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "#7a90a8", marginBottom: 7 }}>Admin Password</label>
              <div style={{ position: "relative" }}>
                <Lock size={13} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "#3d5068" }} />
                <input type={show ? "text" : "password"} value={pw} onChange={e => setPw(e.target.value)} placeholder="Enter your password" autoFocus required
                  style={{ width: "100%", background: "#060b12", border: "1px solid #1e2d42", borderRadius: 10, padding: "10px 38px", fontSize: 13, color: "#f1f5f9", outline: "none", transition: "border .15s" }}
                  onFocus={e => { e.currentTarget.style.borderColor = "#3b82f6"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(59,130,246,.15)" }}
                  onBlur={e => { e.currentTarget.style.borderColor = "#1e2d42"; e.currentTarget.style.boxShadow = "none" }} />
                <button type="button" tabIndex={-1} onClick={() => setShow(v => !v)} style={{ position: "absolute", right: 11, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#3d5068", cursor: "pointer", padding: 0 }}>
                  {show ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {error && <div style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(244,63,94,.1)", border: "1px solid rgba(244,63,94,.25)", fontSize: 11, color: "#fda4af" }}>{error}</div>}

            <button type="submit" disabled={loading || !pw} style={{ padding: "11px", borderRadius: 10, background: "linear-gradient(to bottom,#3b82f6,#2563eb)", color: "#fff", border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 4px 14px rgba(37,99,235,.4)", opacity: loading || !pw ? 0.5 : 1, transition: "opacity .15s" }}>
              {loading ? <span style={{ width: 15, height: 15, border: "2px solid #fff", borderTopColor: "transparent", borderRadius: "50%", animation: "spin .7s linear infinite" }} /> : <Zap size={14} strokeWidth={2.5} />}
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </form>

          <p style={{ marginTop: 18, textAlign: "center", fontSize: 10, color: "#3d5068", lineHeight: 1.6 }}>
            Set <code style={{ color: "#4a6070", fontFamily: "'JetBrains Mono',monospace" }}>ADMIN_PASSWORD</code> in .env to require login.
            Default <code style={{ color: "#4a6070", fontFamily: "'JetBrains Mono',monospace" }}>changeme</code> disables auth.
          </p>
        </div>
      </div>
    </div>
  );
}
