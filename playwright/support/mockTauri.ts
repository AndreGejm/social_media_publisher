
import type { Page } from "@playwright/test";

export type MockTrackSeed = {
  path: string;
  title?: string;
  artist?: string;
  album?: string | null;
  durationMs?: number;
  loudnessLufs?: number;
  sourceRootPath?: string | null;
};

export type MockCommandError = {
  command: string;
  code: string;
  message: string;
};

export type MockTauriScenario = {
  initialTracks?: MockTrackSeed[];
  initialRoots?: string[];
  timeoutCommands?: string[];
  commandErrors?: MockCommandError[];
  renderDiagnosticsBlocked?: boolean;
  ingestPollsBeforeComplete?: number;
};

type PublicMockState = {
  tracks: Array<{ id: string; title: string; path: string }>;
  roots: Array<{ id: string; path: string }>;
  queuePaths: string[];
  playback: {
    activeQueueIndex: number;
    isPlaying: boolean;
    positionSeconds: number;
    trackDurationSeconds: number;
    isQueueVisible: boolean;
    volumeScalar: number;
  };
  commandLog: Array<{ command: string; args: Record<string, unknown> | null }>;
};

export async function installMockTauriBridge(
  page: Page,
  scenario: MockTauriScenario = {}
): Promise<void> {
  await page.addInitScript(
    ({ scenario: serializedScenario }) => {
      type MockUiAppError = {
        code: string;
        message: string;
      };

      type InternalTrack = {
        track_id: string;
        title: string;
        artist_name: string;
        album_title: string | null;
        duration_ms: number;
        loudness_lufs: number;
        file_path: string;
        media_fingerprint: string;
        updated_at: string;
        source_root_path: string | null;
        media_asset_id: string;
        artist_id: string;
      };

      type InternalRoot = {
        root_id: string;
        path: string;
        enabled: boolean;
        created_at: string;
        updated_at: string;
      };

      type InternalIngestJob = {
        job_id: string;
        root_id: string;
        scope: string;
        status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELED";
        total_items: number;
        processed_items: number;
        error_count: number;
        created_at: string;
        updated_at: string;
        poll_count: number;
        plan_paths: string[];
        imported_track_ids: string[];
      };

      type InternalRenderJob = {
        jobId: string;
        outputPath: string;
        polls: number;
        canceled: boolean;
      };

            type ScenarioShape = {
        initialTracks?: Array<{
          path: string;
          title?: string;
          artist?: string;
          album?: string | null;
          durationMs?: number;
          loudnessLufs?: number;
          sourceRootPath?: string | null;
        }>;
        initialRoots?: string[];
        timeoutCommands?: string[];
        commandErrors?: Array<{ command: string; code: string; message: string }>;
        renderDiagnosticsBlocked?: boolean;
        ingestPollsBeforeComplete?: number;
      };

      const scenario = (serializedScenario ?? {}) as ScenarioShape;
      const FIXED_NOW = "2026-03-11T12:00:00.000Z";
      const SUPPORTED_AUDIO_EXTENSIONS = new Set(["wav", "flac", "mp3", "aiff", "aif"]);
      const commandErrors = new Map(
        (scenario.commandErrors ?? []).map((item) => [
          item.command,
          { code: item.code, message: item.message }
        ])
      );
            const timeoutCommands = new Set(scenario.timeoutCommands ?? []);
      const ingestPollsBeforeComplete =
        typeof scenario.ingestPollsBeforeComplete === "number" &&
        Number.isFinite(scenario.ingestPollsBeforeComplete)
          ? Math.max(2, Math.floor(scenario.ingestPollsBeforeComplete))
          : 2;
      const removedTrackStorageKey = "__RP_E2E_REMOVED_TRACK_PATHS__";

      const readRemovedTrackPaths = (): Set<string> => {
        try {
          const raw = window.sessionStorage.getItem(removedTrackStorageKey);
          if (!raw) return new Set<string>();
          const parsed = JSON.parse(raw);
          if (!Array.isArray(parsed)) return new Set<string>();
          return new Set(parsed.map((value) => normalizePath(value)));
        } catch {
          return new Set<string>();
        }
      };

      const writeRemovedTrackPaths = (paths: Iterable<string>) => {
        try {
          window.sessionStorage.setItem(
            removedTrackStorageKey,
            JSON.stringify([...new Set(Array.from(paths, (path) => normalizePath(path)))])
          );
        } catch {
          // Ignore sessionStorage failures in hardened runtimes.
        }
      };

      let trackCounter = 1;
      let rootCounter = 1;
      let ingestJobCounter = 1;
      let renderJobCounter = 1;

      const state = {
        tracks: [] as InternalTrack[],
        roots: [] as InternalRoot[],
        ingestJobs: new Map<string, InternalIngestJob>(),
        renderJobs: new Map<string, InternalRenderJob>(),
        queuePaths: [] as string[],
        commandLog: [] as Array<{ command: string; args: Record<string, unknown> | null }>,
        runtimeErrorEntries: [] as unknown[],
        playback: {
          activeQueueIndex: -1,
          queuedTrackChangeRequests: 0,
          isPlaying: false,
          positionSeconds: 0,
          trackDurationSeconds: 0,
          isQueueVisible: false,
          volumeScalar: 1,
          outputMode: "shared" as "shared" | "exclusive",
          decodeError: null as string | null
        }
      };

      const normalizePath = (value: unknown): string =>
        String(value ?? "")
          .replace(/\\/g, "/")
          .replace(/\/+/g, "/")
          .trim();

      const fileNameFromPath = (path: string): string => {
        const normalized = normalizePath(path);
        const segments = normalized.split("/").filter(Boolean);
        return segments[segments.length - 1] ?? normalized;
      };

      const directoryFromPath = (path: string): string => {
        const normalized = normalizePath(path);
        const segments = normalized.split("/").filter(Boolean);
        if (segments.length <= 1) return normalized;
        return segments.slice(0, -1).join("/");
      };

      const extensionFromPath = (path: string): string => {
        const fileName = fileNameFromPath(path);
        const dotIndex = fileName.lastIndexOf(".");
        return dotIndex >= 0 ? fileName.slice(dotIndex + 1).toLowerCase() : "";
      };

      const baseNameFromPath = (path: string): string => {
        const fileName = fileNameFromPath(path);
        const dotIndex = fileName.lastIndexOf(".");
        return dotIndex >= 0 ? fileName.slice(0, dotIndex) : fileName;
      };

      const makeHexId = (seedChar: string, counter: number): string =>
        `${seedChar.repeat(60)}${counter.toString(16).padStart(4, "0")}`.slice(0, 64);

      const toTrackResponse = (track: InternalTrack) => ({
        track_id: track.track_id,
        title: track.title,
        artist_name: track.artist_name,
        album_title: track.album_title,
        duration_ms: track.duration_ms,
        loudness_lufs: track.loudness_lufs,
        file_path: track.file_path,
        media_fingerprint: track.media_fingerprint,
        updated_at: track.updated_at
      });

      const toTrackDetailResponse = (track: InternalTrack) => ({
        track_id: track.track_id,
        media_asset_id: track.media_asset_id,
        title: track.title,
        artist_id: track.artist_id,
        artist_name: track.artist_name,
        album_id: track.album_title ? makeHexId("d", trackCounter) : null,
        album_title: track.album_title,
        file_path: track.file_path,
        media_fingerprint: track.media_fingerprint,
        track: {
          file_path: track.file_path,
          duration_ms: track.duration_ms,
          peak_data: [-12, -8, -6, -7],
          loudness_lufs: track.loudness_lufs
        },
        sample_rate_hz: 48_000,
        channels: 2,
        true_peak_dbfs: -1.2,
        visibility_policy: "LOCAL",
        license_policy: "ALL_RIGHTS_RESERVED",
        downloadable: false,
        tags: ["mock"],
        created_at: FIXED_NOW,
        updated_at: track.updated_at
      });
      const findTrackByPath = (path: string): InternalTrack | undefined => {
        const normalized = normalizePath(path);
        return state.tracks.find((track) => normalizePath(track.file_path) === normalized);
      };

      const findTrackById = (trackId: unknown): InternalTrack | undefined =>
        state.tracks.find((track) => track.track_id === String(trackId ?? ""));

      const deriveTrackSeed = (path: string) => {
        const baseName = baseNameFromPath(path);
        const [artistCandidate, ...titleParts] = baseName.split(" - ");
        return {
          artist:
            titleParts.length > 0 && artistCandidate.trim().length > 0
              ? artistCandidate.trim()
              : "Mock Artist",
          title:
            titleParts.length > 0
              ? titleParts.join(" - ").trim()
              : baseName.trim() || "Mock Track",
          album: normalizePath(path).toLowerCase().includes("/album/")
            ? "Mock Album"
            : null
        };
      };

      const createTrack = (
        path: string,
        seed?: {
          title?: string;
          artist?: string;
          album?: string | null;
          durationMs?: number;
          loudnessLufs?: number;
          sourceRootPath?: string | null;
        }
      ): InternalTrack => {
        const derived = deriveTrackSeed(path);
        const id = makeHexId("a", trackCounter);
        const track: InternalTrack = {
          track_id: id,
          title: seed?.title ?? derived.title,
          artist_name: seed?.artist ?? derived.artist,
          album_title: seed?.album ?? derived.album,
          duration_ms: seed?.durationMs ?? 180_000 + trackCounter * 1_000,
          loudness_lufs: seed?.loudnessLufs ?? -14.2,
          file_path: normalizePath(path),
          media_fingerprint: makeHexId("b", trackCounter),
          updated_at: FIXED_NOW,
          source_root_path: seed?.sourceRootPath ?? null,
          media_asset_id: makeHexId("c", trackCounter),
          artist_id: makeHexId("d", trackCounter)
        };
        trackCounter += 1;
        state.tracks.push(track);
        return track;
      };

      const createRoot = (path: string): InternalRoot => {
        const normalizedPath = normalizePath(path);
        const existing = state.roots.find((root) => normalizePath(root.path) === normalizedPath);
        if (existing) {
          return existing;
        }
        const root: InternalRoot = {
          root_id: makeHexId("e", rootCounter),
          path: normalizedPath,
          enabled: true,
          created_at: FIXED_NOW,
          updated_at: FIXED_NOW
        };
        rootCounter += 1;
        state.roots.push(root);
        return root;
      };

      const importTrackPath = (
        path: string,
        options?: { sourceRootPath?: string | null }
      ): { imported?: InternalTrack; failure?: { path: string; code: string; message: string } } => {
        const normalizedPath = normalizePath(path);
        const extension = extensionFromPath(normalizedPath);

        if (!normalizedPath) {
          return {
            failure: {
              path: normalizedPath,
              code: "INVALID_PATH",
              message: "Path cannot be empty."
            }
          };
        }

        if (normalizedPath.toLowerCase().includes("corrupt")) {
          return {
            failure: {
              path: normalizedPath,
              code: "CORRUPT_METADATA",
              message: "Metadata parsing failed for this file."
            }
          };
        }

        if (!SUPPORTED_AUDIO_EXTENSIONS.has(extension)) {
          return {
            failure: {
              path: normalizedPath,
              code: "UNSUPPORTED_FORMAT",
              message: "Unsupported file type."
            }
          };
        }

        if (findTrackByPath(normalizedPath)) {
          return {
            failure: {
              path: normalizedPath,
              code: "DUPLICATE_FILE",
              message: "This file is already present in the local catalog."
            }
          };
        }

        return {
          imported: createTrack(normalizedPath, {
            sourceRootPath: options?.sourceRootPath ?? null
          })
        };
      };

      const updatePlaybackDuration = () => {
        if (state.playback.activeQueueIndex < 0 || state.playback.activeQueueIndex >= state.queuePaths.length) {
          state.playback.trackDurationSeconds = 0;
          return;
        }
        const currentPath = state.queuePaths[state.playback.activeQueueIndex];
        const track = findTrackByPath(currentPath);
        state.playback.trackDurationSeconds = track ? track.duration_ms / 1000 : 0;
      };

      const applyConfiguredFailure = (command: string): never | void => {
        if (timeoutCommands.has(command)) {
          throw {
            code: "IPC_TIMEOUT",
            message: `${command} timed out in the mock backend.`
          } satisfies MockUiAppError;
        }

        const configured = commandErrors.get(command);
        if (configured) {
          throw { code: configured.code, message: configured.message } satisfies MockUiAppError;
        }
      };

      const recordCommand = (command: string, args: Record<string, unknown> | undefined) => {
        state.commandLog.push({ command, args: args ?? null });
      };

      const runCatalogListTracks = (args?: Record<string, unknown>) => {
        const query = (args?.query ?? {}) as { search?: string | null; limit?: number | null; offset?: number | null };
        const search = String(query.search ?? "")
          .trim()
          .toLowerCase();
        const offset = typeof query.offset === "number" ? Math.max(0, query.offset) : 0;
        const limit = typeof query.limit === "number" ? Math.max(0, query.limit) : 100;

        const filtered = state.tracks.filter((track) => {
          if (!search) return true;
          const haystack = [
            track.title,
            track.artist_name,
            track.album_title ?? "",
            track.file_path
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(search);
        });

        return {
          items: filtered.slice(offset, offset + limit).map(toTrackResponse),
          total: filtered.length,
          limit,
          offset
        };
      };

      const createScanPlan = (root: InternalRoot): string[] => {
        const normalizedRoot = normalizePath(root.path);
        return [
          `${normalizedRoot}/Scanned Artist - Fresh Root Track.wav`,
          `${normalizedRoot}/Artist One - Imported A.wav`,
          `${normalizedRoot}/Unsupported Document.txt`
        ];
      };

      const completeIngestJob = (job: InternalIngestJob) => {
        if (job.status === "CANCELED") return;

        let importedCount = 0;
        let failureCount = 0;
        for (const path of job.plan_paths) {
          const result = importTrackPath(path, {
            sourceRootPath: state.roots.find((root) => root.root_id === job.root_id)?.path ?? null
          });
          if (result.imported) {
            importedCount += 1;
            job.imported_track_ids.push(result.imported.track_id);
          } else if (result.failure) {
            failureCount += 1;
          }
        }

        job.status = failureCount > 0 && importedCount === 0 ? "FAILED" : "COMPLETED";
        job.processed_items = job.total_items;
        job.error_count = failureCount;
        job.updated_at = FIXED_NOW;
      };

      const publicState = (): PublicMockState => ({
        tracks: state.tracks.map((track) => ({
          id: track.track_id,
          title: track.title,
          path: track.file_path
        })),
        roots: state.roots.map((root) => ({
          id: root.root_id,
          path: root.path
        })),
        queuePaths: [...state.queuePaths],
        playback: {
          activeQueueIndex: state.playback.activeQueueIndex,
          isPlaying: state.playback.isPlaying,
          positionSeconds: state.playback.positionSeconds,
          trackDurationSeconds: state.playback.trackDurationSeconds,
          isQueueVisible: state.playback.isQueueVisible,
          volumeScalar: state.playback.volumeScalar
        },
        commandLog: [...state.commandLog]
      });

      for (const rootPath of scenario.initialRoots ?? []) {
        createRoot(rootPath);
      }

            for (const track of scenario.initialTracks ?? []) {
        if (readRemovedTrackPaths().has(normalizePath(track.path))) {
          continue;
        }
        createTrack(track.path, {
          title: track.title,
          artist: track.artist,
          album: track.album,
          durationMs: track.durationMs,
          loudnessLufs: track.loudnessLufs,
          sourceRootPath: track.sourceRootPath ?? null
        });
      }
      const invoke = async (command: string, args?: Record<string, unknown>) => {
        recordCommand(command, args);
        applyConfiguredFailure(command);

        if (command === "catalog_list_tracks") {
          return runCatalogListTracks(args);
        }

        if (command === "catalog_get_track") {
          const track = findTrackById(args?.trackId);
          return track ? toTrackDetailResponse(track) : null;
        }

        if (command === "catalog_import_files") {
          const imported = [];
          const failed = [];
          const paths = Array.isArray(args?.paths) ? (args?.paths as unknown[]) : [];
          for (const path of paths) {
            const result = importTrackPath(String(path));
            if (result.imported) {
              imported.push(toTrackResponse(result.imported));
            } else if (result.failure) {
              failed.push(result.failure);
            }
          }
          return { imported, failed };
        }

        if (command === "catalog_add_library_root") {
          const root = createRoot(String(args?.path ?? ""));
          return {
            root_id: root.root_id,
            path: root.path,
            enabled: root.enabled,
            created_at: root.created_at,
            updated_at: root.updated_at
          };
        }

        if (command === "catalog_list_library_roots") {
          return state.roots.map((root) => ({
            root_id: root.root_id,
            path: root.path,
            enabled: root.enabled,
            created_at: root.created_at,
            updated_at: root.updated_at
          }));
        }

        if (command === "catalog_scan_root") {
          const rootId = String(args?.rootId ?? "");
          const root = state.roots.find((item) => item.root_id === rootId);
          if (!root) {
            throw {
              code: "ROOT_NOT_FOUND",
              message: "Library root not found."
            } satisfies MockUiAppError;
          }
          const job: InternalIngestJob = {
            job_id: makeHexId("f", ingestJobCounter),
            root_id: root.root_id,
            scope: `SCAN_ROOT:${root.root_id}`,
            status: "RUNNING",
            total_items: 3,
            processed_items: 0,
            error_count: 0,
            created_at: FIXED_NOW,
            updated_at: FIXED_NOW,
            poll_count: 0,
            plan_paths: createScanPlan(root),
            imported_track_ids: []
          };
          ingestJobCounter += 1;
          state.ingestJobs.set(job.job_id, job);
          return { job_id: job.job_id, root_id: root.root_id };
        }

        if (command === "catalog_get_ingest_job") {
          const job = state.ingestJobs.get(String(args?.jobId ?? ""));
          if (!job) return null;

          if (job.status === "RUNNING") {
            job.poll_count += 1;
            if (job.poll_count === 1) {
              job.processed_items = 1;
              job.updated_at = FIXED_NOW;
            } else if (job.poll_count >= ingestPollsBeforeComplete) {
              completeIngestJob(job);
            }
          }

          return {
            job_id: job.job_id,
            status: job.status,
            scope: job.scope,
            total_items: job.total_items,
            processed_items: job.processed_items,
            error_count: job.error_count,
            created_at: job.created_at,
            updated_at: job.updated_at
          };
        }

        if (command === "catalog_cancel_ingest_job") {
          const job = state.ingestJobs.get(String(args?.jobId ?? ""));
          if (!job) return false;
          job.status = "CANCELED";
          job.updated_at = FIXED_NOW;
          return true;
        }

        if (command === "catalog_remove_library_root") {
          const rootId = String(args?.rootId ?? "");
          const root = state.roots.find((item) => item.root_id === rootId);
          if (!root) return false;
          state.roots = state.roots.filter((item) => item.root_id !== rootId);
          state.tracks = state.tracks.filter(
            (track) => normalizePath(track.source_root_path) !== normalizePath(root.path)
          );
          state.queuePaths = state.queuePaths.filter((path) => Boolean(findTrackByPath(path)));
          if (state.playback.activeQueueIndex >= state.queuePaths.length) {
            state.playback.activeQueueIndex = state.queuePaths.length - 1;
          }
          updatePlaybackDuration();
          return true;
        }

        if (command === "catalog_reset_library_data") {
          state.roots = [];
          state.tracks = [];
          state.ingestJobs.clear();
          state.queuePaths = [];
          state.playback.activeQueueIndex = -1;
          state.playback.isPlaying = false;
          state.playback.positionSeconds = 0;
          state.playback.trackDurationSeconds = 0;
          return true;
        }

        if (command === "catalog_update_track_metadata") {
          const input = (args?.input ?? {}) as {
            track_id?: string;
            visibility_policy?: string;
            license_policy?: string;
            downloadable?: boolean;
            tags?: string[];
          };
          const track = findTrackById(input.track_id);
          if (!track) {
            throw {
              code: "TRACK_NOT_FOUND",
              message: "Track not found."
            } satisfies MockUiAppError;
          }
          const detail = toTrackDetailResponse(track);
          detail.visibility_policy = String(input.visibility_policy ?? detail.visibility_policy);
          detail.license_policy = String(input.license_policy ?? detail.license_policy);
          detail.downloadable = Boolean(input.downloadable);
          detail.tags = Array.isArray(input.tags) ? input.tags.map(String) : detail.tags;
          return detail;
        }

        if (command === "init_exclusive_device") {
          const preferExclusive = Boolean(args?.preferExclusive);
          state.playback.outputMode = preferExclusive ? "exclusive" : "shared";
          return {
            sample_rate_hz: Number(args?.targetRateHz ?? 44_100),
            bit_depth: Number(args?.targetBitDepth ?? 16),
            buffer_size_frames: 512,
            is_exclusive_lock: preferExclusive
          };
        }

        if (command === "set_playback_queue") {
          state.queuePaths = Array.isArray(args?.paths)
            ? (args?.paths as unknown[]).map((path) => normalizePath(path))
            : [];
          if (state.queuePaths.length === 0) {
            state.playback.activeQueueIndex = -1;
            state.playback.isPlaying = false;
            state.playback.positionSeconds = 0;
          } else if (
            state.playback.activeQueueIndex < 0 ||
            state.playback.activeQueueIndex >= state.queuePaths.length
          ) {
            state.playback.activeQueueIndex = 0;
          }
          updatePlaybackDuration();
          return { total_tracks: state.queuePaths.length };
        }

        if (command === "push_track_change_request") {
          const newIndex = Number(args?.newIndex ?? -1);
          if (newIndex < 0 || newIndex >= state.queuePaths.length) {
            return false;
          }
          state.playback.activeQueueIndex = newIndex;
          state.playback.positionSeconds = 0;
          state.playback.queuedTrackChangeRequests += 1;
          updatePlaybackDuration();
          return true;
        }

        if (command === "set_playback_playing") {
          const isPlaying = Boolean(args?.isPlaying);
          if (isPlaying && state.playback.activeQueueIndex < 0 && state.queuePaths.length > 0) {
            state.playback.activeQueueIndex = 0;
            updatePlaybackDuration();
          }
          state.playback.isPlaying = isPlaying;
          if (!isPlaying && state.playback.positionSeconds > state.playback.trackDurationSeconds) {
            state.playback.positionSeconds = 0;
          }
          return null;
        }

        if (command === "seek_playback_ratio") {
          const ratio = Number(args?.ratio ?? 0);
          state.playback.positionSeconds = Math.max(
            0,
            Math.min(state.playback.trackDurationSeconds, state.playback.trackDurationSeconds * ratio)
          );
          return null;
        }

        if (command === "set_volume") {
          state.playback.volumeScalar = Math.max(0, Math.min(1, Number(args?.level ?? 1)));
          return null;
        }
        if (command === "toggle_queue_visibility") {
          state.playback.isQueueVisible = !state.playback.isQueueVisible;
          return null;
        }

        if (command === "get_playback_context") {
          updatePlaybackDuration();
          return {
            volume_scalar: state.playback.volumeScalar,
            is_bit_perfect_bypassed: state.playback.outputMode !== "exclusive",
            output_status: {
              requested_mode: state.playback.outputMode,
              active_mode: state.playback.outputMode,
              sample_rate_hz: state.playback.trackDurationSeconds > 0 ? 48_000 : null,
              bit_depth: state.playback.trackDurationSeconds > 0 ? 16 : null,
              bit_perfect_eligible: state.playback.outputMode === "exclusive",
              reasons:
                state.playback.outputMode === "exclusive"
                  ? ["Exclusive output mock is active."]
                  : ["Shared output mock is active."]
            },
            active_queue_index: state.playback.activeQueueIndex,
            is_queue_ui_expanded: state.playback.isQueueVisible,
            queued_track_change_requests: state.playback.queuedTrackChangeRequests,
            is_playing: state.playback.isPlaying,
            position_seconds: state.playback.positionSeconds,
            track_duration_seconds: state.playback.trackDurationSeconds
          };
        }

        if (command === "get_playback_decode_error") {
          return state.playback.decodeError;
        }

        if (command === "publisher_create_draft_from_track") {
          const track = findTrackById(args?.trackId);
          if (!track) {
            throw {
              code: "TRACK_NOT_FOUND",
              message: "Track not found."
            } satisfies MockUiAppError;
          }
          return {
            draft_id: makeHexId("1", 1),
            source_track_id: track.track_id,
            media_path: track.file_path,
            spec_path: `${directoryFromPath(track.file_path)}/${baseNameFromPath(track.file_path)}.yaml`
          };
        }

        if (command === "runtime_get_error_log_path") {
          return "C:/logs/release-publisher/runtime-errors.log";
        }

        if (command === "runtime_log_error") {
          state.runtimeErrorEntries.push(args?.entry ?? null);
          return null;
        }

        if (command === "qc_get_feature_flags") {
          return {
            qc_codec_preview_v1: false,
            qc_realtime_meters_v1: false,
            qc_batch_export_v1: false
          };
        }

        if (command === "qc_list_codec_profiles") {
          return [];
        }

        if (
          command === "qc_get_active_preview_media" ||
          command === "qc_get_batch_export_job_status" ||
          command === "qc_get_preview_session"
        ) {
          return null;
        }

        if (
          command === "qc_prepare_preview_session" ||
          command === "qc_set_preview_variant" ||
          command === "qc_reveal_blind_x" ||
          command === "qc_start_batch_export"
        ) {
          throw {
            code: "FEATURE_DISABLED",
            message: "QC preview features are disabled in the mock runtime."
          } satisfies MockUiAppError;
        }

        if (command === "video_render_get_environment_diagnostics") {
          const directoryPath =
            typeof args?.outputDirectoryPath === "string" && args.outputDirectoryPath.trim().length > 0
              ? String(args.outputDirectoryPath)
              : "C:/Exports";
          const blocked = Boolean(scenario.renderDiagnosticsBlocked);
          return {
            ffmpeg: {
              available: !blocked,
              source: blocked ? "missing" : "bundled_resource",
              executablePath: blocked ? null : "C:/ffmpeg/ffmpeg.exe",
              version: blocked ? null : "6.1",
              message: blocked ? "FFmpeg is unavailable in the mock diagnostics state." : null
            },
            outputDirectory: {
              directoryPath,
              exists: !blocked,
              writable: !blocked,
              message: blocked ? "Output directory is not writable." : null
            },
            renderCapable: !blocked,
            blockingReasons: blocked
              ? ["Mock diagnostics blocked rendering."]
              : []
          };
        }

        if (command === "video_render_check_source_path") {
          const sourcePath = normalizePath(args?.sourcePath);
          const missing = sourcePath.toLowerCase().includes("/missing/");
          return {
            sourcePath,
            exists: !missing,
            isFile: !missing
          };
        }

        if (command === "video_render_start") {
          const request = (args?.request ?? {}) as {
            output?: { outputFilePath?: string };
          };
          const outputPath = String(request.output?.outputFilePath ?? "C:/Exports/mock-render.mp4");
          const renderJob: InternalRenderJob = {
            jobId: makeHexId("9", renderJobCounter),
            outputPath,
            polls: 0,
            canceled: false
          };
          renderJobCounter += 1;
          state.renderJobs.set(renderJob.jobId, renderJob);
          return {
            jobId: renderJob.jobId,
            state: "running"
          };
        }

        if (command === "video_render_status") {
          const job = state.renderJobs.get(String(args?.jobId ?? ""));
          if (!job) {
            throw {
              code: "RENDER_JOB_NOT_FOUND",
              message: "Render job not found."
            } satisfies MockUiAppError;
          }
          if (job.canceled) {
            return {
              jobId: job.jobId,
              state: "canceled",
              percent: 0,
              stage: "canceled",
              frameIndex: null,
              totalFrames: null,
              encodedSeconds: null,
              message: "Render canceled.",
              updatedAtUtc: FIXED_NOW
            };
          }
          job.polls += 1;
          if (job.polls === 1) {
            return {
              jobId: job.jobId,
              state: "running",
              percent: 55,
              stage: "encode",
              frameIndex: 120,
              totalFrames: 240,
              encodedSeconds: 60,
              message: "Encoding mock frames.",
              updatedAtUtc: FIXED_NOW
            };
          }
          if (job.polls === 2) {
            return {
              jobId: job.jobId,
              state: "finalizing",
              percent: 95,
              stage: "mux",
              frameIndex: 240,
              totalFrames: 240,
              encodedSeconds: 120,
              message: "Finalizing mock output.",
              updatedAtUtc: FIXED_NOW
            };
          }
          return {
            jobId: job.jobId,
            state: "succeeded",
            percent: 100,
            stage: "complete",
            frameIndex: 240,
            totalFrames: 240,
            encodedSeconds: 120,
            message: "Render complete.",
            updatedAtUtc: FIXED_NOW
          };
        }

        if (command === "video_render_result") {
          const job = state.renderJobs.get(String(args?.jobId ?? ""));
          if (!job) {
            throw {
              code: "RENDER_JOB_NOT_FOUND",
              message: "Render job not found."
            } satisfies MockUiAppError;
          }
          if (job.canceled) {
            return {
              jobId: job.jobId,
              state: "canceled",
              success: null,
              failure: {
                jobId: job.jobId,
                code: "canceled_by_user",
                message: "Render canceled by user.",
                retryable: true,
                details: null
              }
            };
          }
          return {
            jobId: job.jobId,
            state: "succeeded",
            success: {
              jobId: job.jobId,
              outputPath: job.outputPath,
              durationSeconds: 120,
              fileSizeBytes: 12_000_000,
              completedAtUtc: FIXED_NOW
            },
            failure: null
          };
        }

        if (command === "video_render_cancel") {
          const job = state.renderJobs.get(String(args?.jobId ?? ""));
          if (!job) {
            throw {
              code: "RENDER_JOB_NOT_FOUND",
              message: "Render job not found."
            } satisfies MockUiAppError;
          }
          job.canceled = true;
          return {
            jobId: job.jobId,
            state: "canceled",
            canceled: true
          };
        }

        if (command === "video_render_open_output_folder") {
          const outputFilePath = normalizePath(args?.outputFilePath);
          return {
            opened: true,
            directoryPath: directoryFromPath(outputFilePath)
          };
        }

        throw {
          code: "UNKNOWN_COMMAND",
          message: `Mock Tauri bridge does not implement ${command}.`
        } satisfies MockUiAppError;
      };

      (window as Window & {
        __TAURI__?: { core?: { invoke?: typeof invoke } };
        __TAURI_INTERNALS__?: { invoke?: typeof invoke };
        __RP_E2E__?: {
          getState: () => PublicMockState;
          deleteTracksByPath: (paths: string[]) => void;
          advanceNativePlaybackToTrackEnd: () => void;
          setCommandError: (command: string, error: { code: string; message: string } | null) => void;
          setDecodeError: (message: string | null) => void;
        };
      }).__TAURI__ = {
        core: {
          invoke
        }
      };

      (window as Window & {
        __TAURI__?: { core?: { invoke?: typeof invoke } };
        __TAURI_INTERNALS__?: { invoke?: typeof invoke };
      }).__TAURI_INTERNALS__ = {
        invoke
      };

      (window as Window & {
        __RP_E2E__?: {
          getState: () => PublicMockState;
          deleteTracksByPath: (paths: string[]) => void;
          advanceNativePlaybackToTrackEnd: () => void;
          setCommandError: (command: string, error: { code: string; message: string } | null) => void;
          setDecodeError: (message: string | null) => void;
        };
      }).__RP_E2E__ = {
        getState: publicState,
                deleteTracksByPath: (paths: string[]) => {
          const removedPaths = new Set(paths.map((path) => normalizePath(path)));
          state.tracks = state.tracks.filter(
            (track) => !removedPaths.has(normalizePath(track.file_path))
          );
          state.queuePaths = state.queuePaths.filter((path) => !removedPaths.has(normalizePath(path)));
          const persistedRemovedPaths = readRemovedTrackPaths();
          for (const path of removedPaths) {
            persistedRemovedPaths.add(path);
          }
          writeRemovedTrackPaths(persistedRemovedPaths);
          if (state.playback.activeQueueIndex >= state.queuePaths.length) {
            state.playback.activeQueueIndex = state.queuePaths.length - 1;
          }
          updatePlaybackDuration();
        },
        advanceNativePlaybackToTrackEnd: () => {
          updatePlaybackDuration();
          if (state.playback.trackDurationSeconds <= 0) return;
          state.playback.isPlaying = true;
          state.playback.positionSeconds = state.playback.trackDurationSeconds;
        },
        setCommandError: (command: string, error: { code: string; message: string } | null) => {
          if (!error) {
            commandErrors.delete(command);
            timeoutCommands.delete(command);
            return;
          }
          commandErrors.set(command, error);
          timeoutCommands.delete(command);
        },
        setDecodeError: (message: string | null) => {
          state.playback.decodeError = message;
        }
      };
    },
    { scenario }
  );
}

export async function readMockTauriState(page: Page): Promise<PublicMockState> {
  return page.evaluate(() => {
    const api = (window as Window & {
      __RP_E2E__?: {
        getState: () => PublicMockState;
      };
    }).__RP_E2E__;

    if (!api) {
      throw new Error("Mock Tauri bridge state is unavailable.");
    }

    return api.getState();
  });
}

export async function simulateNativeTrackEnd(page: Page): Promise<void> {
  await page.evaluate(() => {
    const api = (window as Window & {
      __RP_E2E__?: { advanceNativePlaybackToTrackEnd: () => void };
    }).__RP_E2E__;

    if (!api) {
      throw new Error("Mock Tauri bridge state is unavailable.");
    }

    api.advanceNativePlaybackToTrackEnd();
  });
}

export async function deleteMockTracksByPath(page: Page, paths: string[]): Promise<void> {
  await page.evaluate((nextPaths) => {
    const api = (window as Window & {
      __RP_E2E__?: { deleteTracksByPath: (paths: string[]) => void };
    }).__RP_E2E__;

    if (!api) {
      throw new Error("Mock Tauri bridge state is unavailable.");
    }

    api.deleteTracksByPath(nextPaths);
  }, paths);
}

export async function setMockCommandError(
  page: Page,
  command: string,
  error: { code: string; message: string } | null
): Promise<void> {
  await page.evaluate(
    ({ nextCommand, nextError }) => {
      const api = (window as Window & {
        __RP_E2E__?: {
          setCommandError: (
            commandName: string,
            commandError: { code: string; message: string } | null
          ) => void;
        };
      }).__RP_E2E__;

      if (!api) {
        throw new Error("Mock Tauri bridge state is unavailable.");
      }

      api.setCommandError(nextCommand, nextError);
    },
    { nextCommand: command, nextError: error }
  );
}


