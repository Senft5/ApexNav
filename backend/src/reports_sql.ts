// SQL for "is this hidden by reports?", shared by discovery, garages, highlights and the owner's queue (a leaf module: no imports).
export const HIDE_AFTER_REPORTS = 3;
export const REPORT_KINDS = ["user", "crew", "car", "highlight", "event", "photo", "chat"] as const;
export type ReportKind = typeof REPORT_KINDS[number];

const kindOk = (kind: ReportKind) => { if (!REPORT_KINDS.includes(kind)) throw new Error("bad kind"); return kind; };

/** True when the owner removed it. Its owner can't switch it back on (public crew, shown car). */
export const removedSql = (kind: ReportKind, idExpr: string) =>
  `EXISTS (SELECT 1 FROM reports rx WHERE rx.kind = '${kindOk(kind)}' AND rx.target_id = ${idExpr} AND rx.status = 'removed')`;

/** True when removed, or when open reports came from HIDE_AFTER_REPORTS current members who were invited by different people and
 *  not by one another (a member's spare accounts trace back to that member, so a chain A → B → C counts once).
 *  Aliases are unique (rr, mm, ro) so `idExpr` may name a column of an outer `r`. */
export const reportedSql = (kind: ReportKind, idExpr: string) =>
  `(${removedSql(kind, idExpr)} OR (SELECT COUNT(DISTINCT COALESCE(mm.invited_by, rr.reporter)) FROM reports rr JOIN members mm ON mm.user_id = rr.reporter
     WHERE rr.kind = '${kindOk(kind)}' AND rr.target_id = ${idExpr} AND rr.status = 'open'
       AND NOT EXISTS (SELECT 1 FROM reports ro WHERE ro.kind = rr.kind AND ro.target_id = rr.target_id AND ro.status = 'open' AND ro.reporter = mm.invited_by)
     ) >= ${HIDE_AFTER_REPORTS})`;
