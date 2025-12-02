// src/services/caseStatus.ts

import pool from "../db";
import { isValidCaseStatus } from "../domain/caseStatus";

export async function updateCaseStatus(caseId: number, newStatus: string) {
  if (!isValidCaseStatus(newStatus)) {
    throw new Error("Nieprawidłowy kod statusu: " + newStatus);
  }

  const result = await pool.query(
    `
      UPDATE cases
      SET status_code = $1
      WHERE id = $2
      RETURNING id, status_code
    `,
    [newStatus, caseId]
  );

  return result.rows[0];
}