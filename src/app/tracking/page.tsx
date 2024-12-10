import { auth, clerkClient } from "@clerk/nextjs/server";
import { getCurrentlyPlaying } from "@/server/spotify/spotify";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
    setUserTracking,
    getSpotifyToken,
    getSpotifyAccount,
} from "@/server/lib";

export default async function HomePage() {
    const { userId } = await auth();

    if (!userId) {
        return <p>You are not signed in.</p>;
    }

    const apiClient = await clerkClient();

    const accessToken = await getSpotifyToken(apiClient, userId);
    const spotifyAccount = await getSpotifyAccount(apiClient, userId);

    if (!accessToken || !spotifyAccount) {
        return <p>Error getting spotify token. Try signing in again.</p>;
    }

    const nowListening = await getCurrentlyPlaying(accessToken);

    const dbUsers = await db.select().from(users).where(eq(users.id, userId));

    if (!dbUsers.length || !dbUsers[0]!.enabled) {
        return (
            <div className="p-4">
                <h1>Welcome!</h1>
                <p>
                    You have not set up Spotify tracking yet. Click below to set
                    it up.
                </p>
                <form
                    action={async () => {
                        "use server";
                        await setUserTracking(
                            true,
                            userId,
                            spotifyAccount.externalId,
                        );
                        revalidatePath("/tracking");
                    }}
                >
                    <button
                        type="submit"
                        className="rounded-md bg-blue-500 p-4 hover:bg-blue-600"
                    >
                        Enable Spotify tracking
                    </button>
                </form>
            </div>
        );
    }

    return (
        <div className="p-4">
            <h1>Welcome!</h1>
            <p>Your user ID is {userId}</p>
            <p>Listening to {nowListening?.item.name}</p>
            <form
                action={async () => {
                    "use server";
                    await setUserTracking(
                        false,
                        userId,
                        spotifyAccount.externalId,
                    );
                    revalidatePath("/tracking");
                }}
            >
                <button
                    type="submit"
                    className="rounded-md bg-red-500 p-4 hover:bg-red-600"
                >
                    Disable Spotify tracking
                </button>
            </form>
        </div>
    );
}
