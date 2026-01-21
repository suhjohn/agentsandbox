ALTER TABLE "conversations" RENAME TO "coordinator_sessions";--> statement-breakpoint
ALTER TABLE "messages" RENAME COLUMN "conversation_id" TO "coordinator_session_id";--> statement-breakpoint
ALTER TABLE "coordinator_sessions" DROP CONSTRAINT "conversations_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_conversation_id_conversations_id_fk";
--> statement-breakpoint
DROP INDEX "conversations_created_by_idx";--> statement-breakpoint
DROP INDEX "messages_conversation_idx";--> statement-breakpoint
ALTER TABLE "coordinator_sessions" ADD CONSTRAINT "coordinator_sessions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_coordinator_session_id_coordinator_sessions_id_fk" FOREIGN KEY ("coordinator_session_id") REFERENCES "public"."coordinator_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coordinator_sessions_created_by_idx" ON "coordinator_sessions" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "messages_coordinator_session_idx" ON "messages" USING btree ("coordinator_session_id");