import { createRoot } from "react-dom/client";
import { SchedulerApp } from "@/components/SchedulerApp";
import { DemoClient } from "@/lib/client/demo-client";

// Standalone demo build: same UI and engine as the Next.js app, data in the browser.
const client = new DemoClient();
createRoot(document.getElementById("ai-scheduler-root")!).render(<SchedulerApp client={client} />);
