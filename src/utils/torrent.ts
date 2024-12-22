import { TorrentInfo } from "../torrent/webtorrent.js";
import { createHash } from "crypto";
import bencode from "bencode";
import path from "path";

export const getTorrentInfoFromTorrentFile = async (
  uri: string
): Promise<TorrentInfo | undefined> => {
  const torrentBuffer = await fetch(uri).then((res) => res.arrayBuffer());

  const metadata = bencode.decode(Buffer.from(torrentBuffer));
  const textDecoder = new TextDecoder("utf-8");

  let totalSize = 0;
  const files = metadata.info.files.map(
    (file: { path: Uint8Array[]; length: number }) => {
      totalSize += file.length;
      return {
        path: file.path.map((segment) => textDecoder.decode(segment)),
        length: file.length,
      };
    }
  );
  const torrentName = textDecoder.decode(metadata.info.name);
  const infoHash = createHash("sha1")
    .update(bencode.encode(metadata.info))
    .digest("hex");

  console.log(`Got info from torrent file: ${torrentName}`);
  return {
    name: torrentName,
    infoHash: infoHash,
    size: totalSize,
    files: files.map((file) => ({
      name: file.path.at(-1),
      path: path.join(torrentName, file.path.join(path.sep)),
      size: file.length,
    })),
  };
};

export const getTorrentHash = async (
  torrentBuffer: ArrayBufferLike
): Promise<string | undefined> => {
  const metadata = bencode.decode(torrentBuffer);
  const infoHash = createHash("sha1")
    .update(bencode.encode(metadata.info))
    .digest("hex");
  return infoHash;
};
