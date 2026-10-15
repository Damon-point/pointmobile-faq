/**
 * 저장된 journal 을 **사람이 읽는 타임라인**으로 바꾸고, 소요시간 지표를 유도한다.
 *
 * journal detail 은 값이 전부 문자열 id 다('97' → '207'). Lookup 표로 이름을 붙인다.
 * closed_on 은 쓰지 않는다 — 결측 · 역전이 많다. '언제 Resolved 되었나'는 status_id → Resolved 로 바뀐
 * journal 시각에서 유도한다.
 */
import { businessDays } from "./workdays";
import { byTime, lookupMaps, type IssueWithJournals, type JournalRow } from "./store";

export const FIELD_LABELS: Record<string, string> = {
  status_id: "상태",
  assigned_to_id: "담당자",
  priority_id: "우선순위",
  category_id: "카테고리",
  tracker_id: "트래커",
  fixed_version_id: "목표 버전",
  parent_id: "상위 이슈",
  project_id: "프로젝트",
  subject: "제목",
  description: "설명",
  done_ratio: "진행률",
  start_date: "시작일",
  due_date: "완료 기한",
  estimated_hours: "예상 공수",
  is_private: "비공개",
};

const ID_FIELDS: Record<string, string> = {
  status_id: "status",
  priority_id: "priority",
  tracker_id: "tracker",
  assigned_to_id: "user",
};

const RELATION_LABELS: Record<string, string> = {
  relates: "연관 이슈",
  copied_to: "복사해 만든 이슈",
  copied_from: "복사해 온 이슈",
  duplicates: "중복 이슈",
  duplicated: "중복된 이슈",
  blocks: "차단하는 이슈",
  blocked: "차단된 이슈",
  precedes: "선행 이슈",
  follows: "후행 이슈",
};

const EMPTY = "(없음)";

/** Lookup 표를 한 번만 읽어 재사용하는 이름 해석기. */
export class Naming {
  private constructor(private maps: Record<string, Record<string, string>>) {}

  static async load(): Promise<Naming> {
    return new Naming(await lookupMaps());
  }

  value(name: string | null, raw: string | null): string {
    if (raw === null || raw === undefined || raw === "") return EMPTY;
    const kind = ID_FIELDS[name || ""];
    if (kind) return this.maps[kind]?.[String(raw)] ?? `#${raw}`;
    return String(raw);
  }

  field(name: string | null): string {
    return FIELD_LABELS[name || ""] ?? (name || "");
  }

  customField(cfId: string | null): string {
    return this.maps.cf?.[String(cfId)] ?? `사용자 정의 필드 #${cfId}`;
  }

  /** 'Resolved' 같은 상태 이름 → id 문자열 집합. */
  statusIds(...names: string[]): Set<string> {
    const want = new Set(names.map((n) => n.toLowerCase()));
    return new Set(Object.entries(this.maps.status ?? {}).filter(([, v]) => want.has(v.toLowerCase())).map(([k]) => k));
  }
}

type Change = { label: string; old: string; new: string };

export class Event {
  changes: Change[] = [];
  attachments_added: string[] = [];
  attachments_removed: string[] = [];
  new_status = "";
  constructor(
    public at: Date | null,
    public who: string,
    public note = "",
    public is_creation = false,
  ) {}

  /** 화면 아이콘 · 색을 고르는 대분류. */
  get kind(): string {
    if (this.is_creation) return "created";
    if (this.new_status) return "status";
    if (this.attachments_added.length || this.attachments_removed.length) return "attachment";
    if (this.note) return "comment";
    return "field";
  }

  get summary(): string {
    const parts = this.changes.map((c) => `${c.label} ${c.old} → ${c.new}`);
    if (this.attachments_added.length) parts.push("첨부 추가: " + this.attachments_added.join(", "));
    if (this.attachments_removed.length) parts.push("첨부 삭제: " + this.attachments_removed.join(", "));
    return parts.join(" · ");
  }
}

export function eventOf(j: JournalRow, naming: Naming): Event {
  const ev = new Event(j.created_on, j.user_name || EMPTY, (j.notes || "").trim());
  for (const d of [...j.details].sort((a, b) => a.seq - b.seq)) {
    if (d.property === "attachment") {
      // name=첨부 id, 추가면 new_value 에, 삭제면 old_value 에 파일명이 온다.
      if (d.new_value) ev.attachments_added.push(d.new_value);
      else if (d.old_value) ev.attachments_removed.push(d.old_value);
      continue;
    }
    if (d.property === "cf") {
      ev.changes.push({ label: naming.customField(d.name), old: d.old_value || EMPTY, new: d.new_value || EMPTY });
      continue;
    }
    if (d.property === "relation") {
      const label = RELATION_LABELS[d.name || ""] ?? (d.name || "연결 이슈");
      if (d.new_value) ev.changes.push({ label, old: "추가", new: `#${d.new_value}` });
      else ev.changes.push({ label, old: "해제", new: `#${d.old_value}` });
      continue;
    }
    // 본문 · 제목 변경은 통짜 diff 가 실려 와 타임라인에 다 뿌리면 못 읽는다.
    if (d.name === "description" || d.name === "subject") {
      ev.changes.push({ label: naming.field(d.name), old: "(변경 전)", new: "(변경 후)" });
      continue;
    }
    const nv = naming.value(d.name, d.new_value);
    if (d.name === "status_id") ev.new_status = nv;
    ev.changes.push({ label: naming.field(d.name), old: naming.value(d.name, d.old_value), new: nv });
  }
  return ev;
}

