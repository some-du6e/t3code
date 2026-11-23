import type {
  DeviceServiceState,
  EnvironmentId,
  MessageId,
  OrchestrationV2ThreadProjection,
  ScopedThreadRef,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import type { ThreadStructure } from "@t3tools/client-runtime/state/shell";
import { rewindFileRestore } from "@t3tools/client-runtime/state/thread-repositories";
import { useAtomValue } from "@effect/atom-react";
import { T, Var } from "gt-react";
import { Atom } from "effect/reactivity";
import type { ComponentProps } from "react";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useRightPanelStore } from "~/rightPanelStore";
import { DeviceSetup } from "../device/DeviceSetup";
import { PullRequestThreadDialog } from "../PullRequestThreadDialog";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { WizardPopup } from "../ui/wizard";
import { findRevertCheckpoint } from "../../session-logic";
import { filesystemEnvironment } from "../../state/filesystem";
import { useEnvironmentQuery } from "../../state/query";
import { registerThreadOverlay } from "./threadOverlayRetention";

/**
 * Open state for overlays the chat view hosts. It lives in atoms rather than
 * ChatView state so opening or closing one renders only its host, not the
 * whole chat chrome. Each entry carries the thread it was opened for; a host
 * shows only its own thread's entry, and leaving that thread's route drops it.
 */
type ThreadOverlayAtom<T> = Atom.Writable<{ readonly threadKey: string; readonly value: T } | null>;

function makeThreadOverlayAtom<T>(label: string): ThreadOverlayAtom<T> {
  const atom = Atom.make<{ readonly threadKey: string; readonly value: T } | null>(null).pipe(
    Atom.keepAlive,
    Atom.withLabel(`chat:${label}`),
  );
  registerThreadOverlay((threadKey) => {
    const entry = appAtomRegistry.get(atom);
    if (entry !== null && entry.threadKey !== threadKey) closeThreadOverlay(atom);
  });
  return atom;
}

function closeThreadOverlay<T>(atom: ThreadOverlayAtom<T>): void {
  appAtomRegistry.set(atom, null);
}

function useThreadOverlay<T>(atom: ThreadOverlayAtom<T>, threadKey: string | null): T | null {
  const entry = useAtomValue(atom);
  return threadKey !== null && entry?.threadKey === threadKey ? entry.value : null;
}

const pullRequestThreadDialogAtom = makeThreadOverlayAtom<{
  readonly initialReference: string | null;
  readonly key: number;
}>("pull-request-thread-dialog");

export function openPullRequestThreadDialog(threadKey: string, reference?: string): void {
  appAtomRegistry.set(pullRequestThreadDialogAtom, {
    threadKey,
    value: { initialReference: reference ?? null, key: Date.now() },
  });
}

export function PullRequestThreadDialogHost(props: {
  readonly threadKey: string | null;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly cwd: string | null;
  readonly onPrepared: (input: {
    branch: string;
    worktreePath: string | null;
    pullRequestUrl: string;
  }) => Promise<void> | void;
}) {
  const state = useThreadOverlay(pullRequestThreadDialogAtom, props.threadKey);
  if (state === null) return null;
  return (
    <PullRequestThreadDialog
      key={state.key}
      open
      environmentId={props.environmentId}
      threadId={props.threadId}
      cwd={props.cwd}
      initialReference={state.initialReference}
      onOpenChange={(open) => {
        if (!open) closeThreadOverlay(pullRequestThreadDialogAtom);
      }}
      onPrepared={props.onPrepared}
    />
  );
}

const deviceSetupDialogAtom = makeThreadOverlayAtom<true>("device-setup-dialog");

export function openDeviceSetupDialog(threadKey: string): void {
  appAtomRegistry.set(deviceSetupDialogAtom, { threadKey, value: true });
}

export function DeviceSetupDialogHost(props: {
  readonly threadKey: string | null;
  readonly threadRef: ScopedThreadRef | null;
  readonly state: DeviceServiceState;
}) {
  const open = useThreadOverlay(deviceSetupDialogAtom, props.threadKey) !== null;
  const { threadRef } = props;
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) closeThreadOverlay(deviceSetupDialogAtom);
      }}
    >
      <WizardPopup>
        {threadRef ? (
          <DeviceSetup
            environmentId={threadRef.environmentId}
            state={props.state}
            onComplete={() => {
              useRightPanelStore.getState().open(threadRef, "device");
              closeThreadOverlay(deviceSetupDialogAtom);
            }}
          />
        ) : null}
      </WizardPopup>
    </Dialog>
  );
}

