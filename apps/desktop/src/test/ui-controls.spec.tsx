
import React from "react";
import {
  cleanup,
  fireEvent,
  render as rtlRender,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import WorkspaceApp from "../app/shell/WorkspaceApp";
import { TauriClientProvider } from "../services/tauri/TauriClientProvider";
import type { TauriClient } from "../services/tauri/TauriClientProvider";
import { assertVisibleActionableControls } from "./visibleControlAudit";

const tauriApiMocks = vi.hoisted(() => ({
  catalogAddLibraryRoot: vi.fn(),
  catalogCancelIngestJob: vi.fn(),
  catalogGetIngestJob: vi.fn(),
  catalogGetTrack: vi.fn(),
  catalogImportFiles: vi.fn(),
  catalogListTracks: vi.fn(),
  catalogListLibraryRoots: vi.fn(),
  catalogRemoveLibraryRoot: vi.fn(),
  catalogResetLibraryData: vi.fn(),
  catalogScanRoot: vi.fn(),
  catalogUpdateTrackMetadata: vi.fn(),
  getPlaybackContext: vi.fn(),
  getPlaybackDecodeError: vi.fn(),
  initExclusiveDevice: vi.fn(),
  isUiAppError: vi.fn((error: unknown) => {
    if (!error || typeof error !== "object") return false;
    const candidate = error as Record<string, unknown>;
    return typeof candidate.code === "string" && typeof candidate.message === "string";
  }),
  loadFileFromNativePath: vi.fn(),
  pickDirectoryDialog: vi.fn(),
  pickFileDialog: vi.fn(),
  qcGetFeatureFlags: vi.fn(),
  qcGetActivePreviewMedia: vi.fn(),
  qcGetBatchExportJobStatus: vi.fn(),
  qcGetPreviewSession: vi.fn(),
  qcListCodecProfiles: vi.fn(),
  qcPreparePreviewSession: vi.fn(),
  qcRevealBlindX: vi.fn(),
  qcSetPreviewVariant: vi.fn(),
  qcStartBatchExport: vi.fn(),
  pushPlaybackTrackChangeRequest: vi.fn(),
  publisherCreateDraftFromTrack: vi.fn(),
  runtimeGetErrorLogPath: vi.fn(),
  seekPlaybackRatio: vi.fn(),
  setPlaybackPlaying: vi.fn(),
  setPlaybackQueue: vi.fn(),
  setPlaybackVolume: vi.fn(),
  togglePlaybackQueueVisibility: vi.fn(),
  videoRenderCancel: vi.fn(),
  videoRenderCheckSourcePath: vi.fn(),
  videoRenderGetEnvironmentDiagnostics: vi.fn(),
  videoRenderOpenOutputFolder: vi.fn(),
  videoRenderResult: vi.fn(),
  videoRenderStart: vi.fn(),
  videoRenderStatus: vi.fn()
}));

const webviewMocks = vi.hoisted(() => ({
  getCurrentWebview: vi.fn(() => ({
    onDragDropEvent: vi.fn(async () => () => undefined)
  }))
}));

const runtimeEventMocks = vi.hoisted(() => ({
  listen: vi.fn(async () => () => undefined)
}));

vi.mock("../services/tauri/tauriClient", () => ({
  catalogAddLibraryRoot: tauriApiMocks.catalogAddLibraryRoot,
  catalogCancelIngestJob: tauriApiMocks.catalogCancelIngestJob,
  catalogGetIngestJob: tauriApiMocks.catalogGetIngestJob,
  catalogGetTrack: tauriApiMocks.catalogGetTrack,
  catalogImportFiles: tauriApiMocks.catalogImportFiles,
  catalogListTracks: tauriApiMocks.catalogListTracks,
  catalogListLibraryRoots: tauriApiMocks.catalogListLibraryRoots,
  catalogRemoveLibraryRoot: tauriApiMocks.catalogRemoveLibraryRoot,
  catalogResetLibraryData: tauriApiMocks.catalogResetLibraryData,
  catalogScanRoot: tauriApiMocks.catalogScanRoot,
  catalogUpdateTrackMetadata: tauriApiMocks.catalogUpdateTrackMetadata,
  getPlaybackContext: tauriApiMocks.getPlaybackContext,
  getPlaybackDecodeError: tauriApiMocks.getPlaybackDecodeError,
  initExclusiveDevice: tauriApiMocks.initExclusiveDevice,
  isUiAppError: tauriApiMocks.isUiAppError,
  loadFileFromNativePath: tauriApiMocks.loadFileFromNativePath,
  pickDirectoryDialog: tauriApiMocks.pickDirectoryDialog,
  pickFileDialog: tauriApiMocks.pickFileDialog,
  qcGetFeatureFlags: tauriApiMocks.qcGetFeatureFlags,
  qcGetActivePreviewMedia: tauriApiMocks.qcGetActivePreviewMedia,
  qcGetBatchExportJobStatus: tauriApiMocks.qcGetBatchExportJobStatus,
  qcGetPreviewSession: tauriApiMocks.qcGetPreviewSession,
  qcListCodecProfiles: tauriApiMocks.qcListCodecProfiles,
  qcPreparePreviewSession: tauriApiMocks.qcPreparePreviewSession,
  qcRevealBlindX: tauriApiMocks.qcRevealBlindX,
  qcSetPreviewVariant: tauriApiMocks.qcSetPreviewVariant,
  qcStartBatchExport: tauriApiMocks.qcStartBatchExport,
  pushPlaybackTrackChangeRequest: tauriApiMocks.pushPlaybackTrackChangeRequest,
  publisherCreateDraftFromTrack: tauriApiMocks.publisherCreateDraftFromTrack,
  runtimeGetErrorLogPath: tauriApiMocks.runtimeGetErrorLogPath,
  seekPlaybackRatio: tauriApiMocks.seekPlaybackRatio,
  setPlaybackPlaying: tauriApiMocks.setPlaybackPlaying,
  setPlaybackQueue: tauriApiMocks.setPlaybackQueue,
  setPlaybackVolume: tauriApiMocks.setPlaybackVolume,
  togglePlaybackQueueVisibility: tauriApiMocks.togglePlaybackQueueVisibility,
  videoRenderCancel: tauriApiMocks.videoRenderCancel,
  videoRenderCheckSourcePath: tauriApiMocks.videoRenderCheckSourcePath,
  videoRenderGetEnvironmentDiagnostics: tauriApiMocks.videoRenderGetEnvironmentDiagnostics,
  videoRenderOpenOutputFolder: tauriApiMocks.videoRenderOpenOutputFolder,
  videoRenderResult: tauriApiMocks.videoRenderResult,
  videoRenderStart: tauriApiMocks.videoRenderStart,
  videoRenderStatus: tauriApiMocks.videoRenderStatus
}));

vi.mock("../features/publisher-ops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../features/publisher-ops")>();
  return {
    ...actual,
    PublisherOpsWorkspace: () => <div data-testid="publisher-ops-mock">Publisher Ops Mock</div>
  };
});

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: webviewMocks.getCurrentWebview
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: runtimeEventMocks.listen
}));
