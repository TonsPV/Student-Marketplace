import { DataSource, QueryRunner } from "typeorm";
import { uuidv7 } from "uuidv7";
import { MessageModule1760000000000 } from "../../src/database/migrations/1760000000000-MessageModule";
import {
  createTestDataSource,
  disposeTestDatabase,
  ownedTestSchema,
} from "./database";

describe("migration up/down on legacy fixtures (isolated schema)", () => {
  let ds: DataSource;
  let runner: QueryRunner;
  const migration = new MessageModule1760000000000();
  beforeEach(async () => {
    ds = createTestDataSource();
    await ds.initialize();
    await ds.query(`CREATE SCHEMA "${ownedTestSchema(ds)}"`);
    runner = ds.createQueryRunner();
    await runner.connect();
    await runner.query(`CREATE TABLE "user" (id uuid PRIMARY KEY)`);
    await runner.query(`CREATE TABLE conversations (id uuid PRIMARY KEY, post_id uuid NOT NULL,
      buyer_id uuid NOT NULL, seller_id uuid NOT NULL, last_message text, last_message_at timestamptz,
      created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT uq_conversations_post_buyer UNIQUE(post_id,buyer_id))`);
    await runner.query(`CREATE TABLE messages (id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES conversations(id),
      sender_id uuid NOT NULL REFERENCES "user"(id), content text NOT NULL, is_read boolean NOT NULL DEFAULT false,
      created_at timestamp NOT NULL DEFAULT now())`);
  });
  afterEach(async () => {
    if (runner?.isTransactionActive) await runner.rollbackTransaction();
    if (runner) await runner.release();
    if (ds) await disposeTestDatabase(ds);
  });

  it("backfills ordered sequences, prefix watermark/read gaps/preview and constraints; down/up preserves legacy messages", async () => {
    const buyer = uuidv7(),
      seller = uuidv7(),
      conversation = uuidv7();
    await runner.query(`INSERT INTO "user" VALUES ($1),($2)`, [buyer, seller]);
    await runner.query(
      `INSERT INTO conversations (id,post_id,buyer_id,seller_id) VALUES ($1,$2,$3,$4)`,
      [conversation, uuidv7(), buyer, seller],
    );
    const ids = [uuidv7(), uuidv7(), uuidv7()];
    for (let i = 0; i < 3; i++)
      await runner.query(
        `INSERT INTO messages(id,conversation_id,sender_id,content,is_read,created_at)
      VALUES($1,$2,$3,$4,$5,$6)`,
        [
          ids[i],
          conversation,
          buyer,
          i === 2 ? "🙂".repeat(101) : `old ${i}`,
          i !== 1,
          `2025-01-01T00:00:0${i}Z`,
        ],
      );
    await runner.startTransaction();
    await migration.up(runner);
    await runner.commitTransaction();
    expect(
      (
        await runner.query(
          `SELECT sequence,is_read FROM messages ORDER BY sequence`,
        )
      ).map((row: any) => [row.sequence, row.is_read]),
    ).toEqual([
      ["1", true],
      ["2", false],
      ["3", true],
    ]);
    const [state] = await runner.query(`SELECT * FROM conversations`);
    expect(state).toMatchObject({
      last_message_id: ids[2],
      last_message_sequence: "3",
      seller_read_sequence: "1",
      buyer_read_sequence: "3",
      state_version: "0",
      last_message: "🙂".repeat(99) + "…",
    });
    await expect(
      runner.query(
        `INSERT INTO messages(id,conversation_id,sender_id,content,sequence) VALUES($1,$2,$3,'bad',0)`,
        [uuidv7(), conversation, buyer],
      ),
    ).rejects.toMatchObject({ driverError: { code: "23514" } });
    await expect(
      runner.query(
        `INSERT INTO messages(id,conversation_id,sender_id,content,sequence) VALUES($1,$2,$3,'bad',1)`,
        [uuidv7(), conversation, buyer],
      ),
    ).rejects.toMatchObject({ driverError: { code: "23505" } });
    await runner.startTransaction();
    await migration.down(runner);
    await runner.commitTransaction();
    expect(
      (await runner.query(`SELECT count(*)::int AS count FROM messages`))[0]
        .count,
    ).toBe(3);
    await runner.startTransaction();
    await migration.up(runner);
    await runner.commitTransaction();
    expect(
      (await runner.query(`SELECT max(sequence)::text AS max FROM messages`))[0]
        .max,
    ).toBe("3");
  });

  it("rejects legacy URL images before any schema changes", async () => {
    await runner.query(
      `CREATE TABLE message_images (id uuid PRIMARY KEY, message_id uuid, url text)`,
    );
    await expect(migration.up(runner)).rejects.toThrow(
      "URL-to-private-key mapping",
    );
    expect(
      await runner.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='messages' AND column_name='sequence'`,
      ),
    ).toHaveLength(0);
  });

  it("keeps the image preview after legacy URLs have been explicitly mapped to keys", async () => {
    const buyer = uuidv7(),
      seller = uuidv7(),
      conversation = uuidv7(),
      message = uuidv7();
    await runner.query(`INSERT INTO "user" VALUES ($1),($2)`, [buyer, seller]);
    await runner.query(
      `INSERT INTO conversations(id,post_id,buyer_id,seller_id) VALUES($1,$2,$3,$4)`,
      [conversation, uuidv7(), buyer, seller],
    );
    await runner.query(
      `INSERT INTO messages(id,conversation_id,sender_id,content) VALUES($1,$2,$3,'')`,
      [message, conversation, buyer],
    );
    await runner.query(
      `CREATE TABLE message_images(id uuid PRIMARY KEY,message_id uuid NOT NULL REFERENCES messages(id),key varchar(512) NOT NULL,position smallint NOT NULL)`,
    );
    for (let position = 0; position < 2; position++)
      await runner.query(`INSERT INTO message_images VALUES($1,$2,$3,$4)`, [
        uuidv7(),
        message,
        `messages/${buyer}/${uuidv7()}.png`,
        position,
      ]);
    await runner.startTransaction();
    await migration.up(runner);
    await runner.commitTransaction();
    expect(
      (await runner.query(`SELECT last_message FROM conversations`))[0]
        .last_message,
    ).toBe("[2 hình ảnh]");
    expect(
      (
        await runner.query(
          `SELECT data_type FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='messages' AND column_name='created_at'`,
        )
      )[0].data_type,
    ).toBe("timestamp with time zone");
  });
});
