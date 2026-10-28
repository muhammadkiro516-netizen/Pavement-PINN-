/**
 * Creates the first Koordinator (OPERATIONS_MANAGER) account; every other staff account is
 * then created from the app. Run once per installation:
 *
 *   npm run create-coordinator -- <email> "<name>" "<agency>"
 *
 * The password is read from the PINN_PASSWORD environment variable (min. 8 characters) so it
 * does not end up in shell history.
 */
import path from "node:path";
import { AccountError, AccountStore } from "../server/repositories/accountStore";
import { loadServerConfig } from "../server/config/env";

const [email, name, agency] = process.argv.slice(2);
const password = process.env.PINN_PASSWORD;
if (!email || !name || !agency || !password) {
  console.error('Usage: PINN_PASSWORD=... npm run create-coordinator -- <email> "<name>" "<agency>"');
  process.exit(1);
}

const file = path.join(loadServerConfig().dataDir, "accounts.json");
try {
  const account = new AccountStore(file).create({ email, name, password, agency, role: "OPERATIONS_MANAGER" });
  console.log(`Koordinator ${account.name} <${account.email}> created (${account.id}) in ${file}`);
} catch (error) {
  console.error(error instanceof AccountError ? error.message : error);
  process.exit(1);
}
