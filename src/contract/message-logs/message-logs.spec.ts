import { beforeEach, describe, expect, it } from "bun:test";
import { ORPCError } from "@orpc/client";
import { call } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { relations } from "../../db/relations.ts";
import type * as schema from "../../db/schema.ts";
import type { DbMessageLog } from "../../db/schema.ts";
import { messagesLogsTable, usersTable } from "../../db/schema.ts";
import { createTestContext, createTestDatabase } from "../shared/test-utils.ts";
import { createUser } from "../users/index.ts";
import { createMessageLog, updateMessageDeletedStatus, updateMessageEditedStatus, updateMessageLog } from "./index.ts";

describe("Message Logs", () => {
	let db: BunSQLDatabase<typeof schema, typeof relations>;
	let testUserId: number;

	beforeEach(async () => {
		db = await createTestDatabase();

		// Create a test user for message logs
		const user = await call(
			createUser,
			{
				username: "messagetestuser",
				discordId: "test-discord-123",
			},
			createTestContext(db),
		);
		testUserId = user.id;
	});

	describe("createMessageLog", () => {
		it("should create a message log for existing user", async () => {
			const result = await call(
				createMessageLog,
				{
					userId: testUserId,
					messageId: "msg-456",
					platform: "discord",
					channelId: "channel-456",
					content: "Test message content",
				},
				createTestContext(db),
			);

			expect(result).toBe(true);

			// Verify the message log was created
			const logs = await db.select().from(messagesLogsTable).where(eq(messagesLogsTable.userId, testUserId)).limit(1);

			expect(logs.length).toBe(1);
			expect(logs[0]).toMatchObject({
				userId: testUserId,
				platform: "discord",
				channelId: "channel-456",
				content: "Test message content",
				editCount: 0,
			});
		});

		it("should fail when userId is missing", async () => {
			await expect(
				call(
					createMessageLog,
					{
						// userId is missing - will be undefined
						messageId: "msg-missing-user",
						platform: "discord",
						channelId: "channel-456",
						content: "Test message content",
					} as any,
					createTestContext(db),
				),
			).rejects.toThrow();
		});

		it("should fail when user does not exist", async () => {
			await expect(
				call(
					createMessageLog,
					{
						userId: 999999,
						messageId: "msg-456", // Non-existent user
						platform: "discord",
						channelId: "channel-456",
						content: "Test message content",
					},
					createTestContext(db),
				),
			).rejects.toThrow();
		});

		it("should handle edited messages", async () => {
			const result = await call(
				createMessageLog,
				{
					userId: testUserId,
					messageId: "msg-edit",
					platform: "discord",
					channelId: "channel-edit",
					content: "Edited content",
					editedContents: ["Original content", "First edit"] as any,
					editCount: 2,
				},
				createTestContext(db),
			);

			expect(result).toBe(true);

			const logs = await db
				.select()
				.from(messagesLogsTable)
				.where(and(eq(messagesLogsTable.userId, testUserId), eq(messagesLogsTable.channelId, "channel-edit")))
				.limit(1);

			expect(logs[0]?.editCount).toBe(2);
			expect(logs[0]?.editedContents).toEqual(["Original content", "First edit"]);
		});

		it("should handle deleted messages", async () => {
			const deletedAt = new Date();
			const result = await call(
				createMessageLog,
				{
					userId: testUserId,
					messageId: "msg-del",
					platform: "discord",
					channelId: "channel-del",
					content: "This message was deleted",
					deletedAt: deletedAt,
				},
				createTestContext(db),
			);

			expect(result).toBe(true);

			const logs = await db
				.select()
				.from(messagesLogsTable)
				.where(and(eq(messagesLogsTable.userId, testUserId), eq(messagesLogsTable.channelId, "channel-del")))
				.limit(1);

			expect(logs[0]?.deletedAt).toBeInstanceOf(Date);
		});

		it("should handle messages from different platforms", async () => {
			const platforms = ["discord", "guilded"];

			for (const platform of platforms) {
				const result = await call(
					createMessageLog,
					{
						userId: testUserId,
						messageId: `msg-${platform}`,
						platform,
						channelId: `channel-${platform}`,
						content: `Message from ${platform}`,
					},
					createTestContext(db),
				);

				expect(result).toBe(true);
			}

			const logs = await db.select().from(messagesLogsTable).where(eq(messagesLogsTable.userId, testUserId));

			expect(logs.length).toBeGreaterThanOrEqual(platforms.length);

			for (const platform of platforms) {
				const platformLog = logs.find((log) => log.platform === platform);
				expect(platformLog).toBeDefined();
				expect(platformLog?.content).toBe(`Message from ${platform}`);
			}
		});

		it("should handle long message content", async () => {
			const longContent = "a".repeat(4000); // Test with 4000 characters

			const result = await call(
				createMessageLog,
				{
					userId: testUserId,
					messageId: "msg-long",
					platform: "discord",
					channelId: "channel-long",
					content: longContent,
				},
				createTestContext(db),
			);

			expect(result).toBe(true);

			const logs = await db
				.select()
				.from(messagesLogsTable)
				.where(and(eq(messagesLogsTable.userId, testUserId), eq(messagesLogsTable.channelId, "channel-long")))
				.limit(1);

			expect(logs[0]?.content).toBe(longContent);
		});

		it("should handle empty message content", async () => {
			const result = await call(
				createMessageLog,
				{
					userId: testUserId,
					messageId: "msg-empty",
					platform: "discord",
					channelId: "channel-empty",
					content: "",
				},
				createTestContext(db),
			);

			expect(result).toBe(true);

			const logs = await db
				.select()
				.from(messagesLogsTable)
				.where(and(eq(messagesLogsTable.userId, testUserId), eq(messagesLogsTable.channelId, "channel-empty")))
				.limit(1);

			expect(logs[0]?.content).toBe("");
		});

		it("should handle special characters in content", async () => {
			const specialContent = "Hello 👋 \n\t<script>alert('test')</script> & \"quotes\" 'single'";

			const result = await call(
				createMessageLog,
				{
					userId: testUserId,
					messageId: "msg-special",
					platform: "discord",
					channelId: "channel-special",
					content: specialContent,
				},
				createTestContext(db),
			);

			expect(result).toBe(true);

			const logs = await db
				.select()
				.from(messagesLogsTable)
				.where(and(eq(messagesLogsTable.userId, testUserId), eq(messagesLogsTable.channelId, "channel-special")))
				.limit(1);

			expect(logs[0]?.content).toBe(specialContent);
		});

		it("should handle concurrent message creation", async () => {
			const promises = [];

			for (let i = 0; i < 10; i++) {
				promises.push(
					call(
						createMessageLog,
						{
							userId: testUserId,
							messageId: `msg-concurrent-${i}`,
							platform: "discord",
							channelId: `channel-concurrent-${i}`,
							content: `Concurrent message ${i}`,
						},
						createTestContext(db),
					),
				);
			}

			const results = await Promise.all(promises);
			expect(results).toHaveLength(10);
			expect(results.every((r) => r === true)).toBe(true);

			const logs = await db.select().from(messagesLogsTable).where(eq(messagesLogsTable.userId, testUserId));

			// Should have at least 10 messages (plus any from other tests)
			expect(logs.length).toBeGreaterThanOrEqual(10);
		});

		it("should initialize default values correctly", async () => {
			const result = await call(
				createMessageLog,
				{
					userId: testUserId,
					messageId: "msg-defaults",
					platform: "discord",
					channelId: "channel-defaults",
					content: "Test defaults",
				},
				createTestContext(db),
			);

			expect(result).toBe(true);

			const logs = await db
				.select()
				.from(messagesLogsTable)
				.where(and(eq(messagesLogsTable.userId, testUserId), eq(messagesLogsTable.channelId, "channel-defaults")))
				.limit(1);

			const log = logs[0] as Partial<DbMessageLog>;
			expect(log).toBeDefined();
			expect(log.editCount).toBe(0);
			expect(log.editedContents).toEqual([]);
			expect(log.deletedAt).toBeNull();
			expect(log.createdAt).toBeInstanceOf(Date);
			expect(log.updatedAt).toBeInstanceOf(Date);
		});
	});

	describe("edge cases", () => {
		it("should handle null optional fields", async () => {
			const result = await call(
				createMessageLog,
				{
					userId: testUserId,
					messageId: "msg-minimal-channel",
					platform: "discord",
					channelId: "minimal-channel",
					content: "Minimal message",
					// All optional fields omitted
				},
				createTestContext(db),
			);

			expect(result).toBe(true);

			const logs = await db
				.select()
				.from(messagesLogsTable)
				.where(and(eq(messagesLogsTable.userId, testUserId), eq(messagesLogsTable.channelId, "minimal-channel")))
				.limit(1);

			expect(logs[0]).toBeDefined();
			expect(logs[0]?.editedContents).toEqual([]);
			expect(logs[0]?.deletedAt).toBeNull();
		});

		it("should handle messages with same channelId from same user", async () => {
			// Create two messages in the same channel from same user
			const result1 = await call(
				createMessageLog,
				{
					userId: testUserId,
					messageId: "msg-duplicate-channel",
					platform: "discord",
					channelId: "duplicate-channel",
					content: "First message",
				},
				createTestContext(db),
			);

			const result2 = await call(
				createMessageLog,
				{
					userId: testUserId,
					messageId: "msg-duplicate-channel-2",
					platform: "discord",
					channelId: "duplicate-channel",
					content: "Second message",
				},
				createTestContext(db),
			);

			expect(result1).toBe(true);
			expect(result2).toBe(true);

			const logs = await db
				.select()
				.from(messagesLogsTable)
				.where(and(eq(messagesLogsTable.userId, testUserId), eq(messagesLogsTable.channelId, "duplicate-channel")));

			expect(logs).toHaveLength(2);
			const contents = logs.map((l) => l.content).sort();
			expect(contents).toEqual(["First message", "Second message"]);
		});

		it("should handle messages from different users in same channel", async () => {
			// Create another user
			const user2 = await call(
				createUser,
				{
					username: "secondmessageuser",
					discordId: "test-discord-456",
				},
				createTestContext(db),
			);

			// Create messages from both users in same channel
			const result1 = await call(
				createMessageLog,
				{
					userId: testUserId,
					messageId: "msg-shared-channel",
					platform: "discord",
					channelId: "shared-channel",
					content: "Message from user 1",
				},
				createTestContext(db),
			);

			const result2 = await call(
				createMessageLog,
				{
					userId: user2.id,
					messageId: "msg-shared-channel-2",
					platform: "discord",
					channelId: "shared-channel",
					content: "Message from user 2",
				},
				createTestContext(db),
			);

			expect(result1).toBe(true);
			expect(result2).toBe(true);

			const logs = await db.select().from(messagesLogsTable).where(eq(messagesLogsTable.channelId, "shared-channel"));

			expect(logs).toHaveLength(2);
			expect(logs.find((l) => l.userId === testUserId)?.content).toBe("Message from user 1");
			expect(logs.find((l) => l.userId === user2.id)?.content).toBe("Message from user 2");
		});
	});

	describe("updateMessageLog", () => {
		it("should update message content and keep edit history", async () => {
			// First create a message
			await call(
				createMessageLog,
				{
					userId: testUserId,
					messageId: "msg-to-update",
					platform: "discord",
					channelId: "channel-update",
					content: "Original message",
				},
				createTestContext(db),
			);

			// Update the message
			const updatedLog = await call(
				updateMessageLog,
				{
					messageId: "msg-to-update",
					platform: "discord",
					newContent: "First edit",
				},
				createTestContext(db),
			);

			expect(updatedLog.content).toBe("First edit");
			expect(updatedLog.editCount).toBe(1);
			expect(updatedLog.editedContents).toEqual(["Original message"]);

			// Update again
			const secondUpdate = await call(
				updateMessageLog,
				{
					messageId: "msg-to-update",
					platform: "discord",
					newContent: "Second edit",
				},
				createTestContext(db),
			);

			expect(secondUpdate.content).toBe("Second edit");
			expect(secondUpdate.editCount).toBe(2);
			expect(secondUpdate.editedContents).toEqual(["Original message", "First edit"]);
		});

		it("should fail when message doesn't exist", async () => {
			await expect(
				call(
					updateMessageLog,
					{
						messageId: "non-existent",
						platform: "discord",
						newContent: "New content",
					},
					createTestContext(db),
				),
			).rejects.toThrow();
		});

		it("should maintain full edit history across multiple edits", async () => {
			// Create a message
			await call(
				createMessageLog,
				{
					userId: testUserId,
					messageId: "msg-history",
					platform: "discord",
					channelId: "channel-history",
					content: "Version 1",
				},
				createTestContext(db),
			);

			// Make multiple edits
			const edits = ["Version 2", "Version 3", "Version 4", "Version 5"];
			let lastUpdate;

			for (const newContent of edits) {
				lastUpdate = await call(
					updateMessageLog,
					{
						messageId: "msg-history",
						platform: "discord",
						newContent,
					},
					createTestContext(db),
				);
			}

			expect(lastUpdate!.content).toBe("Version 5");
			expect(lastUpdate!.editCount).toBe(4);
			expect(lastUpdate!.editedContents).toEqual(["Version 1", "Version 2", "Version 3", "Version 4"]);
		});
	});

	describe("updateMessageDeletedStatus", () => {
		it("should mark message as deleted", async () => {
			// First create a message
			await call(
				createMessageLog,
				{
					userId: testUserId,
					messageId: "msg-to-delete",
					platform: "discord",
					channelId: "channel-delete",
					content: "Message to delete",
				},
				createTestContext(db),
			);

			// Mark as deleted
			const result = await call(
				updateMessageDeletedStatus,
				{
					messageId: "msg-to-delete",
					platform: "discord",
				},
				createTestContext(db),
			);

			expect(result).toBe(true);

			// Verify it's marked as deleted
			const logs = await db
				.select()
				.from(messagesLogsTable)
				.where(and(eq(messagesLogsTable.messageId, "msg-to-delete"), eq(messagesLogsTable.platform, "discord")))
				.limit(1);

			expect(logs[0]?.deletedAt).toBeInstanceOf(Date);
		});

		it("should fail when message doesn't exist", async () => {
			await expect(
				call(
					updateMessageDeletedStatus,
					{
						messageId: "non-existent",
						platform: "discord",
					},
					createTestContext(db),
				),
			).rejects.toThrow();
		});

		it("should update updatedAt timestamp when marking as deleted", async () => {
			// Create a message
			await call(
				createMessageLog,
				{
					userId: testUserId,
					messageId: "msg-timestamp",
					platform: "discord",
					channelId: "channel-timestamp",
					content: "Test timestamp",
				},
				createTestContext(db),
			);

			// Get original timestamps
			const [original] = await db
				.select()
				.from(messagesLogsTable)
				.where(and(eq(messagesLogsTable.messageId, "msg-timestamp"), eq(messagesLogsTable.platform, "discord")))
				.limit(1);

			// Wait a bit to ensure different timestamp
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Mark as deleted
			await call(
				updateMessageDeletedStatus,
				{
					messageId: "msg-timestamp",
					platform: "discord",
				},
				createTestContext(db),
			);

			// Check updated timestamps
			const [updated] = await db
				.select()
				.from(messagesLogsTable)
				.where(and(eq(messagesLogsTable.messageId, "msg-timestamp"), eq(messagesLogsTable.platform, "discord")))
				.limit(1);

			expect(updated!.updatedAt.getTime()).toBeGreaterThan(original!.updatedAt.getTime());
			expect(updated!.deletedAt).toBeInstanceOf(Date);
		});
	});

	describe("updateMessageEditedStatus", () => {
		it("should increment edit count without changing content", async () => {
			// First create a message
			await call(
				createMessageLog,
				{
					userId: testUserId,
					messageId: "msg-edit-status",
					platform: "discord",
					channelId: "channel-edit-status",
					content: "Original content",
				},
				createTestContext(db),
			);

			// Mark as edited
			const result = await call(
				updateMessageEditedStatus,
				{
					messageId: "msg-edit-status",
					platform: "discord",
				},
				createTestContext(db),
			);

			expect(result).toBe(true);

			// Verify edit count increased but content unchanged
			const logs = await db
				.select()
				.from(messagesLogsTable)
				.where(and(eq(messagesLogsTable.messageId, "msg-edit-status"), eq(messagesLogsTable.platform, "discord")))
				.limit(1);

			expect(logs[0]?.editCount).toBe(1);
			expect(logs[0]?.content).toBe("Original content");
			expect(logs[0]?.editedContents).toEqual([]); // No content history since we didn't provide new content
		});

		it("should fail when message doesn't exist", async () => {
			await expect(
				call(
					updateMessageEditedStatus,
					{
						messageId: "non-existent",
						platform: "discord",
					},
					createTestContext(db),
				),
			).rejects.toThrow();
		});

		it("should handle multiple edit status updates", async () => {
			// Create a message
			await call(
				createMessageLog,
				{
					userId: testUserId,
					messageId: "msg-multi-edit",
					platform: "discord",
					channelId: "channel-multi-edit",
					content: "Content",
				},
				createTestContext(db),
			);

			// Mark as edited multiple times
			for (let i = 0; i < 3; i++) {
				await call(
					updateMessageEditedStatus,
					{
						messageId: "msg-multi-edit",
						platform: "discord",
					},
					createTestContext(db),
				);
			}

			// Check final edit count
			const logs = await db
				.select()
				.from(messagesLogsTable)
				.where(and(eq(messagesLogsTable.messageId, "msg-multi-edit"), eq(messagesLogsTable.platform, "discord")))
				.limit(1);

			expect(logs[0]?.editCount).toBe(3);
			expect(logs[0]?.content).toBe("Content"); // Content should remain unchanged
		});
	});

	describe("database integrity", () => {
		it("should maintain referential integrity with users", async () => {
			// Create a message log
			await call(
				createMessageLog,
				{
					userId: testUserId,
					messageId: "msg-integrity-channel",
					platform: "discord",
					channelId: "integrity-channel",
					content: "Test integrity",
				},
				createTestContext(db),
			);

			// Verify message log exists
			const logsBefore = await db.select().from(messagesLogsTable).where(eq(messagesLogsTable.userId, testUserId));

			expect(logsBefore.length).toBeGreaterThan(0);

			// Delete the user (should cascade delete message logs if foreign key exists)
			// Note: The schema doesn't have a foreign key constraint, so messages will remain
			await db.delete(usersTable).where(eq(usersTable.id, testUserId));

			// Since there's no foreign key constraint, messages should still exist
			const logsAfter = await db.select().from(messagesLogsTable).where(eq(messagesLogsTable.userId, testUserId));

			// Messages should still exist since userId is just an integer without FK constraint
			expect(logsAfter.length).toBe(logsBefore.length);
		});

		it("should reject null userId", async () => {
			// Since userId is nullable in the schema but we validate against it
			await expect(
				call(
					createMessageLog,
					{
						userId: null as any,
						messageId: "msg-no-user-channel", // Explicitly pass null
						platform: "discord",
						channelId: "no-user-channel",
						content: "Message without user",
					},
					createTestContext(db),
				),
			).rejects.toThrow();
		});
	});
});
