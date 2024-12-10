import { auth, clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getSpotifyAccount } from "@/server/lib";

export default async function Layout({
    children,
}: Readonly<{ children: React.ReactNode }>) {
    const { userId } = await auth();

    if (!userId) {
        return redirect("/login");
    }

    const apiClient = await clerkClient();
    const spotifyAccount = await getSpotifyAccount(apiClient, userId);

    if (!spotifyAccount) {
        // Shouldn't happen, but just in case
        return redirect("/login");
    }

    return <>{children}</>;
}
