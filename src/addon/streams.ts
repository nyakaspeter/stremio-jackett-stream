import { Request } from "express";
import Stremio from "stremio-addon-sdk";
import {
  TorrentCategory,
  TorrentSearchResult,
  TorrentSource,
  searchTorrents,
} from "../torrent/search.js";
import { getTorrentInfoFromWebtorrent } from "../torrent/webtorrent.js";
import { getReadableSize, isSubtitleFile, isVideoFile } from "../utils/file.js";
import { getTitles } from "../utils/imdb.js";
import { guessLanguage } from "../utils/language.js";
import { guessQuality } from "../utils/quality.js";
import { isFileNameMatch, isTorrentNameMatch } from "../utils/shows.js";
import { getTorrentInfoFromTorrentFile } from "../utils/torrent.js";

interface HandlerArgs {
  type: string;
  id: string;
  config?: {
    enableJackett: string;
    jackettUrl: string;
    jackettKey: string;
    enableNcore: string;
    nCoreUser: string;
    nCorePassword: string;
    enableInsane: string;
    insaneUser: string;
    insanePassword: string;
    enableItorrent: string;
    enableYts: string;
    enableEztv: string;
    searchByTitle: string;
    disableHdr: string;
    disableHevc: string;
    disable4k: string;
    disableCam: string;
    disable3d: string;
  };
  req: Request;
}

export const streamHandler = async ({ type, id, config, req }: HandlerArgs) => {
  let torrents: TorrentSearchResult[] = [];

  const categories: TorrentCategory[] = [];
  if (type === "movie") categories.push("movie");
  if (type === "series") categories.push("show");

  const sources: TorrentSource[] = [];
  if (config.enableJackett === "on") sources.push("jackett");
  if (config.enableNcore === "on") sources.push("ncore");
  if (config.enableInsane === "on") sources.push("insane");
  if (config.enableItorrent === "on") sources.push("itorrent");
  if (config.enableYts === "on") sources.push("yts");
  if (config.enableEztv === "on") sources.push("eztv");

  const [imdbId, season, episode] = id.split(":");

  const queries = [imdbId];
  if (config.searchByTitle === "on") queries.push(...(await getTitles(imdbId)));

  torrents = (
    await Promise.all(
      queries.map((query) =>
        searchTorrents(query, {
          categories,
          sources,
          jackett: {
            url: config.jackettUrl,
            apiKey: config.jackettKey,
          },
          ncore: {
            user: config.nCoreUser,
            password: config.nCorePassword,
          },
          insane: {
            user: config.insaneUser,
            password: config.insanePassword,
          },
        })
      )
    )
  ).flat();

  torrents = dedupeTorrents(torrents);

  torrents = torrents.filter((torrent) => {
    if (!torrent.seeds) return false;
    if (torrent.category?.includes("DVD")) return false;
    if (!isAllowedFormat(config, torrent.name)) return false;
    if (!isAllowedQuality(config, guessQuality(torrent.name).quality))
      return false;

    if (
      season &&
      episode &&
      !isTorrentNameMatch(torrent.name, Number(season), Number(episode))
    )
      return false;

    return true;
  });

  let streams = (
    await Promise.all(
      torrents.map((torrent) =>
        getStreamsFromTorrent(req, torrent, season, episode)
      )
    )
  ).flat();

  streams = streams.filter((stream) => {
    if (!isAllowedFormat(config, stream.fileName)) return false;
    if (!isAllowedQuality(config, stream.quality)) return false;
    return true;
  });

  streams.sort((a, b) => b.score - a.score);

  return { streams: streams.map((stream) => stream.stream) };
};

const dedupeTorrents = (torrents: TorrentSearchResult[]) => {
  const map = new Map(
    torrents.map((torrent) => [`${torrent.tracker}:${torrent.name}`, torrent])
  );

  return [...map.values()];
};

export const getStreamsFromTorrent = async (
  req: Request,
  torrent: TorrentSearchResult,
  season?: string,
  episode?: string
): Promise<
  {
    stream: Stremio.Stream;
    torrentName: string;
    fileName: string;
    quality: string;
    score: number;
  }[]
> => {
  const uri = torrent.torrent || torrent.magnet;
  if (!uri) return [];

  let torrentInfo;
  if (uri == torrent.torrent) {
    torrentInfo = await getTorrentInfoFromTorrentFile(uri);
  } else {
    torrentInfo = await getTorrentInfoFromWebtorrent(uri);
  }

  if (!torrentInfo) return [];

  let videos = torrentInfo.files.filter((file) => isVideoFile(file.name));

  if (season && episode) {
    videos = videos.filter((file) =>
      isFileNameMatch(file.name, Number(season), Number(episode))
    );
  }

  const videosSize = videos.reduce((acc, file) => acc + file.size, 0);

  videos = videos.filter(
    (file) => file.size > videosSize / (videos.length + 1)
  );

  const subs = torrentInfo.files.filter((file) => isSubtitleFile(file.name));

  const torrentQuality = guessQuality(torrent.name);
  const language = guessLanguage(torrent.name, torrent.category);

  // @ts-ignore
  return videos.map((file) => {
    const fileQuality = guessQuality(file.name);

    const { quality, score } =
      fileQuality.score > torrentQuality.score ? fileQuality : torrentQuality;

    const description = [
      ...(season && episode ? [torrent.name, file.name] : [torrent.name]),
      [
        `💾 ${getReadableSize(file.size)}`,
        `⬆️ ${torrent.seeds}`,
        `⬇️ ${torrent.peers}`,
      ].join(" "),
      [`🔊 ${language}`, `⚙️ ${torrent.tracker}`].join(" "),
    ].join("\n");

    const streamEndpoint = `${req.protocol}://${req.get("host")}/stream`;

    const url = [
      streamEndpoint,
      encodeURIComponent(uri),
      encodeURIComponent(file.path),
    ].join("/");

    const subtitles = subs.map((sub, index) => ({
      id: index.toString(),
      url: [
        streamEndpoint,
        encodeURIComponent(uri),
        encodeURIComponent(sub.path),
      ].join("/"),
      lang: sub.name,
    }));

    return {
      stream: {
        name: quality,
        description,
        url,
        subtitles,
        behaviorHints: {
          bingeGroup: torrent.name,
        },
      },
      torrentName: torrent.name,
      fileName: file.name,
      quality,
      score,
    };
  });
};

const isAllowedQuality = (config: HandlerArgs["config"], quality: string) => {
  if (config?.disable4k === "on" && quality.includes("4K")) return false;

  if (config?.disableCam === "on" && quality.includes("CAM")) return false;

  if (
    config?.disableHdr === "on" &&
    (quality.includes("HDR") || quality.includes("Dolby Vision"))
  )
    return false;

  if (config?.disable3d === "on" && quality.includes("3D")) return false;

  return true;
};

const isAllowedFormat = (config: HandlerArgs["config"], name: string) => {
  if (config?.disableHevc === "on") {
    const str = name.replace(/\W/g, "").toLowerCase();
    if (str.includes("x265") || str.includes("h265") || str.includes("hevc"))
      return false;
  }

  return true;
};
