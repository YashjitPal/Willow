import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { useHandleNewThread } from "~/hooks/useHandleNewThread";
import { useClientSettings } from "~/hooks/useSettings";
import { findProjectByPath, inferProjectTitleFromPath } from "~/lib/projectPaths";
import { getLatestThreadForProject } from "~/lib/threadSort";
import { newProjectId } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { useProjects, useThreadShells } from "~/state/entities";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { projectEnvironment } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";
import { buildThreadRouteParams } from "~/threadRoutes";

const failed = (title: string, cause: unknown) =>
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: cause instanceof Error ? cause.message : "An error occurred.",
    }),
  );

/**
 * Spark's Add folder, for the agents: the system's folder picker, then the folder as a project on
 * this computer with a new thread in it. A folder that is already a project opens its latest
 * thread instead. Other sources (a new repository, a clone, a remote computer) stay in the command
 * palette's Add project.
 */
export function useAddProjectFromPicker(): () => Promise<void> {
  const environmentId = usePrimaryEnvironmentId();
  const projects = useProjects();
  const threads = useThreadShells();
  const threadSortOrder = useClientSettings((settings) => settings.sidebarThreadSortOrder);
  const { handleNewThread } = useHandleNewThread();
  const navigate = useNavigate();
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });

  return useCallback(async () => {
    const api = readLocalApi();
    if (!api || !environmentId) return;
    let cwd: string | null;
    try {
      cwd = await api.dialogs.pickFolder();
    } catch (cause) {
      failed("Could not open the folder picker", cause);
      return;
    }
    if (!cwd) return;

    const existing = findProjectByPath(
      projects.filter((project) => project.environmentId === environmentId),
      cwd,
    );
    if (existing) {
      const latest = getLatestThreadForProject(
        threads.filter((thread) => thread.environmentId === existing.environmentId),
        existing.id,
        threadSortOrder,
      );
      if (latest && latest.settledOverride !== "settled") {
        await navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(scopeThreadRef(latest.environmentId, latest.id)),
        });
        return;
      }
      const opened = await settlePromise(() => handleNewThread(scopeProjectRef(existing.environmentId, existing.id)));
      if (opened._tag === "Failure") failed("Could not open the project", squashAtomCommandFailure(opened));
      return;
    }

    const projectId = newProjectId();
    const created = await createProject({
      environmentId,
      input: {
        projectId,
        title: inferProjectTitleFromPath(cwd),
        workspaceRoot: cwd,
        createWorkspaceRootIfMissing: false,
        defaultModelSelection: null,
      },
    });
    if (created._tag === "Failure") {
      if (!isAtomCommandInterrupted(created)) failed("Could not add the project", squashAtomCommandFailure(created));
      return;
    }
    const opened = await settlePromise(() => handleNewThread(scopeProjectRef(environmentId, projectId)));
    if (opened._tag === "Failure") failed("Could not add the project", squashAtomCommandFailure(opened));
  }, [createProject, environmentId, handleNewThread, navigate, projects, threadSortOrder, threads]);
}
