import fs from "node:fs";
import path from "node:path";
import app from "./app";
import { logger } from "./lib/logger";
import { db, videosTable } from "@workspace/db";
import { sql, eq } from "drizzle-orm";
import {
  scrapeLatest,
  scrapeDeep,
  scrapeByStudios,
  scrapeByKeywords,
  scrapeByPerformers,
  seedWhitelistedPerformers,
  scrapeFamilyPornHD,
} from "./lib/scraper";

// 7 empty/low-video categories seeded immediately on boot via targeted keyword search.
const EMPTY_CATEGORY_KEYWORDS = [
  "bbc", "bbw", "college", "uniform", "onlyfans", "erotic", "footjob",
];
import type { Request, Response } from "express";
import type { InsertVideo } from "@workspace/db";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// ---------------------------------------------------------------------------
// Global scraping-state flag
// ---------------------------------------------------------------------------
let isScraping = false;

// ---------------------------------------------------------------------------
// autoTagRepair — local tag injection for existing rows
// ---------------------------------------------------------------------------

const REPAIR_RULES: Array<{ keywords: string[]; tag: string }> = [
  { keywords: ["bbc", "big black cock", "black cock"],                      tag: "bbc"      },
  { keywords: ["bbw", "curvy", "chubby", "plus size"],                      tag: "bbw"      },
  { keywords: ["college", "university", "student", "dorm", "sorority"],     tag: "college"  },
  { keywords: ["uniform", "schoolgirl", "nurse", "maid", "school uniform"], tag: "uniform"  },
  { keywords: ["onlyfans", "only fans", "leaked", "of model"],              tag: "onlyfans" },
  { keywords: ["erotic", "sensual", "romantic", "erotica"],                 tag: "erotic"   },
  { keywords: ["footjob", "feet", "foot fetish", "foot worship"],           tag: "footjob"  },
];

async function autoTagRepair(): Promise<void> {
  const start = Date.now();
  process.stdout.write(
    `\n🛠️  [REPAIR] Scanning all indexed videos for missing category tags…\n`,
  );

  const allVideos = await db
    .select({ id: videosTable.id, title: videosTable.title, tags: videosTable.tags })
    .from(videosTable);

  const updates: Array<{ id: number; tags: string[] }> = [];

  for (const video of allVideos) {
    const titleLower      = video.title.toLowerCase();
    const existingTagsLow = new Set(video.tags.map((t) => t.toLowerCase()));
    const toAdd: string[] = [];

    for (const rule of REPAIR_RULES) {
      if (existingTagsLow.has(rule.tag)) continue;
      if (rule.keywords.some((kw) => titleLower.includes(kw))) {
        toAdd.push(rule.tag);
      }
    }

    if (toAdd.length > 0) {
      updates.push({
        id:   video.id,
        tags: [...new Set([...video.tags, ...toAdd])],
      });
    }
  }

  const CONCURRENCY = 50;
  for (let i = 0; i < updates.length; i += CONCURRENCY) {
    await Promise.all(
      updates.slice(i, i + CONCURRENCY).map(({ id, tags }) =>
        db.update(videosTable).set({ tags }).where(eq(videosTable.id, id)),
      ),
    );
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  process.stdout.write(
    `\n🛠️ [REPAIR] Tagged and updated ${updates.length} videos in ${elapsed} seconds!\n\n`,
  );
  logger.info(
    { repaired: updates.length, total: allVideos.length, elapsedSeconds: elapsed },
    "autoTagRepair: complete",
  );
}

// ---------------------------------------------------------------------------
// Backup / Restore
// ---------------------------------------------------------------------------

const BACKUP_PATH = path.resolve(import.meta.dirname, "../backup.json");
const BACKUP_CHUNK_SIZE = 200;
const BACKUP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

async function restoreFromBackupIfNeeded(): Promise<void> {
  if (!fs.existsSync(BACKUP_PATH)) {
    process.stdout.write(`[BACKUP] No backup.json found — skipping restore.\n`);
    return;
  }

  const countResult = await db.execute(
    sql`SELECT COUNT(*)::int AS cnt FROM pf_videos`,
  );
  const currentCount = (countResult.rows[0] as { cnt: number })?.cnt ?? 0;

  if (currentCount > 0) {
    process.stdout.write(
      `[BACKUP] DB already has ${currentCount} videos — restore skipped.\n`,
    );
    return;
  }

  process.stdout.write(
    `[BACKUP] DB is empty and backup.json exists — beginning restore…\n`,
  );

  let raw: string;
  try {
    raw = fs.readFileSync(BACKUP_PATH, "utf-8");
  } catch (readErr) {
    process.stdout.write(
      `[BACKUP] ⚠️  Could not read backup.json: ${readErr instanceof Error ? readErr.message : String(readErr)}\n`,
    );
    return;
  }

  let videos: InsertVideo[];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error("backup.json root must be an array");
    videos = (parsed as Record<string, unknown>[]).map((row) => {
      const { id: _id, created_at: _ca, updated_at: _ua, ...rest } = row;
      return rest as InsertVideo;
    });
  } catch (parseErr) {
    process.stdout.write(
      `[BACKUP] ⚠️  Failed to parse backup.json: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}\n`,
    );
    return;
  }

  if (videos.length === 0) {
    process.stdout.write(`[BACKUP] backup.json is empty — nothing to restore.\n`);
    return;
  }

  let restored = 0;
  for (let i = 0; i < videos.length; i += BACKUP_CHUNK_SIZE) {
    const chunk = videos.slice(i, i + BACKUP_CHUNK_SIZE);
    try {
      await db.insert(videosTable).values(chunk).onConflictDoNothing();
      restored += chunk.length;
    } catch (insertErr) {
      process.stdout.write(
        `[BACKUP] ⚠️  Chunk ${i}–${i + chunk.length} insert error: ${insertErr instanceof Error ? insertErr.message : String(insertErr)}\n`,
      );
    }
  }

  process.stdout.write(
    `\n🚀 [RESTORE] Successfully restored ${restored} videos from backup.json!\n\n`,
  );
  logger.info({ restored }, "RESTORE: videos reloaded from backup.json");
}

