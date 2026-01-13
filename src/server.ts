import express, { Request, Response } from 'express';
import { environment, validateConfig } from './config/constants';

const app = express();
const PORT = environment.EXPRESS_PORT;

if (!PORT) {
  throw new Error('Missing EXPRESS_PORT environment variable');
}

app.use(express.json());

/**
 * Health check endpoint
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'cisco-discord-agent'
  });
});

/**
 * Start the Express server
 */
export function startServer() {
  validateConfig();
  app.listen(PORT, () => {
    console.log(`✅ Health server running on port ${PORT}`);
    console.log(`   Health check: http://localhost:${PORT}/health`);
  });
}

export default app;

