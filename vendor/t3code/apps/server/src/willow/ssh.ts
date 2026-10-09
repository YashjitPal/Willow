/**
 * Desktop-managed SSH environments for Willow's agent tabs. T3's desktop app keeps them in its
 * Electron main process (`apps/desktop/src/ssh`); Willow's has none, so this server keeps them
 * on its behalf, with the same `@t3tools/ssh` manager. The tabs' page reaches them here.
 *
 * Only Willow's own page may: the routes answer requests that present the desktop bootstrap
 * token Willow started the server with, which phones and other paired clients never hold, so
 * no one else can open connections with this computer's SSH keys.
 */
import {
  DesktopSshPasswordPromptCancelledType,
  type DesktopSshEnvironmentTarget,
  type DesktopSshPasswordPromptRequest,
} from "@t3tools/contracts";
import * as NetService from "@t3tools/shared/Net";
import * as SshAuth from "@t3tools/ssh/auth";
import { resolveSshTarget } from "@t3tools/ssh/command";
import { discoverSshHosts } from "@t3tools/ssh/config";
import { SshPasswordPromptError } from "@t3tools/ssh/errors";
import * as SshTunnel from "@t3tools/ssh/tunnel";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import {
  FetchHttpClient,
  HttpClient,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import packageJson from "../../package.json" with { type: "json" };
import * as ServerConfig from "../config.ts";

const PREFIX = "/api/willow/ssh";
export const WILLOW_DESKTOP_HEADER = "x-willow-desktop";
const PROMPT_TIMEOUT_MS = 5 * 60_000;

interface PendingPrompt {
  readonly request: DesktopSshPasswordPromptRequest;
  readonly answer: Deferred.Deferred<string | null>;
}

const PROMPT_CANCELLED = "willow-ssh-prompt-cancelled";

/** A prompt the user dismissed, which T3's page treats as a result rather than a failure. */
const isPromptCancellation = (error: unknown): error is SshPasswordPromptError =>
  error instanceof SshPasswordPromptError && error.cause === PROMPT_CANCELLED;

/** Password prompts waiting on the page, which asks for them while a connection is being made. */
const prompts = new Map<string, PendingPrompt>();
let promptCount = 0;

const passwordPrompt = SshAuth.SshPasswordPrompt.of({
  isAvailable: true,
  request: (request) =>
    Effect.gen(function* () {
      promptCount += 1;
      const requestId = `ssh-prompt-${promptCount}`;
      const answer = yield* Deferred.make<string | null>();
      const now = yield* DateTime.now;
      prompts.set(requestId, {
        request: {
          requestId,
          destination: request.destination,
          username: request.username,
          prompt: request.prompt,
          expiresAt: DateTime.formatIso(DateTime.add(now, { milliseconds: PROMPT_TIMEOUT_MS })),
        },
        answer,
      });
      const password = yield* Deferred.await(answer).pipe(
        Effect.timeoutOption(PROMPT_TIMEOUT_MS),
        Effect.ensuring(Effect.sync(() => prompts.delete(requestId))),
      );
      if (password._tag === "None") {
        return yield* new SshPasswordPromptError({
          message: `SSH authentication timed out for ${request.destination}.`,
        });
      }
      if (password.value === null) {
        return yield* new SshPasswordPromptError({
          message: `SSH authentication cancelled for ${request.destination}.`,
          cause: PROMPT_CANCELLED,
        });
      }
      return password.value;
    }),
});

const isWillowDesktop = (request: HttpServerRequest.HttpServerRequest, token: string | undefined) =>
  token !== undefined && token.length > 0 && request.headers[WILLOW_DESKTOP_HEADER] === token;

const describe = (error: unknown): string => {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
};

type SshRuntime =
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
  | HttpClient.HttpClient
  | NetService.NetService;

const target = (body: Record<string, unknown>) => body.target as DesktopSshEnvironmentTarget;

const routes = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const manager = yield* SshTunnel.SshEnvironmentManager;
  const runtime = yield* Effect.context<SshRuntime>();

  /** A route answering Willow's page with `{ ok, value }` or `{ ok: false, error }`. */
  const route = <A, E>(
    method: "GET" | "POST",
    path: string,
    run: (body: Record<string, unknown>) => Effect.Effect<A, E, SshRuntime | SshAuth.SshPasswordPrompt>,
  ) =>
    HttpRouter.add(
      method,
      `${PREFIX}${path}`,
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        if (!isWillowDesktop(request, config.desktopBootstrapToken)) {
          return HttpServerResponse.text("Not Found", { status: 404 });
        }
        const body =
          method === "GET"
            ? {}
            : yield* request.json.pipe(
                Effect.map((value) =>
                  value && typeof value === "object" ? (value as Record<string, unknown>) : {},
                ),
                Effect.orElseSucceed(() => ({})),
              );
        return yield* run(body).pipe(
          Effect.provideService(SshAuth.SshPasswordPrompt, passwordPrompt),
          Effect.provide(runtime),
          Effect.map((value) => HttpServerResponse.jsonUnsafe({ ok: true, value: value ?? null })),
          Effect.catch((error) =>
            Effect.succeed(HttpServerResponse.jsonUnsafe({ ok: false, error: describe(error) })),
          ),
        );
      }),
    );

  return Layer.mergeAll(
    route("POST", "/discover", () => discoverSshHosts({})),
    route("POST", "/resolve", (body) => resolveSshTarget(String(body.alias ?? "").trim())),
    route("POST", "/ensure", (body) =>
      manager
        .ensureEnvironment(
          target(body),
          body.issuePairingToken === true ? { issuePairingToken: true } : undefined,
        )
        .pipe(
          Effect.catchIf(isPromptCancellation, (error) =>
            Effect.succeed({ type: DesktopSshPasswordPromptCancelledType, message: error.message }),
          ),
        ),
    ),
    route("POST", "/disconnect", (body) => manager.disconnectEnvironment(target(body))),
    route("GET", "/prompts", () =>
      Effect.sync(() => [...prompts.values()].map((prompt) => prompt.request)),
    ),
    route("POST", "/prompts/answer", (body) => {
      const prompt = prompts.get(String(body.requestId ?? ""));
      if (!prompt) return Effect.succeed(false);
      return Deferred.succeed(prompt.answer, typeof body.password === "string" ? body.password : null);
    }),
  );
});

/** The remote runs this server's own release, from its self-contained archive. */
export const layer = Layer.unwrap(routes).pipe(
  Layer.provide(
    SshTunnel.SshEnvironmentManager.layer({
      resolveCliRunner: Effect.succeed({ archiveVersion: packageJson.version }),
    }),
  ),
  Layer.provide(Layer.mergeAll(NetService.layer, FetchHttpClient.layer)),
);
