import { Router } from 'express';
import { authRouter } from './modules/auth/auth.routes';
import { farmRouter } from './modules/farm/farm.routes';
import { weatherRouter } from './modules/weather/weather.routes';
import { cropHealthRouter } from './modules/crop-health/crop-health.routes';
import { marketRouter } from './modules/market/market.routes';
import { alertsRouter } from './modules/alerts/alerts.routes';
import { dashboardRouter } from './modules/dashboard/dashboard.routes';
import { recommendationsRouter } from './modules/recommendations/recommendations.routes';
import { planningRouter } from './modules/planning/planning.routes';

/** All API routes, mounted under /api. */
export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/farms', farmRouter);
apiRouter.use('/weather', weatherRouter);
apiRouter.use('/crop-health', cropHealthRouter);
apiRouter.use('/market', marketRouter);
apiRouter.use('/alerts', alertsRouter);
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/recommendations', recommendationsRouter);
apiRouter.use('/planning', planningRouter);
