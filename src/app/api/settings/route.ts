import { requireUser } from "@/lib/server/auth";
import { json, route, settingsPatchSchema } from "@/lib/server/http";
import { replanForUser } from "@/lib/server/planner";
import { Store } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export const PATCH = route(async (req: Request) => {
  const user = await requireUser(req);
  const patch = settingsPatchSchema.parse(await req.json());
  const store = new Store(user.id);
  await store.saveSettings({ ...(await store.getSettings()), ...patch });
  return json(await replanForUser(user.id, { trigger: "settings", sync: "never" }));
});
