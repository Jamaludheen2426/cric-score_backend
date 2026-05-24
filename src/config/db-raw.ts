import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Dedicated mysql2 pool used ONLY by hot-path raw SQL (scoring).
 *
 * Separate from the main Sequelize connection so:
 *   - We can enable `multipleStatements: true` here without changing
 *     the rest of the app's query behavior.
 *   - The pool can be tuned independently — small (5) since each
 *     scoring action holds a connection for a few hundred ms.
 *
 * Everything outside scoring continues to use Sequelize.
 */
export const rawPool = mysql.createPool({
  host:     process.env.DB_HOST,
  port:     Number(process.env.DB_PORT) || 3306,
  user:     process.env.DB_USER,
  password: process.env.DB_PASS || process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true'
    ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } as any
    : undefined,
  multipleStatements:    true,   // required for batching reads/writes in one packet
  connectionLimit:       5,
  waitForConnections:    true,
  enableKeepAlive:       true,
  keepAliveInitialDelay: 30000,
  // Aiven MySQL closes idle connections aggressively. Short idle keepalive helps.
});
