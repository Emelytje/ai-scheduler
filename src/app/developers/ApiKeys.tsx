"use client";

import { useCallback, useEffect, useState } from "react";

interface Key {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
}

export function ApiKeys() {
  const [keys, setKeys] = useState<Key[]>([]);
  const [name, setName] = useState("Seller app");
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/keys");
    const body = await res.json();
    if (res.ok) setKeys(body.keys);
    else setError(body.error);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch("/api/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    const body = await res.json();
    if (!res.ok) return setError(body.error);
    setFresh(body.key);
    load();
  };

  const revoke = async (id: string) => {
    await fetch(`/api/keys/${id}`, { method: "DELETE" });
    setConfirming(null);
    load();
  };

  return (
    <section className="as-panel" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <h2 style={{ margin: 0, fontSize: 15 }}>API keys</h2>
      <form onSubmit={create} className="as-row">
        <input id="key-name" className="as-input" style={{ maxWidth: 260 }} value={name} onChange={(e) => setName(e.target.value)} aria-label="Key name" />
        <button className="as-btn is-primary">Create key</button>
      </form>
      {fresh && (
        <div className="as-banner">
          <strong>Copy this key now; it won't be shown again:</strong>
          <code style={{ overflowWrap: "anywhere" }}>{fresh}</code>
        </div>
      )}
      {error && <div className="as-banner is-error">{error}</div>}
      {keys.length === 0 ? (
        <p className="as-hint" style={{ margin: 0 }}>No keys yet.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {keys.map((k) => (
            <li key={k.id} className="as-row" style={{ borderTop: "1px solid var(--line)", padding: "8px 0" }}>
              <strong>{k.name}</strong>
              <code className="as-hint">{k.key_prefix}…</code>
              <span className="as-hint">{k.last_used_at ? `used ${new Date(k.last_used_at).toLocaleString()}` : "never used"}</span>
              {confirming === k.id ? (
                <>
                  <button className="as-btn is-danger is-small" onClick={() => revoke(k.id)}>
                    Revoke
                  </button>
                  <button className="as-btn is-small" onClick={() => setConfirming(null)}>
                    Keep
                  </button>
                </>
              ) : (
                <button className="as-btn is-ghost is-small" style={{ marginLeft: "auto" }} onClick={() => setConfirming(k.id)}>
                  Revoke…
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
