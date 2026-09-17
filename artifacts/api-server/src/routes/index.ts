import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import companyRouter from "./company";
import vesselsRouter from "./vessels";
import aisRouter from "./ais";
import aisIdentitiesRouter from "./aisIdentities";
import locationsRouter from "./locations";
import listingsRouter from "./listings";
import marketplaceRouter from "./marketplace";
import matchesRouter from "./matches";
import conversationsRouter from "./conversations";
import notificationsRouter from "./notifications";
import availabilitySuggestionsRouter from "./availabilitySuggestions";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(companyRouter);
router.use(vesselsRouter);
router.use(aisRouter);
router.use(aisIdentitiesRouter);
router.use(locationsRouter);
router.use(listingsRouter);
router.use(marketplaceRouter);
router.use(matchesRouter);
router.use(conversationsRouter);
router.use(notificationsRouter);
router.use(availabilitySuggestionsRouter);

export default router;
