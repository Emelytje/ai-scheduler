"use client";

import { useMemo } from "react";
import { ApiClient } from "@/lib/client/api-client";
import { DemoClient } from "@/lib/client/demo-client";
import { SchedulerApp } from "./SchedulerApp";

export function DemoApp({ variant = "full" }: { variant?: "full" | "embed" }) {
  const client = useMemo(() => new DemoClient(), []);
  return <SchedulerApp client={client} variant={variant} />;
}

export function LiveApp({ variant = "full", token = null }: { variant?: "full" | "embed"; token?: string | null }) {
  const client = useMemo(() => new ApiClient("", token), [token]);
  return (
    <SchedulerApp
      client={client}
      variant={variant}
      connectUrl={variant === "full" ? "/api/google/connect" : undefined}
      onDisconnect={
        variant === "full"
          ? async () => {
              const res = await fetch("/api/google/disconnect", { method: "POST" });
              if (!res.ok) throw new Error("Couldn't disconnect Google Calendar. Try again.");
            }
          : undefined
      }
      refreshMs={2 * 60_000}
      headerExtra={
        variant === "full" ? (
          <div className="as-row">
            <a className="as-btn is-ghost" href="/developers">
              Integrations
            </a>
            <form action="/auth/signout" method="post">
              <button className="as-btn is-ghost">Sign out</button>
            </form>
          </div>
        ) : null
      }
    />
  );
}
