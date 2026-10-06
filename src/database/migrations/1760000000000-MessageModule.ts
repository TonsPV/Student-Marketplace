import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Module Message v1.2 — schema, indexes, backfill (spec §3).
 *
 * Quy trình production (§3.4): tạm dừng writes chat → backup DB → dry-run
 * trên bản sao → chạy migration. Không chạy synchronize lên DB có dữ liệu.
 *
 * Blocker cần báo trước khi chạy (§3.4.6): nếu message_images cũ đã tồn tại
 * với cột URL, migration này KHÔNG tự chuyển external URL thành private key.
 * Phải kiểm kê và mapping thủ công; external URL không đoán thành key.
 */
export class MessageModule1760000000000 implements MigrationInterface {
  name = "MessageModule1760000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const legacyImages =
      await queryRunner.query(`SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'message_images' AND column_name = 'url'`);
    if (legacyImages.length)
      throw new Error(
        "Legacy message_images.url requires an explicit URL-to-private-key mapping before migration",
      );
    // Legacy scaffold stored now() in a timestamp column on a UTC database.
    // Installations using another historical DB timezone must adapt this conversion.
    await queryRunner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema()
        AND table_name='messages' AND column_name='created_at' AND data_type='timestamp without time zone') THEN
        ALTER TABLE messages ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
      END IF;
    END $$`);
    // ── 1. conversations: counters/metadata mới ────────────────────────────
    await queryRunner.query(
      `ALTER TABLE conversations
         ADD COLUMN IF NOT EXISTS last_message_id uuid,
         ADD COLUMN IF NOT EXISTS last_message_sender_id uuid,
         ADD COLUMN IF NOT EXISTS last_message_sequence bigint NOT NULL DEFAULT '0',
         ADD COLUMN IF NOT EXISTS state_version bigint NOT NULL DEFAULT '0',
         ADD COLUMN IF NOT EXISTS buyer_read_sequence bigint NOT NULL DEFAULT '0',
         ADD COLUMN IF NOT EXISTS seller_read_sequence bigint NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_conversations_buyer_ne_seller' AND conrelid = 'conversations'::regclass) THEN
           ALTER TABLE conversations
             ADD CONSTRAINT chk_conversations_buyer_ne_seller CHECK (buyer_id <> seller_id);
         END IF;
       END $$`,
    );

    // ── 2. messages: sequence + clientId (nullable tạm để backfill) ─────────
    await queryRunner.query(
      `ALTER TABLE messages
         ADD COLUMN IF NOT EXISTS sequence bigint,
         ADD COLUMN IF NOT EXISTS client_id varchar(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE messages ALTER COLUMN content DROP NOT NULL`,
    );

    // ── 3. Backfill sequence: row_number() theo (created_at, id) ────────────
    await queryRunner.query(
      `WITH ranked AS (
         SELECT id,
                ROW_NUMBER() OVER (
                  PARTITION BY conversation_id ORDER BY created_at, id
                ) AS rn
           FROM messages
       )
       UPDATE messages m SET sequence = r.rn
         FROM ranked r WHERE m.id = r.id AND m.sequence IS NULL`,
    );
    // Không dùng mặc định 0 làm sequence hợp lệ của message cũ.
    await queryRunner.query(
      `ALTER TABLE messages ALTER COLUMN sequence SET NOT NULL`,
    );
    await queryRunner.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_messages_sequence_positive' AND conrelid = 'messages'::regclass) THEN
           ALTER TABLE messages
             ADD CONSTRAINT chk_messages_sequence_positive CHECK (sequence > 0);
         END IF;
       END $$`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_conversation_sequence
         ON messages (conversation_id, sequence)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_sender_client
         ON messages (sender_id, client_id) WHERE client_id IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_messages_conversation_unread
         ON messages (conversation_id, sender_id, sequence) WHERE is_read = false`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_messages_conversation_created_at`,
    );

    // ── 4. Backfill conversation preview/counters từ max sequence ───────────
    await queryRunner.query(
      `WITH latest AS (
         SELECT DISTINCT ON (conversation_id)
                conversation_id, id, sender_id, sequence, content, created_at
           FROM messages ORDER BY conversation_id, sequence DESC
       )
       UPDATE conversations c
          SET last_message_id = l.id,
              last_message_sender_id = l.sender_id,
              last_message_sequence = l.sequence,
              last_message = CASE WHEN length(btrim(COALESCE(l.content, ''))) > 100
                THEN left(btrim(l.content), 99) || '…'
                ELSE btrim(COALESCE(l.content, '')) END,
              last_message_at = l.created_at
         FROM latest l WHERE c.id = l.conversation_id`,
    );
    // Giữ isRead cũ làm nguồn sự thật. Watermark = prefix liên tục đã đọc:
    // sequence trước tin đầu tiên của bên kia còn is_read=false; hết unread
    // thì dùng lastMessageSequence. Không dùng max(is_read=true) vì dữ liệu
    // cũ có thể không liên tục.
    await queryRunner.query(
      `WITH first_unread AS (
         SELECT conversation_id, sender_id, MIN(sequence) AS s
           FROM messages WHERE is_read = false
          GROUP BY conversation_id, sender_id
       )
       UPDATE conversations c
          SET buyer_read_sequence = COALESCE(
                (SELECT f.s - 1 FROM first_unread f
                  WHERE f.conversation_id = c.id AND f.sender_id = c.seller_id),
                c.last_message_sequence),
              seller_read_sequence = COALESCE(
                (SELECT f.s - 1 FROM first_unread f
                  WHERE f.conversation_id = c.id AND f.sender_id = c.buyer_id),
                c.last_message_sequence)`,
    );

    // ── 5. message_images mới (key + position, không lưu URL) ───────────────
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS message_images (
         id uuid PRIMARY KEY,
         message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
         key varchar(512) NOT NULL,
         position smallint NOT NULL
       )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_message_images_key
         ON message_images (key)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_message_images_position
         ON message_images (message_id, position)`,
    );
    await queryRunner.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_message_images_position_range' AND conrelid = 'message_images'::regclass) THEN
           ALTER TABLE message_images
             ADD CONSTRAINT chk_message_images_position_range
             CHECK (position >= 0 AND position <= 4);
         END IF;
       END $$`,
    );

    // A manually mapped legacy key table can already contain image-only messages.
    await queryRunner.query(`UPDATE conversations c
      SET last_message = CASE WHEN images.cnt = 1 THEN '[Hình ảnh]'
        ELSE '[' || images.cnt || ' hình ảnh]' END
      FROM messages m JOIN (SELECT message_id, count(*) AS cnt FROM message_images GROUP BY message_id) images
        ON images.message_id = m.id
      WHERE c.last_message_id = m.id AND length(btrim(COALESCE(m.content, ''))) = 0`);

    // ── 6. notifications (NEW_MESSAGE gộp theo user/conversation) ───────────
    await queryRunner.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE t.typname = 'notifications_type_enum' AND n.nspname = current_schema()) THEN
           CREATE TYPE notifications_type_enum AS ENUM ('new_message');
         END IF;
       END $$`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS notifications (
         id uuid PRIMARY KEY,
         user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
         type notifications_type_enum NOT NULL,
         ref_id uuid NULL,
         title varchar(200) NOT NULL,
         body text NULL,
         is_read boolean NOT NULL DEFAULT false,
         last_message_sequence bigint NULL,
         conversation_version bigint NULL,
         created_at timestamptz NOT NULL DEFAULT now(),
         updated_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_new_message_unread
         ON notifications (user_id, type, ref_id)
        WHERE type = 'new_message' AND is_read = false AND ref_id IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_notifications_user_read_updated
         ON notifications (user_id, is_read, updated_at DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE messages ALTER COLUMN created_at TYPE timestamp USING created_at AT TIME ZONE 'UTC'`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_notifications_user_read_updated`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS uq_notifications_new_message_unread`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS notifications`);
    await queryRunner.query(`DROP TYPE IF EXISTS notifications_type_enum`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_message_images_position`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_message_images_key`);
    await queryRunner.query(`DROP TABLE IF EXISTS message_images`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_messages_conversation_unread`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS uq_messages_sender_client`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS uq_messages_conversation_sequence`,
    );
    await queryRunner.query(
      `ALTER TABLE messages DROP CONSTRAINT IF EXISTS chk_messages_sequence_positive`,
    );
    await queryRunner.query(
      `ALTER TABLE messages DROP COLUMN IF EXISTS client_id`,
    );
    await queryRunner.query(
      `ALTER TABLE messages DROP COLUMN IF EXISTS sequence`,
    );
    await queryRunner.query(
      `ALTER TABLE conversations DROP CONSTRAINT IF EXISTS chk_conversations_buyer_ne_seller`,
    );
    await queryRunner.query(
      `ALTER TABLE conversations
         DROP COLUMN IF EXISTS seller_read_sequence,
         DROP COLUMN IF EXISTS buyer_read_sequence,
         DROP COLUMN IF EXISTS state_version,
         DROP COLUMN IF EXISTS last_message_sequence,
         DROP COLUMN IF EXISTS last_message_sender_id,
         DROP COLUMN IF EXISTS last_message_id`,
    );
  }
}
