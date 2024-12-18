import { Card } from "@/components/Card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeaderCell,
    TableRoot,
    TableRow,
} from "@/components/Table";
import { DateSelector } from "@/components/ui/DateSelector";
import { db } from "@/server/db";
import {
    albums,
    artists,
    artistTracks,
    listeningHistory,
    tracks,
} from "@/server/db/schema";
import { auth } from "@clerk/nextjs/server";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function DashboardPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[]>>;
}) {
    const { userId } = await auth();

    if (!userId) {
        redirect("/login");
    }

    const actualParams = await searchParams;

    // @ts-expect-error this is fine
    const searchParamsCopy = new URLSearchParams(actualParams);

    // Get the start date and end date from the search params
    const startDate = searchParamsCopy.get("from")
        ? new Date(searchParamsCopy.get("from")!)
        : new Date(new Date().getTime() - 365 * 24 * 60 * 60 * 1000);
    startDate.setHours(0, 0, 0, 0);
    const endDate = searchParamsCopy.get("to")
        ? new Date(searchParamsCopy.get("to")!)
        : new Date();
    endDate.setHours(23, 59, 59, 999);

    const timeFilters = and(
        gte(listeningHistory.playedAt, startDate),
        lte(listeningHistory.playedAt, endDate),
    );

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
        .orderBy(desc(sql`count(*)`), asc(artists.name))
        .limit(10);

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
        .orderBy(desc(sql`count(*)`), asc(tracks.name))
        .limit(10);

    const totalProgressMs = await db
        .select({
            duration: sql<number>`sum(${listeningHistory.progressMs})`,
        })
        .from(listeningHistory)
        .where(and(eq(listeningHistory.userId, userId), timeFilters));

    let totalMinutes = 0;
    if (totalProgressMs) {
        totalMinutes = totalProgressMs[0]!.duration / 60000;
    }

    const totalArtistsCount = await db
        .select({
            countArtists: sql<number>`count(distinct ${artistTracks.artistId})`,
        })
        .from(listeningHistory)
        .innerJoin(
            artistTracks,
            eq(listeningHistory.trackId, artistTracks.trackId),
        )
        .where(
            and(
                eq(listeningHistory.userId, userId),
                timeFilters,
                gte(listeningHistory.progressMs, 30 * 1000),
            ),
        );

    let totalArtists = 0;
    if (totalArtistsCount) {
        totalArtists = totalArtistsCount[0]!.countArtists;
    }

    const totalTracksCount = await db
        .select({
            countTracks: sql<number>`count(distinct ${listeningHistory.trackId})`,
        })
        .from(listeningHistory)
        .where(
            and(
                eq(listeningHistory.userId, userId),
                timeFilters,
                gte(listeningHistory.progressMs, 30 * 1000),
            ),
        );

    let totalTracks = 0;
    if (totalTracksCount) {
        totalTracks = totalTracksCount[0]!.countTracks;
    }

    return (
        <div className="p-4">
            <h1 className="mb-2 text-2xl font-bold">Dashboard</h1>
            <DateSelector baseUrl={"http://localhost:3000"} className="mb-4" />

            <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                <Card>
                    <h2 className="mb-2 text-xl font-bold">Total Minutes</h2>
                    <p className="text-lg font-semibold">
                        {Math.round(totalMinutes).toLocaleString()}
                    </p>
                </Card>
                <Card>
                    <h2 className="mb-2 text-xl font-bold">Total Artists</h2>
                    <p className="text-lg font-semibold">
                        {totalArtists.toLocaleString()}
                    </p>
                </Card>
                <Card>
                    <h2 className="mb-2 text-xl font-bold">Total Tracks</h2>
                    <p className="text-lg font-semibold">
                        {totalTracks.toLocaleString()}
                    </p>
                </Card>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card>
                    <h2 className="mb-2 text-xl font-bold">Top Artists</h2>
                    <TableRoot>
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableHeaderCell>Rank</TableHeaderCell>
                                    <TableHeaderCell>Artist</TableHeaderCell>
                                    <TableHeaderCell>Count</TableHeaderCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {topArtists.map((artist, index) => (
                                    <TableRow key={artist.artistId}>
                                        <TableCell>{index + 1}</TableCell>
                                        <TableCell>
                                            <Link
                                                className="flex items-center gap-4 text-wrap"
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
                                        <TableCell>{artist.count}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableRoot>
                </Card>
                <Card>
                    <h2 className="mb-2 text-xl font-bold">Top Tracks</h2>
                    <TableRoot>
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableHeaderCell>Rank</TableHeaderCell>
                                    <TableHeaderCell>Track</TableHeaderCell>
                                    <TableHeaderCell>Count</TableHeaderCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {topTracks.map((track, index) => (
                                    <TableRow key={track.trackId}>
                                        <TableCell>{index + 1}</TableCell>
                                        <TableCell>
                                            <Link
                                                className="flex items-center gap-4 text-wrap"
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
                                        <TableCell>{track.count}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableRoot>
                </Card>
            </div>
        </div>
    );
}
