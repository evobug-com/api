// Preload drizzle-kit/api-postgres to ensure it's loaded once
// This fixes the "createRequire has already been declared" error
// that occurs when multiple test files import the module
import "drizzle-kit/api-postgres";
