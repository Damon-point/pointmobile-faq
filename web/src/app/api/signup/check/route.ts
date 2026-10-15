import { q, route } from "@/server/http";
import { emailStatus, idStatus } from "@/server/signupVerify";

export const dynamic = "force-dynamic";

/** ID · 이메일 중복 확인 — 준 것만 확인한다. */
export const GET = route(async (req) => {
  const out: Record<string, { ok: boolean; message: string }> = {};
  const username = q(req, "username"), email = q(req, "email");
  if (username) {
    const [ok, message] = await idStatus(username);
    out.username = { ok, message };
  }
  if (email) {
    const [ok, message] = await emailStatus(email);
    out.email = { ok, message };
  }
  return out;
});
