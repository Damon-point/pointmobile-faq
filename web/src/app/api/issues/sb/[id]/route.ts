import { paramInt, route } from "@/server/http";
import { requireUser } from "@/server/session";
import { loadDocFor } from "@/server/issuetrack/api";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, ctx) => loadDocFor(await requireUser(), await paramInt(ctx, "id")));
