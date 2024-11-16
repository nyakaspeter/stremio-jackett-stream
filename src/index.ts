import "./utils/dotenv.js";

import express from "express";
import { serveHTTP } from "./addon/server.js";
import { router } from "./router.js";
import { serveHTTPS } from "./utils/https.js";

const PORT = Number(process.env.PORT) || 58827;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 58828;

const main = async () => {
  const app = await serveHTTP(PORT);
  app.use(express.json()).use(router);
  await serveHTTPS(app, PORT, HTTPS_PORT);
};

main();
