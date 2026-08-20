import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const videosTable = pgTable(
  "pf_videos",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    description: text("description"),
    embed_url: text("embed_url").notNull(),
    thumbnail_url: text("thumbnail_url").notNull(),
    duration_seconds: integer("duration_seconds").notNull().default(0),
    duration_text: text("duration_text").notNull().default(""),
    views: integer("views").notNull().default(0),
    likes: integer("likes").notNull().default(0),
    quality_label: text("quality_label").notNull().default("HD"),
    category: text("category").notNull().default("hd"),
    studio: text("studio"),
    release_year: integer("release_year"),
    tags: text("tags").array().notNull().default([]),
    pornstars: text("pornstars").array().notNull().default([]),
    status: text("status").notNull().default("published"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique("pf_videos_embed_url_unique").on(table.embed_url)],
);

export const insertVideoSchema = createInsertSchema(videosTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type InsertVideo = z.infer<typeof insertVideoSchema>;
export type Video = typeof videosTable.$inferSelect;
