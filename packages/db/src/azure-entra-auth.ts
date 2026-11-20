/**
 * Microsoft Entra (Azure AD) authentication for Azure Database for PostgreSQL.
 *
 * Enabled with `DATABASE_AUTH_MODE=azure-entra`. The connection URL then carries
 * no password (`postgres://<identity-name>@<host>:5432/<db>`); postgres.js calls
 * the `password` function each time it opens a connection, and we answer with a
 * short-lived Entra access token. When the variable is unset nothing here runs
 * and the driver options are exactly what they were before.
 *
 * Credential choice: `AZURE_CLIENT_ID` names a user-assigned managed identity
 * and selects `ManagedIdentityCredential`. Without it, `DefaultAzureCredential`
 * covers system-assigned identities, workload identity and local `az login`.
 * `@azure/identity` caches tokens and refreshes them before they expire.
 */
export const AZURE_ENTRA_DATABASE_AUTH_MODE = "azure-entra";
export const AZURE_POSTGRES_TOKEN_SCOPE = "https://ossrdbms-aad.database.windows.net/.default";

export interface AzureTokenCredential {
  getToken(scope: string): Promise<{ token: string } | null>;
}

type CredentialFactory = (clientId: string | undefined) => Promise<AzureTokenCredential>;

async function defaultCredentialFactory(clientId: string | undefined): Promise<AzureTokenCredential> {
  // Loaded lazily so installs that never enable Entra auth do not pay for it.
  const identity = await import("@azure/identity");
  return clientId
    ? new identity.ManagedIdentityCredential({ clientId })
    : new identity.DefaultAzureCredential();
}

export function isAzureEntraDatabaseAuth(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.DATABASE_AUTH_MODE?.trim().toLowerCase();
  if (!raw || raw === "password") return false;
  if (raw === AZURE_ENTRA_DATABASE_AUTH_MODE) return true;
  throw new Error(`DATABASE_AUTH_MODE must be "password" or "${AZURE_ENTRA_DATABASE_AUTH_MODE}", got "${env.DATABASE_AUTH_MODE}"`);
}

/** One credential per client id, shared by every pool in the process so tokens are cached once. */
const credentialsByClientId = new Map<string, Promise<AzureTokenCredential>>();

export function azureEntraPasswordProvider(
  env: NodeJS.ProcessEnv = process.env,
  createCredential: CredentialFactory = defaultCredentialFactory,
): () => Promise<string> {
  const clientId = env.AZURE_CLIENT_ID?.trim() || undefined;
  const cacheKey = clientId ?? "";
  return async () => {
    let credential = credentialsByClientId.get(cacheKey);
    if (!credential) {
      credential = createCredential(clientId);
      credentialsByClientId.set(cacheKey, credential);
      // A failed construction must not be cached forever.
      credential.catch(() => credentialsByClientId.delete(cacheKey));
    }
    const token = await (await credential).getToken(AZURE_POSTGRES_TOKEN_SCOPE);
    if (!token?.token) throw new Error("Microsoft Entra returned no access token for PostgreSQL");
    return token.token;
  };
}

/**
 * postgres.js options for the configured auth mode: empty unless
 * `DATABASE_AUTH_MODE=azure-entra`.
 */
export function azureEntraPostgresOptions(
  env: NodeJS.ProcessEnv = process.env,
  createCredential?: CredentialFactory,
): Record<string, unknown> {
  if (!isAzureEntraDatabaseAuth(env)) return {};
  return { password: azureEntraPasswordProvider(env, createCredential), ssl: "require" };
}

/** Test hook: forget cached credentials. */
export function resetAzureEntraCredentialsForTests(): void {
  credentialsByClientId.clear();
}
