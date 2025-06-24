import { startServer } from "./app";

(async () => {
  await startServer();
}
)().catch((error) => {
  console.error("Error starting server:", error);
});