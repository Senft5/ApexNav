// SQL for "is this hidden by reports?", shared by discovery, garages and highlights (a leaf module: no imports).
export const HIDE_AFTER_REPORTS = 3;
export const REPORT_KINDS = ["user", "crew", "car", "highlight"] as const;
export type ReportKind = typeof REPORT_KINDS[number];

const kindOk = (kind: ReportKind) => { if (!REPORT_KINDS.includes(kind)) throw new Error("bad kind"); return kind; };

/** True when the owner removed it. Its owner can't switch it back on (public crew, shown car). */
export const removedSql = (kind: ReportKind, idExpr: string) =>
  `EXISTS (SELECT 1 FROM reports WHERE kind = '${kindOk(kind)}' AND target_id = ${idExpr} AND status = 'removed')`;

/** True when removed, or when open reports came from HIDE_AFTER_REPORTS people who were invited by different people
 *  (a member's spare accounts all trace back to the one inviter, so they count once). */
export const reportedSql = (kind: ReportKind, idExpr: string) =>
  `(${removedSql(kind, idExpr)} OR (SELECT COUNT(DISTINCT COALESCE(m.invited_by, r.reporter)) FROM reports r LEFT JOIN members m ON m.user_id = r.reporter
     WHERE r.kind = '${kindOk(kind)}' AND r.target_id = ${idExpr} AND r.status = 'open') >= ${HIDE_AFTER_REPORTS})`;