const branchRestoreConfirmAtom = makeThreadOverlayAtom<true>("branch-restore-confirm");

export function openBranchRestoreConfirm(threadKey: string): void {
  appAtomRegistry.set(branchRestoreConfirmAtom, { threadKey, value: true });
}

export function BranchRestoreConfirmHost(props: {
  readonly threadKey: string | null;
  readonly threadBranch: string;
  readonly canWriteSourceControl: boolean;
  readonly onConfirm: () => void;
}) {
  const open = useThreadOverlay(branchRestoreConfirmAtom, props.threadKey) !== null;
  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) closeThreadOverlay(branchRestoreConfirmAtom);
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>
            <T>
              Switch to{" "}
              <code className="font-medium">
                <Var>{props.threadBranch}</Var>
              </code>
              ?
            </T>
          </AlertDialogTitle>
          <AlertDialogDescription>
            <T>
              You have uncommitted changes. They'll carry over to the other branch, or block the
              switch if they conflict.
            </T>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>
            <T>Cancel</T>
          </AlertDialogClose>
          <Button
            variant="default"
            disabled={!props.canWriteSourceControl}
            onClick={() => {
              closeThreadOverlay(branchRestoreConfirmAtom);
              props.onConfirm();
            }}
          >
            <T>Switch branch</T>
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

interface PendingRevert {
  readonly turnCount: number;
  readonly messageId: MessageId;
}

const revertConfirmAtom = makeThreadOverlayAtom<PendingRevert>("revert-confirm");

export function openRevertConfirm(threadKey: string, pending: PendingRevert): void {
  appAtomRegistry.set(revertConfirmAtom, { threadKey, value: pending });
}

