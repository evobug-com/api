# 🚀 Evobug API Server

<div align="center">

![Bun](https://img.shields.io/badge/Bun-000000?style=for-the-badge&logo=bun&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)
![Drizzle](https://img.shields.io/badge/Drizzle_ORM-C5F74F?style=for-the-badge&logo=drizzle&logoColor=black)

**High-performance API server for Discord/Guilded community management**

[Features](#-features) • [Quick Start](#-quick-start) • [API Endpoints](#-api-endpoints) • [Testing](#-testing) • [Documentation](#-documentation)

</div>

---

## 📋 Overview

The Evobug API Server is a robust, type-safe backend service built with **Bun** and **TypeScript**. It provides comprehensive moderation, user management, and economy features for Discord and Guilded communities through an ORPC (Object RPC) interface.

### 🎯 Key Highlights

- **🔥 Blazing Fast**: Built on Bun runtime for exceptional performance
- **🛡️ Type-Safe**: Full TypeScript with strict mode and runtime validation via Zod
- **🔄 Real-time Communication**: ORPC-based architecture for seamless client-server interaction
- **📊 Advanced Moderation**: Violation tracking, standing calculation, and suspension management
- **💰 Economy System**: Points, daily rewards, work commands, and leaderboards
- **🗄️ PostgreSQL + Drizzle ORM**: Robust data persistence with type-safe queries

## ✨ Features

### 🛡️ Moderation System
- **Violation Management**: Issue, track, and expire violations with severity levels
- **Standing Calculation**: Dynamic user standing based on violation history
- **Suspension System**: Temporary and permanent account restrictions
- **Review Process**: Appeal and review system for violations
- **Bulk Operations**: Efficient bulk expiration and management

### 👥 User Management
- **Multi-Platform Support**: Discord and Guilded ID linking
- **Role-Based Access**: User, Moderator, and Admin roles
- **Profile Management**: Comprehensive user profiles and settings

### 💰 Economy & Stats
- **Points System**: Earn and spend virtual currency
- **Daily Rewards**: Claim daily bonuses with cooldown tracking
- **Work System**: Work commands with dynamic payouts
- **Leaderboards**: Global and time-based rankings
- **Activity Tracking**: Detailed user activity statistics

### 🔒 Security
- **Authentication Middleware**: Secure endpoint protection
- **Input Validation**: Zod schemas for all API inputs
- **SQL Injection Protection**: Parameterized queries via Drizzle ORM
- **Rate Limiting**: Built-in connection pooling and limits

## 🚀 Quick Start

### Prerequisites

- [Bun](https://bun.sh) (latest version)
- PostgreSQL 14+
- Node.js 18+ (for some tooling compatibility)

### Installation

```bash
# Clone the repository
git clone https://github.com/evobug-com/api.git
cd evobug.com/api

# Install dependencies
bun install

# Set up environment variables
cp .env.example .env
# Edit .env with your DATABASE_URL
```

### Database Setup

```bash
# Generate database schema
bun run db:generate

# Run migrations
bun run db:migrate

# (Optional) Open Drizzle Studio for database management
bun run db:studio
```

### Development

```bash
# Start development server with hot reload
bun run dev

# Server will be available at http://localhost:3001/rpc
```

## 🔌 API Endpoints

The API uses ORPC routing with the following structure:

### User Endpoints
```typescript
users.create         // Create new user
users.get           // Get user by ID
users.update        // Update user profile
users.stats.user    // Get user statistics
users.stats.daily.claim  // Claim daily reward
users.stats.work.claim   // Claim work reward
users.stats.top     // Get leaderboard
```

### Moderation Endpoints
```typescript
moderation.violations.issue      // Issue new violation
moderation.violations.list       // List violations
moderation.violations.expire     // Expire violation
moderation.violations.updateReview  // Update violation review

moderation.standing.get          // Get user standing
moderation.standing.calculate    // Calculate standing score
moderation.standing.bulk         // Bulk standing query
moderation.standing.restrictions // Get active restrictions

moderation.suspensions.create    // Create suspension
moderation.suspensions.lift      // Lift suspension
moderation.suspensions.check     // Check suspension status
moderation.suspensions.history   // Get suspension history
```

## 🧪 Testing

```bash
# Run all tests
bun test

# Run tests in watch mode
bun test:watch

# Run tests with coverage
bun test:coverage

# Run specific test file
bun test src/contract/stats/stats.spec.ts
```

### Test Structure
- Unit tests: `*.spec.ts` files alongside source code
- Uses in-memory database for isolated testing
- Mock context utilities for request simulation

## 📁 Project Structure

```
api/
├── src/
│   ├── contract/          # API endpoints and business logic
│   │   ├── standing/      # Standing calculation system
│   │   ├── stats/         # Economy and statistics
│   │   ├── suspensions/   # Suspension management
│   │   ├── users/         # User management
│   │   ├── violations/    # Violation system
│   │   └── router.ts      # Main API router
│   ├── db/
│   │   └── schema.ts      # Database schema definitions
│   ├── middlewares/
│   │   └── auth.ts        # Authentication middleware
│   ├── utils/             # Utility functions
│   └── server.ts          # Server entry point
├── drizzle/               # Database migrations
├── scripts/               # Utility scripts
└── tests/                 # Test files
```

## 🔧 Configuration

### Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/evobug

# Testing
USE_TEMP_DATABASE=true  # Use in-memory database for testing

# Server
PORT=3001              # API server port
```

### Database Configuration

Configure Drizzle in `drizzle.config.ts`:

```typescript
export default {
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
};
```

## 🛠️ Development Commands

```bash
# Development
bun run dev              # Start dev server with hot reload

# Database
bun run db:generate      # Generate migrations from schema
bun run db:migrate       # Apply migrations
bun run db:push         # Push schema changes directly (dev only)
bun run db:studio       # Open Drizzle Studio GUI
bun run db:drop         # Drop all tables (careful!)

# Testing
bun test                # Run tests
bun test:watch          # Run tests in watch mode
bun test:coverage       # Generate coverage report

# Code Quality
bunx tsgo --noEmit      # Check TypeScript errors
bunx oxlint --type-aware

# Production
bun run migrate:production  # Run production migrations
bun run migrate:data       # Migrate legacy data
```

## 📊 Database Schema

### Core Tables

- **users**: User accounts with platform IDs and roles
- **user_stats**: Economy points and statistics
- **violations**: Moderation actions and warnings
- **suspensions**: Temporary and permanent restrictions
- **user_reviews**: User review and rating system
- **orders**: Purchase and transaction history

### Key Relationships

```mermaid
graph TD
    Users -->|1:1| UserStats
    Users -->|1:N| Violations
    Users -->|1:N| Suspensions
    Users -->|1:N| Orders
    Users -->|1:N| Reviews
    Violations -->|N:1| SeverityLevels
```

## 🚢 Deployment

### Production Deployment

1. Set production environment variables
2. Run database migrations:
   ```bash
   bun run migrate:production
   ```
3. Start the server:
   ```bash
   bun run src/server.ts
   ```

### Using PM2

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'evobug-api',
    script: 'bun',
    args: 'run src/server.ts',
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    }
  }]
};
```

## 🔐 Security Considerations

- Always use parameterized queries (handled by Drizzle ORM)
- Implement rate limiting for public endpoints
- Use HTTPS in production
- Regularly update dependencies
- Never commit `.env` files
- Use strong PostgreSQL passwords
- Enable PostgreSQL SSL in production

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Run tests and linting before committing
4. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
5. Push to the branch (`git push origin feature/AmazingFeature`)
6. Open a Pull Request

### Code Style

- Use tabs for indentation
- Double quotes for strings
- Maximum line width: 120 characters
- Run `bunx oxlint --type-aware` before committing

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Bun](https://bun.sh) - JavaScript runtime
- [Drizzle ORM](https://orm.drizzle.team) - TypeScript ORM
- [ORPC](https://orpc.dev) - Type-safe RPC framework
- [Zod](https://zod.dev) - TypeScript-first schema validation

## 📞 Support

For issues and questions:
- Open an issue on [GitHub](https://github.com/evobug-com/api/issues)
- Join our [Discord server](https://discord.allcom.zone/)

---

<div align="center">
Made with ❤️ by the Evobug Team
</div>