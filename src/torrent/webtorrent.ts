import fs from "fs-extra";
import MemoryStore from "memory-chunk-store";
import os from "os";
import path from "path";
import WebTorrent, { Torrent } from "webtorrent";
import { getReadableDuration } from "../utils/file.js";
import { getTorrentHash } from "../utils/torrent.js";

interface FileInfo {
  name: string;
  path: string;
  size: number;
  url?: string;
}

interface ActiveFileInfo extends FileInfo {
  progress: number;
  downloaded: number;
}

export interface TorrentInfo {
  name: string;
  infoHash: string;
  size: number;
  files: FileInfo[];
}

interface ActiveTorrentInfo extends TorrentInfo {
  progress: number;
  downloaded: number;
  uploaded: number;
  downloadSpeed: number;
  uploadSpeed: number;
  peers: number;
  openStreams: number;
  files: ActiveFileInfo[];
}

// Directory to store downloaded files (default OS temp directory)
const DOWNLOAD_DIR =
  process.env.DOWNLOAD_DIR || path.join(os.tmpdir(), "torrent-stream-server");

// Directory to store torrent files (default DOWNLOAD_DIR/torrents)
const TORRENT_FILE_DIR =
  process.env.TORRENT_FILE_DIR || path.join(DOWNLOAD_DIR, "torrents");

// Directory to store torrent files that didn't complete their seed period (default DOWNLOAD_DIR/seed)
const SEED_DIR = process.env.SEED_DIR || path.join(DOWNLOAD_DIR, "seed");

// Enables automatic seeding of torrents that were left in the SEED_DIR (default false)
// A torrent file stay in the SEED_DIR if the SEED_TIME has not passed, I recommend keeping this enabled
const AUTO_SEED = process.env.AUTO_SEED
  ? process.env.AUTO_SEED === "true"
  : false;

// Keep downloaded files after all streams are closed (default false)
const KEEP_DOWNLOADED_FILES = process.env.KEEP_DOWNLOADED_FILES
  ? process.env.KEEP_DOWNLOADED_FILES === "true"
  : false;

// Keep torrent files (default false)
const KEEP_TORRENT_FILES = process.env.KEEP_TORRENT_FILES
  ? process.env.KEEP_TORRENT_FILES === "true"
  : false;

if (!KEEP_DOWNLOADED_FILES) fs.emptyDirSync(DOWNLOAD_DIR);

// Maximum number of connections per torrent (default 50)
const MAX_CONNS_PER_TORRENT = Number(process.env.MAX_CONNS_PER_TORRENT) || 50;

// Max download speed (bytes/s) over all torrents (default 20MB/s)
const DOWNLOAD_SPEED_LIMIT =
  Number(process.env.DOWNLOAD_SPEED_LIMIT) || 20 * 1024 * 1024;

// Max upload speed (bytes/s) over all torrents (default 1MB/s)
const UPLOAD_SPEED_LIMIT =
  Number(process.env.UPLOAD_SPEED_LIMIT) || 1 * 1024 * 1024;

// Time (ms) to seed torrents after all streams are closed (default 1 minute)
const SEED_TIME = Number(process.env.SEED_TIME) || 60 * 1000;

// Timeout (ms) when adding torrents if no metadata is received (default 5 seconds)
const TORRENT_TIMEOUT = Number(process.env.TORRENT_TIMEOUT) || 5 * 1000;

const infoClient = new WebTorrent();
const streamClient = new WebTorrent({
  // @ts-ignore
  downloadLimit: DOWNLOAD_SPEED_LIMIT,
  uploadLimit: UPLOAD_SPEED_LIMIT,
  maxConns: MAX_CONNS_PER_TORRENT,
});

streamClient.on("torrent", (torrent) => {
  console.log(`Added torrent: ${torrent.name}`);
});

streamClient.on("error", (error) => {
  if (typeof error === "string") {
    console.error(`Error: ${error}`);
  } else {
    if (error.message.startsWith("Cannot add duplicate torrent")) return;
    console.error(`Error: ${error.message}`);
  }
});

infoClient.on("error", () => {});

const launchTime = Date.now();

export const getStats = () => ({
  uptime: getReadableDuration(Date.now() - launchTime),
  openStreams: [...openStreams.values()].reduce((a, b) => a + b, 0),
  downloadSpeed: streamClient.downloadSpeed,
  uploadSpeed: streamClient.uploadSpeed,
  activeTorrents: streamClient.torrents.map<ActiveTorrentInfo>((torrent) => ({
    name: torrent.name,
    infoHash: torrent.infoHash,
    size: torrent.length,
    progress: torrent.progress,
    downloaded: torrent.downloaded,
    uploaded: torrent.uploaded,
    downloadSpeed: torrent.downloadSpeed,
    uploadSpeed: torrent.uploadSpeed,
    peers: torrent.numPeers,
    openStreams: openStreams.get(torrent.infoHash) || 0,
    files: torrent.files.map((file) => ({
      name: file.name,
      path: file.path,
      size: file.length,
      progress: file.progress,
      downloaded: file.downloaded,
    })),
  })),
});

