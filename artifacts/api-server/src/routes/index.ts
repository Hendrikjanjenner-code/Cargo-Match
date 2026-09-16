import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import companyRouter from "./company";
import vesselsRouter from "./vessels";
import aisRouter from "./ais";
import locationsRouter from "./locations";
import listingsRouter from "./listings";
import marketplaceRouter from "./marketplace";
import matchesRouter from "./matches";
import conversationsRouter from "./conversations";
import notificationsRouter from "./notifications";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(companyRouter);
router.use(vesselsRouter);
router.use(aisRouter);
router.use(locationsRouter);
router.use(listingsRouter);
router.use(marketplaceRouter);
router.use(matchesRouter);
router.use(conversationsRouter);
router.use(notificationsRouter);

export default router;
