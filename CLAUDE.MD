# Development
- use `bunx tsgo --noEmit` to check typescript errors. If there is no output, it means everything is ok.
- use `bunx oxlint --type-aware` to check lint errors.
- use agent `unit-test-engineer` for creating new tests

# Tests
- All code must have tests.

# Database
- All tables must be prefixed with 'public.' schema
- To create custom migrations: drizzle-kit generate --custom --name=seed-users
- Columns in database are camelCase and not snake_case.
- When you run `drizzle-git generate` please do not forget to add the `drizzle` folder to the git tracking

# Other
- Do not commit any md file unless you are explicitly told to do it.