export const getOrAddTorrent = (uri: string) =>
  new Promise<Torrent | undefined>((resolve) => {
    const torrent = streamClient.add(
      uri,
      {
        path: DOWNLOAD_DIR,
        destroyStoreOnDestroy: !KEEP_DOWNLOADED_FILES,
        // @ts-ignore
        deselect: true,
      },
      (torrent) => {
        clearTimeout(timeout);
        resolve(torrent);
      }
    );

    const timeout = setTimeout(() => {
      torrent.destroy();
      resolve(undefined);
    }, TORRENT_TIMEOUT);
  });

export const getFile = (torrent: Torrent, path: string) =>
  torrent.files.find((file) => file.path === path);

export const getTorrentInfoFromWebtorrent = async (uri: string) => {
  const getInfo = (torrent: Torrent): TorrentInfo => ({
    name: torrent.name,
    infoHash: torrent.infoHash,
    size: torrent.length,
    files: torrent.files.map((file) => ({
      name: file.name,
      path: file.path,
      size: file.length,
    })),
  });

  return await new Promise<TorrentInfo | undefined>((resolve) => {
    const torrent = infoClient.add(
      uri,
      { store: MemoryStore, destroyStoreOnDestroy: true },
      (torrent) => {
        clearTimeout(timeout);
        const info = getInfo(torrent);
        console.log(`Fetched info: ${info.name}`);
        torrent.destroy();
        resolve(info);
      }
    );

    const timeout = setTimeout(() => {
      torrent.destroy();
      resolve(undefined);
    }, TORRENT_TIMEOUT);
  });
};

const timeouts = new Map<string, NodeJS.Timeout>();
const openStreams = new Map<string, number>();

export const streamOpened = (hash: string, fileName: string) => {
  console.log(`Stream opened: ${fileName}`);

  const count = openStreams.get(hash) || 0;
  openStreams.set(hash, count + 1);

  const timeout = timeouts.get(hash);

  if (timeout) {
    clearTimeout(timeout);
    timeouts.delete(hash);
  }
};

export const streamClosed = (hash: string, fileName: string) => {
  console.log(`Stream closed: ${fileName}`);

  const count = openStreams.get(hash) || 1;
  openStreams.set(hash, count - 1);

  if (count > 1) return;

  openStreams.delete(hash);

  let timeout = timeouts.get(hash);
  if (timeout) return;

  timeout = setTimeout(() => handleTorrentTimeout(hash), SEED_TIME);

  timeouts.set(hash, timeout);
};

const handleTorrentTimeout = async (hash: string) => {
  const torrent = await streamClient.get(hash);

  // @ts-ignore
  torrent?.destroy(undefined, async () => {
    console.log(`Removed torrent: ${torrent.name}`);

    timeouts.delete(torrent.infoHash);
    const seedPath = path.join(SEED_DIR, `${torrent.name}.torrent`);

    try {
      await fs.remove(seedPath);
      console.log(`Deleted seed file: ${torrent.name}.torrent`);
    } catch (error) {
      console.error(
        `Failed to delete seed file: ${torrent.name}, error: ${error.message}`
      );
    }
  });
};

export const saveOrGetTorrentFile = async (uri: string, filePath: string) => {
  const rootFolder = path.normalize(filePath).split(path.sep)[0];
  const torrentFilename = `${rootFolder}.torrent`;
  const seedPath = path.join(SEED_DIR, torrentFilename);

  if (fs.existsSync(seedPath)) {
    return seedPath;
  }

  const torrentBuffer = await fetch(uri).then((res) => res.arrayBuffer());

  if (!fs.existsSync(seedPath)) {
    await fs.outputFile(seedPath, Buffer.from(torrentBuffer));
  }

  if (KEEP_TORRENT_FILES) {
    const torrentPath = path.join(TORRENT_FILE_DIR, torrentFilename);
    if(fs.existsSync(torrentPath)) await fs.copy(seedPath, torrentPath);
  }

  return seedPath;
};

export const seedDirectory = async () => {
  if (!fs.existsSync(SEED_DIR)) {
    console.log(
      "No files too auto seed, or seed directory does not exist at path:",
      SEED_DIR
    );
    return;
  }

  const files = await fs.readdir(SEED_DIR);

  for (const file of files) {
    const filePath = path.join(SEED_DIR, file);
    const fileBuffer = await fs.readFile(filePath);
    const hash = await getTorrentHash(fileBuffer.buffer);

    let timeout = timeouts.get(hash);
    if (timeout) return;

    if (path.extname(filePath) === ".torrent") {
      streamClient.add(filePath, { path: DOWNLOAD_DIR }, (_) => {
        console.log(`Seeding torrent: ${file}`);
        timeout = setTimeout(() => handleTorrentTimeout(hash), SEED_TIME);
      });
    }

    timeouts.set(hash, timeout);
  }
};

//Starts the seeding process if AUTO_SEED is true
if (AUTO_SEED) {
  seedDirectory().catch((error) => {
    console.error(`Failed to auto seed torrents: ${error.message}`);
  });
}
