import { Router } from "express";
import { searchTorrents } from "./torrent/search.js";
import {
  getFile,
  getOrAddTorrent,
  getStats,
  getTorrentInfoFromWebtorrent,
  streamClosed,
  streamOpened,
} from "./torrent/webtorrent.js";
import { getStreamingMimeType } from "./utils/file.js";

export const router = Router();

router.get("/stats", (req, res) => {
  const stats = getStats();
  res.json(stats);
});

router.get("/torrents/:query", async (req, res) => {
  const { query } = req.params;
  const torrents = await searchTorrents(query);
  res.json(torrents);
});

router.post("/torrents/:query", async (req, res) => {
  const { query } = req.params;
  const options = req.body;
  const torrents = await searchTorrents(query, options);
  res.json(torrents);
});

router.get("/torrent/:torrentUri", async (req, res) => {
  const { torrentUri } = req.params;

  const torrent = await getTorrentInfoFromWebtorrent(torrentUri);
  if (!torrent) return res.status(500).send("Failed to get torrent");

  torrent.files.forEach((file) => {
    file.url = [
      `${req.protocol}://${req.get("host")}`,
      "stream",
      encodeURIComponent(torrentUri),
      encodeURIComponent(file.path),
    ].join("/");
  });

  res.json(torrent);
});

router.get("/stream/:torrentUri/:filePath", async (req, res) => {
  const { torrentUri, filePath } = req.params;

  const torrent = await getOrAddTorrent(torrentUri);
  if (!torrent) return res.status(500).send("Failed to add torrent");

  const file = getFile(torrent, filePath);
  if (!file) return res.status(404).send("File not found");

  const { range } = req.headers;
  const positions = (range || "").replace(/bytes=/, "").split("-");
  const start = Number(positions[0]);
  const end = Number(positions[1]) || file.length - 1;

  if (start >= file.length || end >= file.length) {
    res.writeHead(416, {
      "Content-Range": `bytes */${file.length}`,
    });
    return res.end();
  }

  const headers = {
    "Content-Range": `bytes ${start}-${end}/${file.length}`,
    "Accept-Ranges": "bytes",
    "Content-Length": end - start + 1,
    "Content-Type": getStreamingMimeType(file.name),
  };

  res.writeHead(206, headers);

  try {
    const noDataTimeout = setTimeout(() => {
      res.status(500).end();
    }, 10000);

    const noReadTimeout = setTimeout(() => {
      res.status(200).end();
    }, 60000);

    const videoStream = file.createReadStream({ start, end });

    videoStream.on("data", () => {
      clearTimeout(noDataTimeout);
    });

    videoStream.on("readable", () => {
      noReadTimeout.refresh();
    });

    videoStream.on("error", (error) => {});

    videoStream.pipe(res);

    streamOpened(torrent.infoHash, file.name);

    res.on("close", () => {
      streamClosed(torrent.infoHash, file.name);
    });
  } catch (error) {
    res.status(500).end();
  }
});