export function RevertConfirmHost(props: {
  readonly threadKey: string;
  readonly environmentId: EnvironmentId;
  /** The thread's worktree, which may be a task folder. */
  readonly taskFolderPath: string | null;
  readonly projection: Pick<
    OrchestrationV2ThreadProjection,
    "checkpoints" | "checkpointScopes"
  > | null;
  readonly worktreePath: string | null;
  readonly onConfirm: (turnCount: number, messageId: MessageId, restoreFiles: boolean) => void;
}) {
  const pending = useThreadOverlay(revertConfirmAtom, props.threadKey);
  const checkpoint =
    pending === null ? undefined : findRevertCheckpoint(props.projection, pending.turnCount);
  // Only a missing snapshot depends on the task folder: its repositories may still restore.
  const taskFolderQuery = useEnvironmentQuery(
    checkpoint?.status === "missing" && props.taskFolderPath !== null
      ? filesystemEnvironment.taskFolder({
          environmentId: props.environmentId,
          input: { worktreePath: props.taskFolderPath },
        })
      : null,
  );
  const fileRestore =
    // The server refuses file restore outside an isolated worktree.
    props.projection === null || props.worktreePath === null
      ? null
      : rewindFileRestore({
          projection: props.projection,
          checkpoint,
          taskFolder: taskFolderQuery.data?.taskFolder,
        });
  const confirm = (restoreFiles: boolean) => {
    if (pending === null || (restoreFiles && fileRestore === null)) return;
    closeThreadOverlay(revertConfirmAtom);
    props.onConfirm(pending.turnCount, pending.messageId, restoreFiles);
  };
  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) closeThreadOverlay(revertConfirmAtom);
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>
            <T>Edit from here?</T>
          </AlertDialogTitle>
          <AlertDialogDescription>
            {fileRestore === "repositories" ? (
              <T>
                Rewind chat to before this message. Your prompt and attachments return to the
                composer. “Revert repositories too” also undoes your own edits in this thread’s
                repository worktrees. Files in the project folder itself stay as they are.
              </T>
            ) : (
              <T>
                Rewind chat to before this message. Your prompt and attachments return to the
                composer. “Revert files too” also undoes your own edits.
              </T>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>
            <T>Cancel</T>
          </AlertDialogClose>
          <Button
            variant="destructive-outline"
            disabled={fileRestore === null}
            onClick={() => confirm(true)}
          >
            {fileRestore === "repositories" ? (
              <T>Revert repositories too</T>
            ) : (
              <T>Revert files too</T>
            )}
          </Button>
          <Button onClick={() => confirm(false)}>
            <T>Revert and keep changes</T>
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

interface PendingRewind {
  readonly turnCount: number;
  /** A tool call of the turn: only the conversation rewinds, to just after it. */
  readonly afterItemId?: TurnItemId;
}

const rewindConfirmAtom = makeThreadOverlayAtom<PendingRewind>("rewind-confirm");

export function openRewindConfirm(threadKey: string, pending: PendingRewind): void {
  appAtomRegistry.set(rewindConfirmAtom, { threadKey, value: pending });
}

export function RewindConfirmHost(
  props: Omit<ComponentProps<typeof RevertConfirmHost>, "onConfirm" | "projection"> & {
    readonly projection: Pick<
      ThreadStructure,
      "checkpoints" | "checkpointScopes" | "providerThreads" | "thread"
    > | null;
    readonly onConfirm: (
      turnCount: number,
      restoreFiles: boolean,
      afterItemId?: TurnItemId,
    ) => void;
  },
) {
  const pending = useThreadOverlay(rewindConfirmAtom, props.threadKey);
  const afterItemId = pending?.afterItemId;
  const activeProviderThreadId = props.projection?.thread.activeProviderThreadId;
  const activeProviderThread = props.projection?.providerThreads.find(
    (providerThread) => providerThread.id === activeProviderThreadId,
  );
  // Rewinding to a tool call closes Claude's process, which ends its background work.
  const stopsBackgroundWork =
    afterItemId !== undefined && (activeProviderThread?.pendingBackgroundTasks?.length ?? 0) > 0;
  const checkpoint =
    pending === null || afterItemId !== undefined
      ? undefined
      : findRevertCheckpoint(props.projection, pending.turnCount);
  // Only a missing snapshot depends on the task folder: its repositories may still restore.
  const taskFolderQuery = useEnvironmentQuery(
    checkpoint?.status === "missing" && props.taskFolderPath !== null
      ? filesystemEnvironment.taskFolder({
          environmentId: props.environmentId,
          input: { worktreePath: props.taskFolderPath },
        })
      : null,
  );
  const fileRestore =
    // The server refuses file restore outside an isolated worktree.
    props.projection === null || props.worktreePath === null
      ? null
      : rewindFileRestore({
          projection: props.projection,
          checkpoint,
          taskFolder: taskFolderQuery.data?.taskFolder,
        });
  const confirm = (restoreFiles: boolean) => {
    if (pending === null || (restoreFiles && (fileRestore === null || afterItemId !== undefined)))
      return;
    closeThreadOverlay(rewindConfirmAtom);
    props.onConfirm(pending.turnCount, restoreFiles, afterItemId);
  };
  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) closeThreadOverlay(rewindConfirmAtom);
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {/* oxlint-disable-next-line t3code/no-untranslated-copy -- fork-only copy, kept out of the GT catalogs */}
            {"Rewind to here?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {afterItemId !== undefined
              ? // oxlint-disable-next-line t3code/no-untranslated-copy -- fork-only copy, kept out of the GT catalogs
                "Remove everything the agent did after this tool call, and every later turn. The agent picks up from this tool call’s result when you send your next message. Your files stay as they are, and your draft stays in the composer."
              : fileRestore === "repositories"
                ? // oxlint-disable-next-line t3code/no-untranslated-copy -- fork-only copy, kept out of the GT catalogs
                  "Remove every turn after this response. Your draft stays in the composer. You can also put this thread’s repository worktrees back to how this response left them. Files in the project folder itself stay as they are."
                : // oxlint-disable-next-line t3code/no-untranslated-copy -- fork-only copy, kept out of the GT catalogs
                  "Remove every turn after this response. Your draft stays in the composer. You can also put your files back to how this response left them, undoing later edits."}
            {stopsBackgroundWork
              ? // oxlint-disable-next-line t3code/no-untranslated-copy -- fork-only copy, kept out of the GT catalogs
                " Background commands and agents that are still running stop."
              : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>
            <T>Cancel</T>
          </AlertDialogClose>
          {afterItemId === undefined ? (
            <Button
              variant="destructive-outline"
              disabled={fileRestore === null}
              onClick={() => confirm(true)}
            >
              {fileRestore === "repositories" ? (
                <T>Revert repositories too</T>
              ) : (
                <T>Revert files too</T>
              )}
            </Button>
          ) : null}
          <Button onClick={() => confirm(false)}>
            <T>Revert and keep changes</T>
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