// ---------------------------------------------------------------------------
// purgeFullHDPorn — surgical removal of all fullhdporn.sex indexed rows
// Runs AFTER backup restore so that any rows re-introduced by backup.json
// are immediately cleaned up before any page serves them.
// ---------------------------------------------------------------------------

async function purgeFullHDPorn(): Promise<void> {
  try {
    const result = await db.execute(
      sql`DELETE FROM pf_videos WHERE embed_url ILIKE ${"%" + "fullhdporn.sex" + "%"}`,
    );
    const deleted = (result as unknown as { rowCount?: number }).rowCount ?? 0;
    if (deleted > 0) {
      process.stdout.write(
        `[CLEANUP] ✅ Purged ${deleted} fullhdporn.sex rows — broken players removed.\n`,
      );
      logger.info({ deleted }, "purgeFullHDPorn: stale rows deleted");
    } else {
      process.stdout.write(`[CLEANUP] No fullhdporn.sex rows found — DB is clean.\n`);
    }
  } catch (err) {
    process.stdout.write(
      `[CLEANUP] ⚠️  fullhdporn.sex purge failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    logger.error({ err }, "purgeFullHDPorn: delete failed");
  }
}

async function writeBackup(): Promise<void> {
  try {
    const rows = await db.select().from(videosTable);
    const json = JSON.stringify(rows, null, 2);
    fs.writeFileSync(BACKUP_PATH, json, "utf-8");
    process.stdout.write(
      `[BACKUP] ✅ backup.json updated — ${rows.length} videos written to disk.\n`,
    );
    logger.debug({ count: rows.length, path: BACKUP_PATH }, "Backup written");
  } catch (err) {
    process.stdout.write(
      `[BACKUP] ⚠️  Failed to write backup.json: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    logger.error({ err }, "Backup write failed");
  }
}

function startBackupInterval(): void {
  writeBackup().catch((err: unknown) =>
    logger.error({ err }, "Initial backup write failed"),
  );

  setInterval(() => {
    writeBackup().catch((err: unknown) =>
      logger.error({ err }, "Scheduled backup write failed"),
    );
  }, BACKUP_INTERVAL_MS);

  process.stdout.write(
    `[BACKUP] 🕐 Backup interval armed — backup.json refreshed every 15 minutes.\n`,
  );
}

// ---------------------------------------------------------------------------
// DB diagnostic
// ---------------------------------------------------------------------------

async function checkDatabase(): Promise<boolean> {
  const sep = "=".repeat(60);
  process.stdout.write(`\n${sep}\n  DATABASE STARTUP DIAGNOSTIC\n${sep}\n`);

  if (!process.env["DATABASE_URL"]) {
    process.stdout.write(
      `\n🚨 CRITICAL: DATABASE_URL IS MISSING!\n` +
      `   Please add it to your Replit Environment Variables.\n` +
      `   Go to: Secrets (🔒) → Add SECRET → Key: DATABASE_URL\n\n`,
    );
    logger.error("CRITICAL: DATABASE_URL is not set — all scraping will fail");
    return false;
  }

  process.stdout.write(`✅ DATABASE_URL is set.\n`);

  try {
    await db.execute(sql`SELECT 1`);
    process.stdout.write(`✅ Database connection established successfully.\n`);
  } catch (connErr) {
    process.stdout.write(
      `\n🚨 DATABASE CONNECTION FAILED!\n` +
      `   Error: ${connErr instanceof Error ? connErr.message : String(connErr)}\n` +
      `   Check that your DATABASE_URL is correct and the DB is running.\n\n`,
    );
    logger.error({ err: connErr }, "Database connection test failed");
    return false;
  }

  try {
    const result = await db.execute(
      sql`SELECT COUNT(*)::int AS cnt FROM pf_videos LIMIT 1`,
    );
    const cnt = (result.rows[0] as { cnt: number })?.cnt ?? 0;
    process.stdout.write(`✅ Table "pf_videos" exists — ${cnt} videos currently indexed.\n`);

    try {
      const purge = await db.execute(
        sql`DELETE FROM pf_videos WHERE embed_url ILIKE ${"%" + "tabooporn.to" + "%"} OR slug LIKE ${"tp-%"} OR embed_url ILIKE ${"%" + "porndupe.com" + "%"} OR embed_url ILIKE ${"%" + "4kporno.xxx" + "%"}`,
      );
      const deleted = (purge as unknown as { rowCount?: number }).rowCount ?? 0;
      if (deleted > 0) {
        process.stdout.write(`[CLEANUP] Purged ${deleted} broken rows (tabooporn.to / porndupe.com / 4kporno.xxx) from DB.\n`);
      }
    } catch (_purgeErr) {
      process.stdout.write(`[CLEANUP] Stale-URL purge skipped — ${_purgeErr instanceof Error ? _purgeErr.message : String(_purgeErr)}\n`);
    }
  } catch (tableErr) {
    process.stdout.write(
      `\n⚠️  Table "pf_videos" does NOT exist yet!\n` +
      `   Run: pnpm --filter @workspace/db run push\n\n`,
    );
    logger.warn({ err: tableErr }, 'Table "pf_videos" not found — schema push required');
    return false;
  }

  process.stdout.write(`${sep}\n\n`);
  return true;
}

// ---------------------------------------------------------------------------
// Self-Heartbeat Keep-Alive Loop
// ---------------------------------------------------------------------------

function startHeartbeat(): void {
  const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

  setInterval(() => {
    if (!isScraping) return;

    const devDomain = process.env["REPLIT_DEV_DOMAIN"];
    const selfUrl   = devDomain
      ? `https://${devDomain}/`
      : `http://localhost:${port}/`;

    fetch(selfUrl, { method: "GET", signal: AbortSignal.timeout(10_000) })
      .then(() => {
        logger.debug({ selfUrl }, "Heartbeat: self-ping sent — container kept alive");
      })
      .catch(() => {
        // Silently ignore — heartbeat failures are non-fatal
      });
  }, HEARTBEAT_INTERVAL_MS);

  logger.info({ intervalMinutes: HEARTBEAT_INTERVAL_MS / 60_000 }, "Heartbeat: self-ping loop armed");
  process.stdout.write(`[HEARTBEAT] Keep-alive loop armed — pings every 2 minutes while scraping is active.\n`);
}

// ---------------------------------------------------------------------------
// Admin endpoints
// ---------------------------------------------------------------------------

app.get("/api/pf/admin/scrape-studios", (_req: Request, res: Response) => {
  logger.info("Admin: manual scrapeByStudios triggered");
  if (!isScraping) {
    isScraping = true;
    scrapeByStudios()
      .then(() => seedWhitelistedPerformers())
      .then(() => { isScraping = false; })
      .catch((err: unknown) => {
        isScraping = false;
        logger.error({ err }, "Admin scrapeByStudios failed");
      });
  }
  res.json({ ok: true, message: "scrapeByStudios() triggered in background" });
});

app.get("/api/pf/admin/scrape-latest", (req: Request, res: Response) => {
  const pages = Math.min(10, Math.max(1, parseInt(String(req.query["pages"] ?? "3")) || 3));
  logger.info({ pages }, "Admin: manual scrapeLatest triggered");
  scrapeLatest(pages)
    .then(() => seedWhitelistedPerformers())
    .catch((err: unknown) => logger.error({ err }, "Admin scrapeLatest failed"));
  res.json({ ok: true, message: `scrapeLatest(${pages}) triggered in background` });
});

app.get("/api/pf/admin/scrape-deep", (req: Request, res: Response) => {
  const start = Math.max(1, parseInt(String(req.query["start"] ?? "1")) || 1);
  const end   = Math.max(start, parseInt(String(req.query["end"] ?? "150")) || 150);
  logger.info({ start, end }, "Admin: manual scrapeDeep triggered");
  scrapeDeep(start, end)
    .then(() => seedWhitelistedPerformers())
    .catch((err: unknown) => logger.error({ err }, "Admin scrapeDeep failed"));
  res.json({ ok: true, message: `scrapeDeep(${start}, ${end}) triggered in background` });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

const AUTOPILOT_INTERVAL_MS = 4 * 60 * 60 * 1000;

app.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  startHeartbeat();

  setTimeout(() => {
    checkDatabase()
      .then((dbOk) => {
        if (!dbOk) {
          process.stdout.write(
            `\n⛔ Scraping is DISABLED until database issues above are resolved.\n\n`,
          );
          return;
        }

        autoTagRepair().catch((err: unknown) =>
          logger.error({ err }, "autoTagRepair failed"),
        );

        restoreFromBackupIfNeeded()
          .then(() => purgeFullHDPorn())
          .then(() => startBackupInterval())
          .catch((err: unknown) =>
            logger.error({ err }, "Backup restore/interval setup failed"),
          );

        process.stdout.write(
          `\n🚀 BACKFILL: Launching studios · keywords · performers · FamilyPornHD concurrently\n` +
          `   Studios: 28 whitelisted · 5 pages each\n` +
          `   Keywords: ${EMPTY_CATEGORY_KEYWORDS.length} terms · 5 pages each\n` +
          `   Performers: 33 stars · UNLIMITED pages\n` +
          `   FamilyPornHD: 3 listing pages\n` +
          `   isScraping=true — heartbeat armed, container kept alive\n\n`,
        );

        isScraping = true;

        Promise.all([
          scrapeByStudios(5),
          scrapeByKeywords(EMPTY_CATEGORY_KEYWORDS, 5),
          scrapeByPerformers(),
          scrapeFamilyPornHD(3),
        ])
          .then(() => seedWhitelistedPerformers())
          .then(() => {
            isScraping = false;
            process.stdout.write(
              `\n✅ BACKFILL COMPLETE: All sources done. isScraping=false — heartbeat will idle.\n\n`,
            );
          })
          .catch((err: unknown) => {
            isScraping = false;
            logger.error({ err }, "Backfill (all sources) failed");
            process.stdout.write(`\n🚨 BACKFILL ERROR: ${err instanceof Error ? err.message : String(err)}\n\n`);
          });

        setInterval(() => {
          logger.info("Autopilot: triggering scheduled scrapeLatest + FamilyPornHD");
          Promise.all([
            scrapeLatest(3),
            scrapeFamilyPornHD(3),
          ])
            .then(() => seedWhitelistedPerformers())
            .catch((err: unknown) => logger.error({ err }, "Autopilot multi-source scrape failed"));
        }, AUTOPILOT_INTERVAL_MS);

        logger.info(
          { intervalHours: AUTOPILOT_INTERVAL_MS / 3_600_000 },
          "Autopilot Scheduler armed — HQporner + FamilyPornHD will fire every 4 hours",
        );
      })
      .catch((err: unknown) => {
        logger.error({ err }, "Database diagnostic check threw unexpectedly");
      });
  }, 3_000);
});
