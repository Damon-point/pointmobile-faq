/**
 * 비밀번호 해시(bcrypt) · 자격증명 암복호화(Fernet).
 *
 * Fernet 은 Python cryptography 의 형식을 그대로 구현한다 — 예전 앱(FastAPI)이 같은 FERNET_KEY 로
 * 암호화해 둔 Redmine · 메일 비밀번호를 옮겨 와도 그대로 풀린다.
 *   token = base64url( 0x80 | 시각(8) | IV(16) | AES-128-CBC 암호문 | HMAC-SHA256(32) )
 *   키(32바이트, base64url) = 서명 키 16 | 암호 키 16
 * 새 키: node -e "console.log(require('crypto').randomBytes(32).toString('base64url')+'=')"
 */
import bcrypt from "bcryptjs";
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";

// ── 로그인 비밀번호(단방향) ──────────────────────────────────────────────────────

export function hashPassword(pw: string): string {
  return bcrypt.hashSync(pw, 12);
}

export function verifyPassword(pw: string, hash: string): boolean {
  try {
    return bcrypt.compareSync(pw, hash || "");
  } catch {
    return false;
  }
}

/** 인증번호 · 확인 토큰처럼 원문을 두지 않는 값의 해시. */
export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

// ── 자격증명(양방향) ─────────────────────────────────────────────────────────────

function keys(): { sign: Buffer; enc: Buffer } {
  const raw = process.env.FERNET_KEY;
  if (!raw) throw new Error("FERNET_KEY 가 설정되지 않았습니다 — 배포 환경변수에 넣으세요");
  const k = Buffer.from(raw.trim(), "base64url");
  if (k.length !== 32) throw new Error("FERNET_KEY 형식이 맞지 않습니다(32바이트 base64url)");
  return { sign: k.subarray(0, 16), enc: k.subarray(16) };
}

export function encryptSecret(plain: string): string {
  const { sign, enc } = keys();
  const iv = randomBytes(16);
  const c = createCipheriv("aes-128-cbc", enc, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  const ts = Buffer.alloc(8);
  ts.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000)));
  const head = Buffer.concat([Buffer.from([0x80]), ts, iv, ct]);
  const mac = createHmac("sha256", sign).update(head).digest();
  // Python 쪽과 같이 '=' 채움을 붙인 urlsafe base64.
  const b = Buffer.concat([head, mac]).toString("base64url");
  return b + "=".repeat((4 - (b.length % 4)) % 4);
}

export function decryptSecret(token: string): string {
  const { sign, enc } = keys();
  const data = Buffer.from((token || "").trim(), "base64url");
  if (data.length < 1 + 8 + 16 + 16 + 32 || data[0] !== 0x80) throw new Error("Fernet 토큰이 아닙니다");
  const head = data.subarray(0, data.length - 32);
  const mac = data.subarray(data.length - 32);
  const want = createHmac("sha256", sign).update(head).digest();
  if (!timingSafeEqual(mac, want)) throw new Error("Fernet 서명이 맞지 않습니다(FERNET_KEY 가 다름)");
  const iv = head.subarray(9, 25);
  const ct = head.subarray(25);
  const d = createDecipheriv("aes-128-cbc", enc, iv);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}
