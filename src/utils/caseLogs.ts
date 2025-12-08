// src/utils/caseLogs.ts
import pool from "../db";

export type CaseLogAction =
  | "CASE_CREATED"
  | "CASE_STATUS_CHANGED"
  | "LEAD_CONVERTED"
  | "NOTE_ADDED"
  | "FILE_ADDED"
  | "FILE_REMOVED";

export async function addCaseLog(params: {
  caseId: number;
  userId?: number | null;
  action: CaseLogAction;
  message: string;
  meta?: any;
}) {
  const { caseId, userId, action, message, meta } = params;

  if (!caseId || !action || !message) {
    console.warn("addCaseLog – brak wymaganych danych", {
      caseId,
      action,
      message,
    });
    return;
  }

  await pool.query(
    `INSERT INTO case_logs (case_id, user_id, action_type, message, meta)
     VALUES ($1, $2, $3, $4, $5)`,
    [caseId, userId ?? null, action, message, meta ?? null]
  );
}

export async function fetchCaseLogs(caseId: number) {
  const result = await pool.query(
    `SELECT
       cl.id,
       cl.case_id,
       cl.user_id,
       cl.action_type,
       cl.message,
       cl.meta,
       cl.created_at,
       u.name  AS user_name,
       u.email AS user_email
     FROM case_logs cl
     LEFT JOIN users u ON u.id = cl.user_id
     WHERE cl.case_id = $1
     ORDER BY cl.created_at ASC`,
    [caseId]
  );

  return result.rows;
}