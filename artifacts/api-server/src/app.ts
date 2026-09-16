import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { authMiddleware } from "./middlewares/authMiddleware";
import { configuredOrigins as getConfiguredOrigins } from "./lib/origins";

const app: Express = express();
// Only the local ingress is trusted to supply client IP forwarding headers.
app.set("trust proxy", "loopback");

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
const configuredOrigins = getConfiguredOrigins();
app.use(
  cors({
    credentials: true,
    origin: (origin, callback) => {
      if (!origin || configuredOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const apiRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests; try again shortly." },
});
const loginRateLimit = rateLimit({
  windowMs: 10 * 60_000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many authentication requests; try again later." },
});
app.use("/api", apiRateLimit);
app.use("/api/login", loginRateLimit);

app.use((req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    next();
    return;
  }
  const origin = req.headers.origin;
  if (!origin) {
    next();
    return;
  }
  if (!configuredOrigins.has(origin)) {
    res.status(403).json({ error: "Cross-origin write rejected" });
    return;
  }
  const protocol = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  if (!host || origin !== `${protocol}://${host}`) {
    res.status(403).json({ error: "Cross-origin write rejected" });
    return;
  }
  next();
});

app.use(authMiddleware);

app.use("/api", router);

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    logger.error(
      { errorName: err instanceof Error ? err.name : typeof err },
      "Unhandled request error",
    );
    if (res.headersSent) return;
    res.status(500).json({ error: "Internal server error" });
  },
);

export default app;
