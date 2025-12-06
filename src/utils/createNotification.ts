// src/utils/createNotification.ts
import pool from "../db";

export interface CreateNotificationInput {
    userId: number;
    caseId?: number | null;
    type: string;          // np. "case_created", "status_changed", "wps_updated"
    title: string;
    body: string;
    meta?: any;            // dodatkowe dane, JSON
}

/**
 * Tworzy powiadomienie dla użytkownika.
 */
export async function createNotification(input: CreateNotificationInput): Promise<void> {
    const {
        userId,
        caseId = null,
        type,
        title,
        body,
        meta = {},
    } = input;

    await pool.query(
        `
      INSERT INTO notifications (user_id, case_id, type, title, body, meta)
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
        [userId, caseId, type, title, body, meta]
    );
}