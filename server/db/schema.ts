import { pgTable, uuid, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

export const chatSessions = pgTable("chat_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userEmail: text("user_email").notNull(),
  title: text("title").default("Ny chatt"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const chatMessages = pgTable("chat_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .references(() => chatSessions.id, { onDelete: "cascade" })
    .notNull(),
  role: text("role").notNull(), // 'user' | 'assistant' | 'tool_use' | 'tool_result'
  content: text("content"),
  metadata: jsonb("metadata"), // tool name, artifact id, cost, etc.
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const artifacts = pgTable("artifacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .references(() => chatSessions.id, { onDelete: "cascade" })
    .notNull(),
  title: text("title").notNull(),
  type: text("type").notNull(), // 'html' | 'react' | 'markdown' | 'document' | 'svg' | 'csv'
  content: text("content").notNull(),
  version: integer("version").default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const generatedFiles = pgTable("generated_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .references(() => chatSessions.id, { onDelete: "cascade" })
    .notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  filePath: text("file_path").notNull(),
  sizeBytes: integer("size_bytes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
