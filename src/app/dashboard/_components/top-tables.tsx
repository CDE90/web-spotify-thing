import "server-only";

import { PercentageBadge } from "@/components/percentage-badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableHeadRow,
    TableRow,
} from "@/components/ui/table";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { ordinal } from "@/lib/utils";
import { db } from "@/server/db";
import {
    albums,
    artists,
    artistTracks,
    listeningHistory,
    tracks,
} from "@/server/db/schema";
import { type DateRange, getPrevDateRange, getTimeFilters } from "@/server/lib";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export function SkeletonTopTable({ limit }: Readonly<{ limit: number }>) {
    return (
        <Table>
            <TableHeader>
                <TableHeadRow>
                    <TableHead>
                        <Skeleton className="my-1 h-8 w-16 rounded-lg" />
                    </TableHead>
                    <TableHead>
                        <Skeleton className="my-1 h-8 w-52 rounded-lg" />
                    </TableHead>
                    <TableHead>
                        <Skeleton className="my-1 h-8 w-16 rounded-lg" />
                    </TableHead>
                </TableHeadRow>
            </TableHeader>
            <TableBody>
                {Array.from({ length: limit }, (_, index) => (
                    <TableRow key={index}>
                        <TableCell>
                            <Skeleton className="h-6 w-12 rounded-lg" />
                        </TableCell>
                        <TableCell>
                            <div className="flex items-center gap-4">
                                <Skeleton className="h-12 w-12 rounded-lg" />
                                <Skeleton className="h-6 w-32 rounded-lg" />
                            </div>
                        </TableCell>
                        <TableCell>
                            <Skeleton className="h-6 w-12 rounded-lg" />
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}

export async function TopArtists({
    userId,
    dateRange,
    limit,
}: Readonly<{
    userId: string;
    dateRange: DateRange;
    limit: number;
}>) {
    "use cache";

    const timeFilters = getTimeFilters(dateRange);
    const prevDateRange = getPrevDateRange(dateRange);
    const prevTimeFilters = getTimeFilters(prevDateRange);

    // Current period top artists
    const topArtists = await db
        .select({
            count: sql<number>`count(*)`,
            artist: artists.name,
            imageUrl: artists.imageUrl,
            artistId: artists.id,
        })
        .from(listeningHistory)
        .innerJoin(tracks, eq(listeningHistory.trackId, tracks.id))
        .innerJoin(artistTracks, eq(tracks.id, artistTracks.trackId))
        .innerJoin(artists, eq(artistTracks.artistId, artists.id))
        .where(
            and(
                timeFilters,
                eq(listeningHistory.userId, userId),
                gte(listeningHistory.progressMs, 30 * 1000),
                eq(artistTracks.isPrimaryArtist, true),
            ),
        )
        .groupBy(artists.id)
        .orderBy(
            desc(sql`count(*)`),
            desc(sql`sum(${listeningHistory.progressMs})`),
            asc(artists.name),
        )
        .limit(limit);

    // Previous period top artists
    const prevTopArtists = await db
        .select({
            count: sql<number>`count(*)`,
            artist: artists.name,
            artistId: artists.id,
        })
        .from(listeningHistory)
        .innerJoin(tracks, eq(listeningHistory.trackId, tracks.id))
        .innerJoin(artistTracks, eq(tracks.id, artistTracks.trackId))
        .innerJoin(artists, eq(artistTracks.artistId, artists.id))
        .where(
            and(
                prevTimeFilters,
                eq(listeningHistory.userId, userId),
                gte(listeningHistory.progressMs, 30 * 1000),
                eq(artistTracks.isPrimaryArtist, true),
            ),
        )
        .groupBy(artists.id)
        .orderBy(
            desc(sql`count(*)`),
            desc(sql`sum(${listeningHistory.progressMs})`),
            asc(artists.name),
        )
        .limit(limit);

    // Calculate rank and count changes
    const artistComparisons = topArtists.map((artist, currentIndex) => {
        // Find this artist in previous period
        const prevArtistIndex = prevTopArtists.findIndex(
            (prevArtist) => prevArtist.artistId === artist.artistId,
        );

        // Determine rank change
        const rankChange =
            prevArtistIndex !== -1 ? prevArtistIndex - currentIndex : null;

        // Determine count change
        const prevArtist =
            prevArtistIndex !== -1 ? prevTopArtists[prevArtistIndex] : null;
        const countChange = prevArtist
            ? ((artist.count - prevArtist.count) / prevArtist.count) * 100
            : null;

        return {
            ...artist,
            rankChange,
            countChange,
            previousRank: prevArtistIndex !== -1 ? prevArtistIndex + 1 : null,
        };
    });

    return (
        <Table>
            <TableHeader>
                <TableHeadRow>
                    <TableHead>Rank</TableHead>
                    <TableHead>Artist</TableHead>
                    <TableHead>Count</TableHead>
                </TableHeadRow>
            </TableHeader>
            <TableBody>
                {artistComparisons.map((artist, index) => (
                    <TableRow key={artist.artistId}>
                        <TableCell>
                            <div className="flex items-center gap-2">
                                {index + 1}
                                {artist.rankChange !== null && (
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger>
                                                {artist.rankChange > 0 ? (
                                                    <ArrowUp className="h-4 w-4 text-green-600" />
                                                ) : artist.rankChange < 0 ? (
                                                    <ArrowDown className="h-4 w-4 text-red-600" />
                                                ) : (
                                                    <Minus className="h-4 w-4 text-gray-500" />
                                                )}
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                {artist.rankChange > 0
                                                    ? `Moved up ${artist.rankChange} rank${artist.rankChange !== 1 ? "s" : ""} from ${ordinal(artist.previousRank!)}`
                                                    : artist.rankChange < 0
                                                      ? `Moved down ${Math.abs(artist.rankChange)} rank${Math.abs(artist.rankChange) !== 1 ? "s" : ""} from ${ordinal(artist.previousRank!)}`
                                                      : "Same rank as previous period"}
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                )}
                            </div>
                        </TableCell>
                        <TableCell>
                            <Link
                                className="flex h-12 items-center gap-4 text-wrap underline-offset-4 hover:underline"
                                href={`https://open.spotify.com/artist/${artist.artistId}`}
                                target="_blank"
                            >
                                {artist.imageUrl ? (
                                    <Image
                                        src={artist.imageUrl}
                                        alt={artist.artist}
                                        width={48}
                                        height={48}
                                        className="h-12 w-12"
                                    />
                                ) : null}
                                {artist.artist}
                            </Link>
                        </TableCell>
                        <TableCell>
                            <div className="flex items-center gap-2">
                                {artist.count}
                                <PercentageBadge
                                    percentChange={artist.countChange}
                                />
                            </div>
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}

export async function TopTracks({
    userId,
    dateRange,
    limit,
}: Readonly<{
    userId: string;
    dateRange: DateRange;
    limit: number;
}>) {
    "use cache";

    const timeFilters = getTimeFilters(dateRange);
    const prevDateRange = getPrevDateRange(dateRange);
    const prevTimeFilters = getTimeFilters(prevDateRange);

    // Current period top tracks
    const topTracks = await db
        .select({
            count: sql<number>`count(*)`,
            track: tracks.name,
            imageUrl: albums.imageUrl,
            trackId: tracks.id,
        })
        .from(listeningHistory)
        .innerJoin(tracks, eq(listeningHistory.trackId, tracks.id))
        .innerJoin(albums, eq(tracks.albumId, albums.id))
        .where(
            and(
                timeFilters,
                eq(listeningHistory.userId, userId),
                gte(listeningHistory.progressMs, 30 * 1000),
            ),
        )
        .groupBy(tracks.id, albums.imageUrl)
        .orderBy(
            desc(sql`count(*)`),
            desc(sql`sum(${listeningHistory.progressMs})`),
            asc(tracks.name),
        )
        .limit(limit);

    // Previous period top tracks
    const prevTopTracks = await db
        .select({
            count: sql<number>`count(*)`,
            track: tracks.name,
            trackId: tracks.id,
        })
        .from(listeningHistory)
        .innerJoin(tracks, eq(listeningHistory.trackId, tracks.id))
        .where(
            and(
                prevTimeFilters,
                eq(listeningHistory.userId, userId),
                gte(listeningHistory.progressMs, 30 * 1000),
            ),
        )
        .groupBy(tracks.id)
        .orderBy(
            desc(sql`count(*)`),
            desc(sql`sum(${listeningHistory.progressMs})`),
            asc(tracks.name),
        )
        .limit(limit);

    // Calculate rank and count changes
    const trackComparisons = topTracks.map((track, currentIndex) => {
        // Find this track in previous period
        const prevTrackIndex = prevTopTracks.findIndex(
            (prevTrack) => prevTrack.trackId === track.trackId,
        );

        // Determine rank change
        const rankChange =
            prevTrackIndex !== -1 ? prevTrackIndex - currentIndex : null;

        // Determine count change
        const prevTrack =
            prevTrackIndex !== -1 ? prevTopTracks[prevTrackIndex] : null;
        const countChange = prevTrack
            ? ((track.count - prevTrack.count) / prevTrack.count) * 100
            : null;

        return {
            ...track,
            rankChange,
            countChange,
            previousRank: prevTrackIndex !== -1 ? prevTrackIndex + 1 : null,
        };
    });

    return (
        <Table>
            <TableHeader>
                <TableHeadRow>
                    <TableHead>Rank</TableHead>
                    <TableHead>Track</TableHead>
                    <TableHead>Count</TableHead>
                </TableHeadRow>
            </TableHeader>
            <TableBody>
                {trackComparisons.map((track, index) => (
                    <TableRow key={track.trackId}>
                        <TableCell>
                            <div className="flex items-center gap-2">
                                {index + 1}
                                {track.rankChange !== null && (
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger>
                                                {track.rankChange > 0 ? (
                                                    <ArrowUp className="h-4 w-4 text-green-600" />
                                                ) : track.rankChange < 0 ? (
                                                    <ArrowDown className="h-4 w-4 text-red-600" />
                                                ) : (
                                                    <Minus className="h-4 w-4 text-gray-500" />
                                                )}
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                {track.rankChange > 0
                                                    ? `Moved up ${track.rankChange} rank${track.rankChange !== 1 ? "s" : ""} from ${ordinal(track.previousRank!)}`
                                                    : track.rankChange < 0
                                                      ? `Moved down ${Math.abs(track.rankChange)} rank${Math.abs(track.rankChange) !== 1 ? "s" : ""} from ${ordinal(track.previousRank!)}`
                                                      : "Same rank as previous period"}
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                )}
                            </div>
                        </TableCell>
                        <TableCell>
                            <Link
                                className="flex h-12 items-center gap-4 text-wrap underline-offset-4 hover:underline"
                                href={`https://open.spotify.com/track/${track.trackId}`}
                                target="_blank"
                            >
                                {track.imageUrl ? (
                                    <Image
                                        src={track.imageUrl}
                                        alt={track.track}
                                        width={48}
                                        height={48}
                                        className="h-12 w-12"
                                    />
                                ) : null}
                                {track.track}
                            </Link>
                        </TableCell>
                        <TableCell>
                            <div className="flex items-center gap-2">
                                {track.count}
                                <PercentageBadge
                                    percentChange={track.countChange}
                                />
                            </div>
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}

export async function TopAlbums({
    userId,
    dateRange,
    limit,
}: Readonly<{
    userId: string;
    dateRange: DateRange;
    limit: number;
}>) {
    "use cache";

    const timeFilters = getTimeFilters(dateRange);
    const prevDateRange = getPrevDateRange(dateRange);
    const prevTimeFilters = getTimeFilters(prevDateRange);

    // Current period top albums
    const topAlbums = await db
        .select({
            count: sql<number>`count(*)`,
            album: albums.name,
            imageUrl: albums.imageUrl,
            albumId: albums.id,
        })
        .from(listeningHistory)
        .innerJoin(tracks, eq(listeningHistory.trackId, tracks.id))
        .innerJoin(albums, eq(tracks.albumId, albums.id))
        .where(
            and(
                timeFilters,
                eq(listeningHistory.userId, userId),
                gte(listeningHistory.progressMs, 30 * 1000),
            ),
        )
        .groupBy(albums.id, albums.imageUrl)
        .orderBy(
            desc(sql`count(*)`),
            desc(sql`sum(${listeningHistory.progressMs})`),
            asc(albums.name),
        )
        .limit(limit);

    // Previous period top albums
    const prevTopAlbums = await db
        .select({
            count: sql<number>`count(*)`,
            album: albums.name,
            albumId: albums.id,
        })
        .from(listeningHistory)
        .innerJoin(tracks, eq(listeningHistory.trackId, tracks.id))
        .innerJoin(albums, eq(tracks.albumId, albums.id))
        .where(
            and(
                prevTimeFilters,
                eq(listeningHistory.userId, userId),
                gte(listeningHistory.progressMs, 30 * 1000),
            ),
        )
        .groupBy(albums.id)
        .orderBy(
            desc(sql`count(*)`),
            desc(sql`sum(${listeningHistory.progressMs})`),
            asc(albums.name),
        )
        .limit(limit);

    // Calculate rank and count changes
    const albumComparisons = topAlbums.map((album, currentIndex) => {
        // Find this album in previous period
        const prevAlbumIndex = prevTopAlbums.findIndex(
            (prevAlbum) => prevAlbum.albumId === album.albumId,
        );

        // Determine rank change
        const rankChange =
            prevAlbumIndex !== -1 ? prevAlbumIndex - currentIndex : null;

        // Determine count change
        const prevAlbum =
            prevAlbumIndex !== -1 ? prevTopAlbums[prevAlbumIndex] : null;
        const countChange = prevAlbum
            ? ((album.count - prevAlbum.count) / prevAlbum.count) * 100
            : null;

        return {
            ...album,
            rankChange,
            countChange,
            previousRank: prevAlbumIndex !== -1 ? prevAlbumIndex + 1 : null,
        };
    });

    return (
        <Table>
            <TableHeader>
                <TableHeadRow>
                    <TableHead>Rank</TableHead>
                    <TableHead>Album</TableHead>
                    <TableHead>Count</TableHead>
                </TableHeadRow>
            </TableHeader>
            <TableBody>
                {albumComparisons.map((album, index) => (
                    <TableRow key={album.albumId}>
                        <TableCell>
                            <div className="flex items-center gap-2">
                                {index + 1}
                                {album.rankChange !== null && (
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger>
                                                {album.rankChange > 0 ? (
                                                    <ArrowUp className="h-4 w-4 text-green-600" />
                                                ) : album.rankChange < 0 ? (
                                                    <ArrowDown className="h-4 w-4 text-red-600" />
                                                ) : (
                                                    <Minus className="h-4 w-4 text-gray-500" />
                                                )}
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                {album.rankChange > 0
                                                    ? `Moved up ${album.rankChange} rank${album.rankChange !== 1 ? "s" : ""} from ${ordinal(album.previousRank!)}`
                                                    : album.rankChange < 0
                                                      ? `Moved down ${Math.abs(album.rankChange)} rank${Math.abs(album.rankChange) !== 1 ? "s" : ""} from ${ordinal(album.previousRank!)}`
                                                      : "Same rank as previous period"}
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                )}
                            </div>
                        </TableCell>
                        <TableCell>
                            <Link
                                className="flex h-12 items-center gap-4 text-wrap underline-offset-4 hover:underline"
                                href={`https://open.spotify.com/album/${album.albumId}`}
                                target="_blank"
                            >
                                {album.imageUrl ? (
                                    <Image
                                        src={album.imageUrl}
                                        alt={album.album}
                                        width={48}
                                        height={48}
                                        className="h-12 w-12"
                                    />
                                ) : null}
                                {album.album}
                            </Link>
                        </TableCell>
                        <TableCell>
                            <div className="flex items-center gap-2">
                                {album.count}
                                <PercentageBadge
                                    percentChange={album.countChange}
                                />
                            </div>
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}
