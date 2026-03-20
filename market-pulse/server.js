const path = require("path");
const express = require("express");
const dotenv = require("dotenv");
const apiRouter = require("./src/routes/api");
const { SERVER } = require("./src/config/sources");

dotenv.config({ quiet: true });

const app = express();
const publicDir = path.join(__dirname, "public");

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.use("/api", (request, response, next) => {
    response.setHeader("Cache-Control", "no-store, max-age=0");
    next();
});

app.use("/api", apiRouter);
app.use(express.static(publicDir, { extensions: ["html"] }));

app.use((request, response) => {
    response.sendFile(path.join(publicDir, "index.html"));
});

app.listen(SERVER.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Market Pulse Decision Engine running on http://localhost:${SERVER.port}`);
});
