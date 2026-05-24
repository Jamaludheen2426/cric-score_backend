import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { sequelize } from './models';
import teamRoutes from './routes/team.routes';
import matchRoutes from './routes/match.routes';
import tournamentRoutes from './routes/tournament.routes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
const corsOrigins = (process.env.CORS_ORIGIN || '*')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({ origin: corsOrigins.includes('*') ? '*' : corsOrigins }));
app.use(express.json());

// Health check
app.get('/health', (_, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Routes
app.use('/api/teams', teamRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/tournaments', tournamentRoutes);

// 404
app.use((_, res) => res.status(404).json({ success: false, error: 'Route not found' }));

// Sync DB and start.
//
// NEVER use `sync({ alter: true })` in production: every boot would try to
// re-create UNIQUE indexes, and MySQL caps each table at 64 keys, so after
// ~60 redeploys the service stops booting (ER_TOO_MANY_KEYS). We did just
// hit that — the duplicate indexes were cleaned up via scripts/fix_indexes.js
// and this code now defaults to plain `sync()` which only creates tables
// that don't exist yet. Schema changes go through a proper migration.
//
// Setting DB_SYNC_ALTER=true in env opts in to the old behaviour (useful
// only on a clean local dev DB).
async function bootstrap() {
  try {
    await sequelize.authenticate();
    console.log('✅ DB connected');
    const useAlter = process.env.DB_SYNC_ALTER === 'true';
    await sequelize.sync(useAlter ? { alter: true } : {});
    console.log(useAlter ? '✅ DB synced (alter)' : '✅ DB schema verified');
    app.listen(PORT, () => console.log(`🏏 Cricket scorer API running on port ${PORT}`));
  } catch (e) {
    console.error('❌ Failed to start:', e);
    process.exit(1);
  }
}

bootstrap();

export default app;
