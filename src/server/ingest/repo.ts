// `documents` rows (PRD §13; architecture §10.2). Plain SQL inside withUserTx so RLS scopes
// every query to the session user. Ingestion is idempotent on (user_id, sha256).

import { withUserTx } from "@/src/server/db/pool";

export type DocumentType = "bill_pdf";

export type DocumentRow = { id: string; userId: string; type: DocumentType; storageRef: string; sha256: string };

export interface DocumentRepo {
  findByHash(userId: string, sha256: string): Promise<string | null>;
  /** Insert unless (user_id, sha256) exists; returns the row id and whether it was created. */
  insertIdempotent(input: {
    userId: string;
    type: DocumentType;
    storageRef: string;
    sha256: string;
    receivedAt: Date;
    retentionUntil: Date;
  }): Promise<{ id: string; created: boolean }>;
  get(documentId: string, userId: string): Promise<DocumentRow | null>;
  setStatus(documentId: string, userId: string, status: "parsed" | "needs_review"): Promise<void>;
}

export function createPgDocumentRepo(): DocumentRepo {
  return {
    findByHash(userId, sha256) {
      return withUserTx(userId, async (tx) => {
        const r = await tx.query<{ id: string }>(
          "select id from public.documents where user_id = $1 and sha256 = $2",
          [userId, sha256],
        );
        return r.rows[0]?.id ?? null;
      });
    },
    insertIdempotent(input) {
      return withUserTx(input.userId, async (tx) => {
        const ins = await tx.query<{ id: string }>(
          `insert into public.documents (user_id, type, storage_ref, sha256, received_at, retention_until)
           values ($1, $2, $3, $4, $5, $6)
           on conflict (user_id, sha256) do nothing
           returning id`,
          [input.userId, input.type, input.storageRef, input.sha256, input.receivedAt, input.retentionUntil],
        );
        if (ins.rows[0]) return { id: ins.rows[0].id, created: true };
        const existing = await tx.query<{ id: string }>(
          "select id from public.documents where user_id = $1 and sha256 = $2",
          [input.userId, input.sha256],
        );
        if (!existing.rows[0]) throw new Error("document insert conflicted but no row is visible");
        return { id: existing.rows[0].id, created: false };
      });
    },
    setStatus(documentId, userId, status) {
      return withUserTx(userId, async (tx) => {
        await tx.query("update public.documents set status = $3 where id = $1 and user_id = $2", [documentId, userId, status]);
      });
    },
    get(documentId, userId) {
      return withUserTx(userId, async (tx) => {
        const r = await tx.query<{ id: string; user_id: string; type: DocumentType; storage_ref: string; sha256: string }>(
          "select id, user_id, type, storage_ref, sha256 from public.documents where id = $1 and user_id = $2",
          [documentId, userId],
        );
        const row = r.rows[0];
        return row ? { id: row.id, userId: row.user_id, type: row.type, storageRef: row.storage_ref, sha256: row.sha256 } : null;
      });
    },
  };
}
