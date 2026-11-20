import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AZURE_POSTGRES_TOKEN_SCOPE,
  azureEntraPasswordProvider,
  azureEntraPostgresOptions,
  isAzureEntraDatabaseAuth,
  resetAzureEntraCredentialsForTests,
} from "./azure-entra-auth.js";
import { postgresJsOptions } from "./client.js";

afterEach(() => {
  resetAzureEntraCredentialsForTests();
  vi.unstubAllEnvs();
});

describe("isAzureEntraDatabaseAuth", () => {
  it("is off when unset, empty, or password", () => {
    expect(isAzureEntraDatabaseAuth({})).toBe(false);
    expect(isAzureEntraDatabaseAuth({ DATABASE_AUTH_MODE: "" })).toBe(false);
    expect(isAzureEntraDatabaseAuth({ DATABASE_AUTH_MODE: "password" })).toBe(false);
  });

  it("is on for azure-entra, ignoring case and whitespace", () => {
    expect(isAzureEntraDatabaseAuth({ DATABASE_AUTH_MODE: " Azure-Entra " })).toBe(true);
  });

  it("rejects unknown values instead of silently falling back to passwords", () => {
    expect(() => isAzureEntraDatabaseAuth({ DATABASE_AUTH_MODE: "iam" })).toThrow(/DATABASE_AUTH_MODE/);
  });
});

describe("azureEntraPostgresOptions", () => {
  it("adds nothing by default", () => {
    expect(azureEntraPostgresOptions({})).toEqual({});
  });

  it("supplies a password function and requires TLS in azure-entra mode", () => {
    const options = azureEntraPostgresOptions({ DATABASE_AUTH_MODE: "azure-entra" });
    expect(options.ssl).toBe("require");
    expect(typeof options.password).toBe("function");
  });

  it("requests the PostgreSQL scope and returns the token", async () => {
    const getToken = vi.fn(async () => ({ token: "tok-1" }));
    const factory = vi.fn(async () => ({ getToken }));
    const password = azureEntraPasswordProvider({ AZURE_CLIENT_ID: " client-1 " }, factory);
    await expect(password()).resolves.toBe("tok-1");
    expect(factory).toHaveBeenCalledWith("client-1");
    expect(getToken).toHaveBeenCalledWith(AZURE_POSTGRES_TOKEN_SCOPE);
  });

  it("builds one credential per client id and asks it for a token on every connection", async () => {
    const getToken = vi.fn(async () => ({ token: "tok" }));
    const factory = vi.fn(async () => ({ getToken }));
    const password = azureEntraPasswordProvider({}, factory);
    await password();
    await password();
    await azureEntraPasswordProvider({}, factory)();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith(undefined);
    expect(getToken).toHaveBeenCalledTimes(3);
  });

  it("fails clearly when no token comes back, and retries credential creation after a failure", async () => {
    const empty = azureEntraPasswordProvider({}, async () => ({ getToken: async () => null }));
    await expect(empty()).rejects.toThrow(/no access token/);

    resetAzureEntraCredentialsForTests();
    const factory = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ getToken: async () => ({ token: "ok" }) });
    const password = azureEntraPasswordProvider({}, factory);
    await expect(password()).rejects.toThrow("boom");
    await new Promise((resolve) => setImmediate(resolve));
    await expect(password()).resolves.toBe("ok");
  });
});

describe("postgresJsOptions with DATABASE_AUTH_MODE", () => {
  it("is unchanged when the variable is unset", () => {
    vi.stubEnv("DATABASE_AUTH_MODE", "");
    expect(postgresJsOptions({})).toEqual({});
  });

  it("adds the Entra password function and TLS alongside the pool options", () => {
    vi.stubEnv("DATABASE_AUTH_MODE", "azure-entra");
    const options = postgresJsOptions({ maxConnections: 5 });
    expect(options).toMatchObject({ max: 5, ssl: "require" });
    expect(typeof options.password).toBe("function");
  });
});