/** 이슈 생성 + 이후 모든 journal 을 시간순 한 줄기로. */
export function timeline(issue: IssueWithJournals, naming: Naming): Event[] {
  const events = [new Event(issue.created_on, issue.author_name || EMPTY, (issue.description || "").trim(), true)];
  for (const j of [...issue.journals].sort(byTime)) events.push(eventOf(j, naming));
  return events;
}

// ── 첫 반응 유형 ────────────────────────────────────────────────────────────
//: 한 이벤트에 여러 가지가 섞여 있으면 위에서부터 먼저 걸리는 것 하나로 대표를 정한다.
export const ACTION_KINDS: Record<string, string> = {
  resolve: "바로 해결",
  analyze: "분석 착수",
  status: "상태 변경",
  comment: "코멘트",
  assign: "담당 배정",
  attach: "첨부",
  field: "기타 변경",
  empty: "내용 없음",
};
export const ACTION_ORDER = ["resolve", "analyze", "status", "comment", "assign", "attach", "field", "empty"];

function actionKind(j: JournalRow, naming: Naming): string {
  const done = naming.statusIds("Resolved", "Closed", "Rejected");
  const progress = naming.statusIds("InProgress");
  const hasNote = Boolean((j.notes || "").trim());
  const newStatus: string[] = [];
  const names = new Set<string>();
  const props = new Set<string>();
  for (const d of j.details) {
    props.add(d.property || "");
    if (d.property === "attachment") continue;
    names.add(d.name || "");
    if (d.name === "status_id" && d.new_value) newStatus.push(String(d.new_value));
  }
  if (newStatus.some((s) => done.has(s))) return "resolve";
  if (newStatus.some((s) => progress.has(s))) return "analyze";
  if (newStatus.length) return "status";
  if (hasNote) return "comment";
  if (names.has("assigned_to_id")) return "assign";
  if (props.has("attachment")) return "attach";
  if (names.size || props.size) return "field";
  return "empty";
}

// ── 소요시간 ───────────────────────────────────────────────────────────────
export type Timings = {
  created_at: Date | null;
  first_response_at: Date | null; // 작성자가 아닌 사람의 첫 코멘트
  first_action_at: Date | null; // 작성자 외 사람의 첫 이벤트
  first_action_kind: string;
  first_action_by: string;
  resolved_at: Date | null; // Resolved 로 바뀐 최초 시각
  last_resolved_at: Date | null; // Resolved 로 바뀐 마지막 시각(재해결 판단 기준)
  last_event_at: Date | null;
  reopened: number;
  participants: string[];
  comment_count: number;
  lead_workdays: number | null;
  first_action_workdays: number | null;
  first_response_workdays: number | null;
};

export function timings(issue: IssueWithJournals, naming: Naming): Timings {
  const doneIds = naming.statusIds("Resolved", "Closed");
  const resolvedIds = naming.statusIds("Resolved");
  const t: Timings = {
    created_at: issue.created_on,
    first_response_at: null,
    first_action_at: null,
    first_action_kind: "",
    first_action_by: "",
    resolved_at: null,
    last_resolved_at: null,
    last_event_at: null,
    reopened: 0,
    participants: [],
    comment_count: 0,
    lead_workdays: null,
    first_action_workdays: null,
    first_response_workdays: null,
  };
  let wasDone = false;
  const seen: string[] = [];
  for (const j of [...issue.journals].sort(byTime)) {
    if (j.created_on && (!t.last_event_at || j.created_on > t.last_event_at)) t.last_event_at = j.created_on;
    if (j.user_name && !seen.includes(j.user_name)) seen.push(j.user_name);
    const outsider = j.user_name !== issue.author_name;
    if ((j.notes || "").trim()) {
      t.comment_count++;
      if (!t.first_response_at && j.created_on && outsider) t.first_response_at = j.created_on;
    }
    if (!t.first_action_at && j.created_on && outsider) {
      t.first_action_at = j.created_on;
      t.first_action_kind = actionKind(j, naming);
      t.first_action_by = j.user_name || EMPTY;
    }
    for (const d of j.details) {
      if (d.name !== "status_id") continue;
      if (d.new_value !== null && resolvedIds.has(d.new_value)) {
        if (!t.resolved_at) t.resolved_at = j.created_on;
        t.last_resolved_at = j.created_on;
      }
      if (d.new_value !== null && doneIds.has(d.new_value)) wasDone = true;
      else if (wasDone) {
        t.reopened++;
        wasDone = false;
      }
    }
  }
  t.participants = seen;
  t.lead_workdays = businessDays(t.created_at, t.resolved_at);
  t.first_action_workdays = businessDays(t.created_at, t.first_action_at);
  t.first_response_workdays = businessDays(t.created_at, t.first_response_at);
  return t;
}
