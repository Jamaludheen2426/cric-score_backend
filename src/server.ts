import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { sequelize } from './models';
import teamRoutes from './routes/team.routes';
import matchRoutes from './routes/match.routes';

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

// 404
app.use((_, res) => res.status(404).json({ success: false, error: 'Route not found' }));

// Sync DB and start
async function bootstrap() {
  try {
    await sequelize.authenticate();
    console.log('✅ DB connected');
    await sequelize.sync({ alter: true });
    console.log('✅ DB synced');
    app.listen(PORT, () => console.log(`🏏 Cricket scorer API running on port ${PORT}`));
  } catch (e) {
    console.error('❌ Failed to start:', e);
    process.exit(1);
  }
}

bootstrap();

export default app;
