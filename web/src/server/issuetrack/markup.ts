/**
 * Redmine 본문(Textile) → 안전한 HTML.
 *
 * Redmine 이슈 설명 · 코멘트는 Textile 이다. 그대로 뿌리면 `*`, `|_. 항목 |` 같은 기호가 날것으로 보인다.
 * textile-js 로 바꾸되 Redmine 고유 표기 세 가지는 변환 전에 손본다.
 *   · `!image.png!`      — 첨부 그림. 파일을 받아 오지 않으므로 파일명 표시로 바꾼다.
 *   · `attachment:파일명`  — 같은 이유로 파일명만 남긴다.
 *   · `#33907`           — Redmine 처럼 이슈 링크로 만든다(걸러 낸 뒤에).
 * 변환 결과는 sanitize-html 로 거른다 — 사외에서 들어온 텍스트가 섞이는 자리다.
 */
import sanitizeHtml from "sanitize-html";
import textile from "textile-js";

const ALLOWED_TAGS = [
  "p", "br", "div", "span",
  "ul", "ol", "li", "dl", "dt", "dd",
  "strong", "b", "em", "i", "del", "ins", "sub", "sup",
  "code", "pre", "blockquote",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "table", "thead", "tbody", "tr", "th", "td", "caption", "colgroup", "col",
  "a", "hr",
];

const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: { a: ["href", "title", "target", "rel"], "*": ["class"] },
  allowedSchemes: ["http", "https", "mailto"],
  transformTags: {
    a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, rel: "noopener noreferrer" } }),
  },
};

//: !파일명.png! — 앞뒤에 다른 글자가 붙지 않은 경우만
const IMG = /!([^!\s|]+\.(?:png|jpe?g|gif|bmp|webp|svg))!/gi;
const ATTACHMENT = /\battachment:([^\s,)]+)/g;
//: 이슈 번호. 4자리 이상만. 앞에 & 가 오면 HTML 엔티티(&#8220; 등)라 뺀다.
const ISSUE_REF = /(?<![\w#&])#(\d{4,6})\b/g;

function preTextile(text: string): string {
  return (
    text
      .replace(IMG, (_m, f) => `[첨부: ${f}]`)
      .replace(ATTACHMENT, (_m, f) => `[첨부: ${f}]`)
      // 문단 중간에 빈 줄 없이 들어온 <pre> 를 textile-js 는 글자로 이스케이프한다 — 블록이 되게 빈 줄로 띄운다.
      .replace(/\n*<pre>/g, "\n\n<pre>")
      .replace(/<\/pre>\n*/g, "</pre>\n\n")
  );
}

/** #33907 → Redmine 링크. 이미 <a> 안에 있는 것과 태그 안은 건드리지 않는다. */
function linkIssues(html: string, base: string): string {
  if (!base) return html;
  const parts = html.split(/(<a\b[^>]*>[\s\S]*?<\/a>|<[^>]+>)/);
  return parts
    .map((p) =>
      p.startsWith("<")
        ? p
        : p.replace(ISSUE_REF, (_m, n) => `<a href="${base}/issues/${n}" target="_blank" rel="noopener">#${n}</a>`),
    )
    .join("");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Textile 본문 → 안전한 HTML. 변환에 실패해도 원문은 반드시 보여 준다. base 는 Redmine 주소(이슈 링크용). */
export function render(text: string | null | undefined, base = ""): string {
  // Redmine 본문은 CRLF 다 — textile-js 는 \r 이 붙은 <pre> 블록을 알아보지 못해 줄바꿈을 먼저 맞춘다.
  const src = (text || "").replace(/\r\n?/g, "\n").trim();
  if (!src) return "";
  let out: string;
  try {
    out = textile(preTextile(src));
  } catch {
    return `<pre style="white-space:pre-wrap;margin:0">${escapeHtml(src)}</pre>`;
  }
  out = sanitizeHtml(out, SANITIZE);
  // 이슈 링크는 거른 **뒤에** 만든다 — 숫자만 뽑아 우리가 만드는 <a> 라 다시 거를 필요가 없다.
  return linkIssues(out, base);
}
