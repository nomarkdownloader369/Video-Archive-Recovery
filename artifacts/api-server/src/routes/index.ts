import { Router, type IRouter } from "express";
import healthRouter from "./health";

const router: IRouter = Router();
const videosRouter = process.env.DATABASE_URL?.trim()
  ? (await import("./videos")).default
  : (await import("./videos-memory")).default;

router.use(healthRouter);
router.use("/pf", videosRouter);

export default router;
