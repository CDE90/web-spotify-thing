import { auth, clerkClient } from "@clerk/nextjs/server";
import { getCurrentlyPlaying } from "@/server/spotify/spotify";

export default async function HomePage() {
    const { userId } = await auth();

    if (!userId) {
        return <p>You are not signed in.</p>;
    }

    const clerkTokenResponse = await (
        await clerkClient()
    ).users.getUserOauthAccessToken(userId, "oauth_spotify");

    if (!clerkTokenResponse.data) {
        return <p>Error getting access token.</p>;
    }

    const data = clerkTokenResponse.data[0]!;
    const accessToken = data.token;

    const nowListening = await getCurrentlyPlaying(accessToken);

    return (
        <div className="p-4">
            <h1>Welcome!</h1>
            <p>Your user ID is {userId}</p>
            <p>Listening to {nowListening?.item.name}</p>
            <p>{JSON.stringify(nowListening)}</p>
        </div>
    );
}
