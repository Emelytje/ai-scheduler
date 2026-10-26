import { requireUser } from "@/lib/server/auth";
import { disconnect } from "@/lib/server/google";
import { json, route } from "@/lib/server/http";
import { Store } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  const user = await requireUser(req);
  await disconnect(new Store(user.id));
  return json({ ok: true });
});
