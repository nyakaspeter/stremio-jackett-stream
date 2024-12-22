export const guessSeasonEpisode = (name: string) => {
  const str = name.replace(/\W/g, " ").toLowerCase();

  const seasonMatch = [...str.matchAll(/[s](?<season>\d+)/g)];
  const episodeMatch = str.match(/[e](?<episode>\d+)/);

  if (seasonMatch.length === 0 && str.includes("complete")) {
    return { completeSeries: true };
  } else if (seasonMatch.length === 1 && !episodeMatch) {
    const season = Number(seasonMatch[0].groups?.season) || 0;
    return { seasons: [season] };
  } else if (seasonMatch.length > 1) {
    const firstSeason = Number(seasonMatch[0].groups?.season) || 0;
    const lastSeason =
      Number(seasonMatch[seasonMatch.length - 1].groups?.season) || 0;
    const episode = Number(episodeMatch?.groups?.episode) || undefined;
    const seasons = [];
    for (let i = firstSeason; i <= lastSeason; i++) seasons.push(i);

    return { seasons, episode };
  } else if (seasonMatch[0] || episodeMatch) {
    const season = Number(seasonMatch[0]?.groups?.season) || undefined;
    const episode = Number(episodeMatch?.groups?.episode) || undefined;
    return { season, episode };
  } else {
    const seasonEpisodeMatch = str.match(/(?<season>\d+)x(?<episode>\d+)/);
    const season = Number(seasonEpisodeMatch?.groups?.season) || undefined;
    const episode = Number(seasonEpisodeMatch?.groups?.episode) || undefined;
    return { season, episode };
  }
};

export const isTorrentNameMatch = (
  name: string,
  season: number,
  episode: number
) => {
  const guess = guessSeasonEpisode(name);
  if (guess.completeSeries) return true;
  if (guess.seasons?.includes(season)) return true;
  if (guess.season === season && guess.episode === episode) return true;
  if (season === 0) {
    if (name.toLowerCase().includes("special")) return true;
    if (guess.season === undefined && guess.seasons === undefined) return true;
  }
  return false;
};

export const isFileNameMatch = (
  name: string,
  season: number,
  episode: number
) => {
  const guess = guessSeasonEpisode(name);
  if ((guess.season === season || guess.seasons?.includes(season)) && guess.episode === episode) return true;
  if (season === 0) return true;
  return false;
};
