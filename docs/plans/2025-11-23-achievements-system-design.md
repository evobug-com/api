# Achievements System Design

**Date:** 2025-11-23
**Status:** Approved

## Overview

Design and implement a flexible achievements system for tracking user accomplishments, progress, and unlocks. The system provides storage and API endpoints for achievement definitions and user progress tracking.

## Goals

- Track which achievements users have unlocked
- Make it easy to add new achievements via API
- Support complex achievement types (streaks, combinations, milestones)
- Provide flexible progress tracking through metadata
- Display achievements in user profiles/badges

## Design Decisions

### Storage Approach
- **Minimal achievement definitions** - Only store `id`, `name`, `description` in the achievements table
- **Flexible progress tracking** - Use JSONB metadata field for bot-driven progress tracking
- **API-driven** - All achievement logic and triggering handled by the bot, API only provides storage and CRUD

### Achievement Types Supported
- **Simple milestones** - One-time unlocks (boolean status)
- **Tiered achievements** - Multiple tiers as separate achievement entries
- **Progress-tracked** - Metadata stores intermediate progress (e.g., 47/100)

## Database Schema

### achievements table
Stores achievement definitions.

```typescript
export const achievementsTable = pgTable("achievements", {
  id: serial().primaryKey(),
  name: varchar({ length: 255 }).notNull(),
  description: text(),

  createdAt: timestamptz().notNull().defaultNow(),
  updatedAt: timestamptz().notNull().defaultNow(),
});
```

**Fields:**
- `id` - Primary key
- `name` - Achievement name (e.g., "Worker I", "Investor Pro")
- `description` - Achievement description (e.g., "Complete 100 work activities")
- `createdAt` - When achievement was created
- `updatedAt` - When achievement was last modified

### user_achievements table
Tracks user progress and unlocks.

```typescript
export const userAchievementsTable = pgTable(
  "user_achievements",
  {
    id: serial().primaryKey(),

    userId: integer()
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),

    achievementId: integer()
      .notNull()
      .references(() => achievementsTable.id, { onDelete: "cascade" }),

    // When null = in progress or not started
    // When set = achievement unlocked
    unlockedAt: timestamptz(),

    // Flexible JSON field for progress tracking
    // Examples: { "count": 47, "target": 100 }
    //           { "streak": 5, "best": 10 }
    //           { "value": 1500.50, "transactions": 12 }
    metadata: jsonb().$type<Record<string, unknown>>().default({}),

    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [
    // Prevent duplicates - one entry per user per achievement
    uniqueIndex("user_achievements_user_achievement_idx").on(
      table.userId,
      table.achievementId
    ),

    index("user_achievements_userId_idx").on(table.userId),
    index("user_achievements_achievementId_idx").on(table.achievementId),
    index("user_achievements_unlockedAt_idx").on(table.unlockedAt),
  ]
);
```

**Fields:**
- `id` - Primary key
- `userId` - Reference to users table (CASCADE on delete)
- `achievementId` - Reference to achievements table (CASCADE on delete)
- `unlockedAt` - Timestamp when unlocked (null = in progress/not started)
- `metadata` - JSONB field for flexible progress tracking
- `createdAt` - When progress entry was created
- `updatedAt` - When progress was last updated

**Indexes:**
- Unique constraint on `(userId, achievementId)` - prevents duplicate entries
- Index on `userId` - fast user lookups
- Index on `achievementId` - fast achievement lookups
- Index on `unlockedAt` - filter unlocked achievements

## API Design

### Router Structure

```typescript
users: {
  achievements: {
    // Achievement definitions (CRUD)
    definitions: {
      create: createAchievement,           // POST /users/achievements/definitions
      list: listAchievements,              // GET /users/achievements/definitions
      get: getAchievement,                 // GET /users/achievements/definitions/{id}
      update: updateAchievement,           // PUT /users/achievements/definitions/{id}
      delete: deleteAchievement,           // DELETE /users/achievements/definitions/{id}
    },

    // User progress tracking
    progress: {
      upsert: upsertUserAchievement,       // POST /users/achievements/progress
      get: getUserAchievementProgress,     // GET /users/achievements/progress
      list: listUserAchievements,          // GET /users/achievements/progress/list
      unlock: unlockAchievement,           // PUT /users/achievements/progress/unlock
      delete: deleteUserAchievementProgress, // DELETE /users/achievements/progress
    },
  },
}
```

### Endpoint Details

#### Achievement Definitions

**createAchievement** - Create new achievement
- Input: `{ name, description }`
- Output: Created achievement object

**listAchievements** - List all achievements
- Input: None
- Output: Array of achievements ordered by name

**getAchievement** - Get single achievement
- Input: `{ id }`
- Output: Achievement object

**updateAchievement** - Update achievement
- Input: `{ id, name?, description? }`
- Output: Updated achievement object

**deleteAchievement** - Delete achievement
- Input: `{ id }`
- Output: Deleted achievement object

#### User Progress

**upsertUserAchievement** - Create or update progress
- Input: `{ userId, achievementId, metadata? }`
- Output: User achievement object
- Uses `onConflictDoUpdate` to update metadata if entry exists

**getUserAchievementProgress** - Get user's progress for specific achievement
- Input: `{ userId, achievementId }`
- Output: User achievement object or null

**listUserAchievements** - Get all achievements for a user
- Input: `{ userId, unlockedOnly?: boolean }`
- Output: Array of user achievements ordered by unlockedAt (desc)

**unlockAchievement** - Mark achievement as unlocked
- Input: `{ userId, achievementId }`
- Output: Updated user achievement with unlockedAt set

**deleteUserAchievementProgress** - Remove progress entry
- Input: `{ userId, achievementId }`
- Output: Deleted user achievement object

## Metadata Usage Examples

### Progress Counter
```json
{
  "current": 47,
  "target": 100
}
```

### Streak Tracking
```json
{
  "currentStreak": 5,
  "bestStreak": 12,
  "lastActivityDate": "2025-11-23"
}
```

### Investment Milestones
```json
{
  "totalProfit": 15000,
  "transactionCount": 47,
  "bestTrade": 2500
}
```

### Multi-requirement Achievement
```json
{
  "requirements": {
    "workCount": 50,
    "messageCount": 100,
    "voiceMinutes": 60
  },
  "completed": {
    "workCount": true,
    "messageCount": true,
    "voiceMinutes": false
  }
}
```

## Implementation Plan

1. **Database Schema** - Add tables to `src/db/schema.ts`
2. **Migrations** - Generate and apply Drizzle migration
3. **Contracts** - Create `src/contract/achievements/` directory
4. **Router Integration** - Add achievements endpoints to router
5. **Tests** - Write comprehensive tests for all endpoints
6. **TypeScript Check** - Ensure no type errors
7. **Lint Check** - Pass oxlint validation

## Testing Strategy

- Test achievement CRUD operations
- Test user progress upsert (insert + update scenarios)
- Test unlock functionality
- Test unique constraint enforcement
- Test cascade deletes
- Test metadata flexibility with various JSON structures
- Test filtering (unlockedOnly flag)

## Future Enhancements (Out of Scope)

- Achievement rewards (XP, coins) stored in achievements table
- Achievement categories/tags
- Secret achievements (isSecret flag)
- Display order/priority
- Icon/image URLs
- Leaderboards for competitive achievements
- Achievement rarity tiers
